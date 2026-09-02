import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  ProjectPhase,
  deliveryNotes,
  invoiceLines,
  invoices,
  projectPhases,
  projects,
  purchaseOrders,
} from '@erp/db';
import {
  DeviationReportDto,
  PhaseCostInput,
  PhaseCreateInput,
  PhaseDto,
  PhaseUpdateInput,
  buildDeviationRows,
  deviationWarnings,
  phaseCreateSchema,
  round2,
} from '@erp/shared';
import { DbService } from '../db/db.service';

function toDto(row: ProjectPhase): PhaseDto {
  return {
    id: row.id,
    projectId: row.projectId,
    code: row.code,
    name: row.name,
    budgetAmount: row.budgetAmount === null ? null : Number(row.budgetAmount),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class PhasesService {
  constructor(private readonly dbs: DbService) {}

  async list(projectId: string): Promise<PhaseDto[]> {
    await this.findProject(projectId);
    const rows = await this.dbs.db
      .select()
      .from(projectPhases)
      .where(
        and(
          eq(projectPhases.projectId, projectId),
          isNull(projectPhases.deletedAt),
        ),
      )
      .orderBy(asc(projectPhases.code));
    return rows.map(toDto);
  }

  async create(projectId: string, input: PhaseCreateInput): Promise<PhaseDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    await this.findProject(projectId);
    const data = phaseCreateSchema.parse(input);
    try {
      const [row] = await this.dbs.db
        .insert(projectPhases)
        .values({
          companyId,
          projectId,
          code: data.code,
          name: data.name,
          budgetAmount: data.budgetAmount?.toFixed(2) ?? null,
        })
        .returning();
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, data.code);
    }
  }

  async update(id: string, input: PhaseUpdateInput): Promise<PhaseDto> {
    await this.find(id);
    try {
      const [row] = await this.dbs.db
        .update(projectPhases)
        .set({
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.budgetAmount !== undefined && {
            budgetAmount: input.budgetAmount?.toFixed(2) ?? null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(projectPhases.id, id))
        .returning();
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, input.code ?? '');
    }
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.dbs.db
      .update(projectPhases)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(projectPhases.id, id));
  }

  /**
   * Desvío por partida: presupuesto de coste frente al **coste probable**.
   *
   * El gasto imputado a día de hoy no sirve para medir el desvío de una
   * partida: a mitad de obra falta por gastar justo lo que falta por
   * ejecutar, así que todas las partidas darían un ahorro enorme y el
   * capítulo que ya se ha pasado de pedidos saldría en verde. Lo que se
   * compara es lo que la partida va a costar: facturado, más lo recibido sin
   * facturar, más lo pedido y aún no servido.
   */
  async deviation(projectId: string): Promise<DeviationReportDto> {
    const project = await this.findProject(projectId);
    const phases = await this.list(projectId);

    const [invoiced, accrued, committed] = await Promise.all([
      this.invoicedByPhase(projectId),
      this.accruedByPhase(projectId),
      this.committedByPhase(projectId),
    ]);

    const pendientes = new Map<string | null, PhaseCostInput>();
    const registrar = (
      phaseId: string | null,
      campo: 'invoiced' | 'accrued' | 'committed',
      amount: number,
    ) => {
      const actual = pendientes.get(phaseId) ?? {
        phaseId,
        code: '—',
        name: 'Sin partida asignada',
        budget: 0,
        invoiced: 0,
        accrued: 0,
        committed: 0,
      };
      actual[campo] = round2(actual[campo] + amount);
      pendientes.set(phaseId, actual);
    };

    const inputs: PhaseCostInput[] = phases.map((phase) => ({
      phaseId: phase.id,
      code: phase.code,
      name: phase.name,
      budget: phase.budgetAmount ?? 0,
      invoiced: invoiced.get(phase.id) ?? 0,
      accrued: accrued.get(phase.id) ?? 0,
      committed: committed.get(phase.id) ?? 0,
    }));

    // Coste imputado a la obra sin partida (o a partidas ya borradas): se
    // agrupa en una fila propia. Es coste de la obra igual que el demás, y
    // esconderlo dejaría el informe cuadrando con menos de lo que cuesta.
    const conocidas = new Set(phases.map((p) => p.id));
    for (const [mapa, campo] of [
      [invoiced, 'invoiced'],
      [accrued, 'accrued'],
      [committed, 'committed'],
    ] as const) {
      for (const [phaseId, amount] of mapa) {
        if (phaseId === null || !conocidas.has(phaseId)) {
          registrar(null, campo, amount);
        }
      }
    }
    const huerfanas = pendientes.get(null);
    if (huerfanas) inputs.push(huerfanas);

    const rows = buildDeviationRows(inputs);

    const budgetTotal = round2(rows.reduce((s, r) => s + r.budget, 0));
    const invoicedTotal = round2(rows.reduce((s, r) => s + r.invoiced, 0));
    const probableCostTotal = round2(
      rows.reduce((s, r) => s + r.probableCost, 0),
    );
    const uncommittedBudget = round2(
      rows.filter((r) => !r.started).reduce((s, r) => s + r.budget, 0),
    );
    return {
      projectId,
      contractAmount:
        project.contractAmount === null ? null : Number(project.contractAmount),
      budgetTotal,
      invoicedTotal,
      probableCostTotal,
      deviation: round2(probableCostTotal - budgetTotal),
      deviationPct:
        budgetTotal > 0
          ? round2(((probableCostTotal - budgetTotal) / budgetTotal) * 100)
          : null,
      uncommittedBudget,
      complete: rows.length > 0 && uncommittedBudget === 0,
      rows,
      warnings: deviationWarnings(rows),
    };
  }

  /** Facturas de compra vivas, por partida. */
  private async invoicedByPhase(
    projectId: string,
  ): Promise<Map<string | null, number>> {
    const rows = await this.dbs.db
      .select({
        phaseId: invoiceLines.phaseId,
        total: sql<string>`coalesce(sum(${invoiceLines.baseAmount}), 0)`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(
        and(
          eq(invoiceLines.projectId, projectId),
          eq(invoices.kind, 'compra'),
          ne(invoices.status, 'anulada'),
          isNull(invoices.deletedAt),
        ),
      )
      .groupBy(invoiceLines.phaseId);
    return new Map(rows.map((r) => [r.phaseId, round2(Number(r.total))]));
  }

  /** Albaranes recibidos y todavía sin factura, por partida. */
  private async accruedByPhase(
    projectId: string,
  ): Promise<Map<string | null, number>> {
    const rows = await this.dbs.db
      .select({
        phaseId: deliveryNotes.phaseId,
        total: sql<string>`coalesce(sum(${deliveryNotes.amount}), 0)`,
      })
      .from(deliveryNotes)
      .where(
        and(
          eq(deliveryNotes.projectId, projectId),
          isNull(deliveryNotes.invoiceId),
          isNull(deliveryNotes.deletedAt),
        ),
      )
      .groupBy(deliveryNotes.phaseId);
    return new Map(rows.map((r) => [r.phaseId, round2(Number(r.total))]));
  }

  /**
   * Pedido vivo por la parte no servida, por partida.
   *
   * Se agrupa por la partida **del pedido**: es la que decidió el jefe de
   * obra al comprometer el gasto, y por tanto la que responde de él aunque
   * algún albarán se impute luego a otra.
   */
  private async committedByPhase(
    projectId: string,
  ): Promise<Map<string | null, number>> {
    const delivered = this.dbs.db
      .select({
        orderId: deliveryNotes.orderId,
        amount: sql<string>`sum(${deliveryNotes.amount})`.as('delivered'),
      })
      .from(deliveryNotes)
      .where(isNull(deliveryNotes.deletedAt))
      .groupBy(deliveryNotes.orderId)
      .as('d');

    const rows = await this.dbs.db
      .select({
        phaseId: purchaseOrders.phaseId,
        total: sql<string>`coalesce(sum(greatest(${purchaseOrders.amount} - coalesce(${delivered.amount}, 0), 0)), 0)`,
      })
      .from(purchaseOrders)
      .leftJoin(delivered, eq(delivered.orderId, purchaseOrders.id))
      .where(
        and(
          eq(purchaseOrders.projectId, projectId),
          isNull(purchaseOrders.deletedAt),
          ne(purchaseOrders.status, 'anulado'),
          ne(purchaseOrders.status, 'cerrado'),
        ),
      )
      .groupBy(purchaseOrders.phaseId);
    return new Map(rows.map((r) => [r.phaseId, round2(Number(r.total))]));
  }

  private async find(id: string): Promise<ProjectPhase> {
    const [row] = await this.dbs.db
      .select()
      .from(projectPhases)
      .where(and(eq(projectPhases.id, id), isNull(projectPhases.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Partida no encontrada');
    }
    return row;
  }

  private async findProject(projectId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Obra no encontrada');
    }
    return row;
  }

  private rethrowDuplicateCode(err: unknown, code: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException(
        `Ya existe una partida con el código "${code}" en esta obra`,
      );
    }
    throw err;
  }
}
