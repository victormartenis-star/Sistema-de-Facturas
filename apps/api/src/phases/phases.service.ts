import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  ProjectPhase,
  invoiceLines,
  invoices,
  projectPhases,
  projects,
} from '@erp/db';
import {
  DeviationReportDto,
  DeviationRowDto,
  PhaseCreateInput,
  PhaseDto,
  PhaseUpdateInput,
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
   * Desvío presupuestario: presupuesto teórico de cada partida frente al
   * gasto real imputado (líneas de facturas de compra no anuladas).
   */
  async deviation(projectId: string): Promise<DeviationReportDto> {
    const project = await this.findProject(projectId);
    const phases = await this.list(projectId);

    const spent = await this.dbs.db
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

    const actualByPhase = new Map<string | null, number>();
    for (const row of spent) {
      actualByPhase.set(row.phaseId, Number(row.total));
    }

    const rows: DeviationRowDto[] = phases.map((phase) => {
      const budget = phase.budgetAmount ?? 0;
      const actual = actualByPhase.get(phase.id) ?? 0;
      actualByPhase.delete(phase.id);
      return {
        phaseId: phase.id,
        code: phase.code,
        name: phase.name,
        budget,
        actual: round2(actual),
        deviation: round2(actual - budget),
        deviationPct:
          budget > 0 ? round2(((actual - budget) / budget) * 100) : null,
      };
    });

    // Gasto imputado a la obra sin partida (o a partidas borradas)
    let unassigned = 0;
    for (const amount of actualByPhase.values()) {
      unassigned += amount;
    }
    if (unassigned > 0) {
      rows.push({
        phaseId: null,
        code: '—',
        name: 'Sin partida asignada',
        budget: 0,
        actual: round2(unassigned),
        deviation: round2(unassigned),
        deviationPct: null,
      });
    }

    const budgetTotal = round2(rows.reduce((s, r) => s + r.budget, 0));
    const actualTotal = round2(rows.reduce((s, r) => s + r.actual, 0));
    return {
      projectId,
      contractAmount:
        project.contractAmount === null ? null : Number(project.contractAmount),
      budgetTotal,
      actualTotal,
      deviation: round2(actualTotal - budgetTotal),
      deviationPct:
        budgetTotal > 0
          ? round2(((actualTotal - budgetTotal) / budgetTotal) * 100)
          : null,
      rows,
    };
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
