import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  Comparativo,
  budgetItems,
  comparativoOfertaLineas,
  comparativoOfertas,
  comparativos,
  contacts,
  projectPhases,
  projects,
  purchaseOrders,
} from '@erp/db';
import {
  ComparativoAdjudicarInput,
  ComparativoCreateInput,
  ComparativoDto,
  ComparativoMatrizDto,
  ComparativoOfertaCreateInput,
  ComparativoOfertaDto,
  ComparativoOfertaUpdateInput,
  ComparativoUpdateInput,
  SavingsObservation,
  SavingsOpportunityDto,
  buildOrderNumber,
  comparativoAdjudicarSchema,
  comparativoCreateSchema,
  comparativoOfertaCreateSchema,
  comparativoOfertaUpdateSchema,
  comparativoUpdateSchema,
  computeDeviationVsTarget,
  computeLineTotal,
  computeOfertaTotal,
  computeSavingsOpportunities,
  findCheapestOfertaId,
  todayIso,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function toDto(
  row: Comparativo,
  phase: { code: string; name: string },
  ofertaCount: number,
): ComparativoDto {
  return {
    id: row.id,
    projectId: row.projectId,
    phaseId: row.phaseId,
    phaseCode: phase.code,
    phaseName: phase.name,
    title: row.title,
    status: row.status,
    awardedAt: row.awardedAt?.toISOString() ?? null,
    purchaseOrderId: row.purchaseOrderId,
    notes: row.notes,
    ofertaCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const AHORRO_SYSTEM_PROMPT = `Eres el redactor de un resumen ejecutivo de ahorro para gerencia de una empresa de construcción española.

Recibes una lista de oportunidades de ahorro ya detectadas (código de partida, precio pagado vs. mínimo visto en otra obra/proveedor, % de sobreprecio, ahorro potencial en €) y escribes 2-4 frases en español destacando lo más relevante: el ahorro potencial total, la partida con mayor sobreprecio, y si hay un patrón (un proveedor o una obra que se repite). No inventes datos que no estén en la lista. Sin Markdown, texto plano.`;

@Injectable()
export class ComparativosService {
  private client: Anthropic | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  get aiEnabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async list(projectId?: string): Promise<ComparativoDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (projectId && !allowed.includes(projectId)) return [];
    }

    const filters = [
      eq(comparativos.companyId, companyId),
      isNull(comparativos.deletedAt),
    ];
    if (projectId) filters.push(eq(comparativos.projectId, projectId));

    const rows = await this.dbs.db
      .select({
        comparativo: comparativos,
        phaseCode: projectPhases.code,
        phaseName: projectPhases.name,
      })
      .from(comparativos)
      .innerJoin(projectPhases, eq(comparativos.phaseId, projectPhases.id))
      .where(and(...filters))
      .orderBy(asc(comparativos.createdAt));

    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.comparativo.projectId));

    const counts = await this.ofertaCounts(
      visible.map((r) => r.comparativo.id),
    );
    return visible.map((r) =>
      toDto(
        r.comparativo,
        { code: r.phaseCode, name: r.phaseName },
        counts.get(r.comparativo.id) ?? 0,
      ),
    );
  }

  async create(input: ComparativoCreateInput): Promise<ComparativoDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = comparativoCreateSchema.parse(input);
    await this.findProject(data.projectId);
    const phase = await this.findPhase(data.phaseId, data.projectId);

    const [row] = await this.dbs.db
      .insert(comparativos)
      .values({
        companyId,
        projectId: data.projectId,
        phaseId: data.phaseId,
        title: data.title,
        notes: data.notes ?? null,
      })
      .returning();

    void this.audit.log({
      entityType: 'comparativo',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return toDto(row, phase, 0);
  }

  async update(
    id: string,
    input: ComparativoUpdateInput,
  ): Promise<ComparativoDto> {
    const { comparativo, phase } = await this.find(id);
    const data = comparativoUpdateSchema.parse(input);
    const [row] = await this.dbs.db
      .update(comparativos)
      .set({
        ...(data.title !== undefined && { title: data.title }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(comparativos.id, comparativo.id))
      .returning();
    const count = (await this.ofertaCounts([id])).get(id) ?? 0;
    return toDto(row, phase, count);
  }

  async remove(id: string): Promise<void> {
    const { comparativo } = await this.find(id);
    await this.dbs.db
      .update(comparativos)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comparativos.id, comparativo.id));
  }

  /** La matriz comparativa: filas = partidas de la fase, columnas = ofertas. */
  async matriz(id: string): Promise<ComparativoMatrizDto> {
    const { comparativo, phase } = await this.find(id);

    const items = await this.dbs.db
      .select()
      .from(budgetItems)
      .where(eq(budgetItems.phaseId, comparativo.phaseId))
      .orderBy(asc(budgetItems.sortOrder), asc(budgetItems.code));

    const partidas = items.map((item) => ({
      budgetItemId: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      targetQuantity: Number(item.quantity),
      targetUnitPrice: Number(item.unitPrice),
      targetTotal: Number(item.totalAmount),
    }));
    const targetTotal = partidas.reduce((sum, p) => sum + p.targetTotal, 0);

    const ofertaRows = await this.dbs.db
      .select({
        oferta: comparativoOfertas,
        contactName: contacts.legalName,
      })
      .from(comparativoOfertas)
      .innerJoin(contacts, eq(comparativoOfertas.contactId, contacts.id))
      .where(eq(comparativoOfertas.comparativoId, comparativo.id))
      .orderBy(asc(comparativoOfertas.createdAt));

    const ofertaIds = ofertaRows.map((r) => r.oferta.id);
    const lineasRows =
      ofertaIds.length > 0
        ? await this.dbs.db
            .select()
            .from(comparativoOfertaLineas)
            .where(inArray(comparativoOfertaLineas.ofertaId, ofertaIds))
        : [];

    const lineasByOferta = new Map<
      string,
      (typeof comparativoOfertaLineas.$inferSelect)[]
    >();
    for (const linea of lineasRows) {
      const list = lineasByOferta.get(linea.ofertaId) ?? [];
      list.push(linea);
      lineasByOferta.set(linea.ofertaId, list);
    }

    const ofertas = ofertaRows.map(({ oferta, contactName }) => {
      const lineas = lineasByOferta.get(oferta.id) ?? [];
      const celdas = partidas.map((partida) => {
        const linea = lineas.find(
          (l) => l.budgetItemId === partida.budgetItemId,
        );
        return {
          budgetItemId: partida.budgetItemId,
          unitPrice: linea ? Number(linea.unitPrice) : null,
          quantity: linea ? Number(linea.quantity) : null,
          totalAmount: linea ? Number(linea.totalAmount) : null,
        };
      });
      const totalAmount = computeOfertaTotal(
        celdas.map((c) => c.totalAmount ?? 0),
      );
      const { deviation, deviationPct } = computeDeviationVsTarget(
        totalAmount,
        targetTotal,
      );
      return {
        ofertaId: oferta.id,
        contactId: oferta.contactId,
        contactName,
        leadTimeDays: oferta.leadTimeDays,
        paymentTerms: oferta.paymentTerms,
        isAwarded: oferta.isAwarded,
        totalAmount,
        deviationVsTarget: deviation,
        deviationVsTargetPct: deviationPct,
        celdas,
      };
    });

    return {
      comparativoId: comparativo.id,
      title: comparativo.title,
      status: comparativo.status,
      projectId: comparativo.projectId,
      phaseId: comparativo.phaseId,
      phaseCode: phase.code,
      phaseName: phase.name,
      targetTotal,
      partidas,
      ofertas,
      cheapestOfertaId: findCheapestOfertaId(
        ofertas.map((o) => ({
          ofertaId: o.ofertaId,
          totalAmount: o.totalAmount,
        })),
      ),
    };
  }

  async addOferta(
    comparativoId: string,
    input: ComparativoOfertaCreateInput,
  ): Promise<ComparativoOfertaDto> {
    const { comparativo } = await this.find(comparativoId);
    if (comparativo.status !== 'abierto') {
      throw new ConflictException(
        'El comparativo ya está adjudicado o cancelado: no admite más ofertas',
      );
    }
    const data = comparativoOfertaCreateSchema.parse(input);
    await this.findContact(data.contactId);
    const validItems = await this.assertItemsBelongToPhase(
      comparativo.phaseId,
      data.lineas.map((l) => l.budgetItemId),
    );

    const id = await this.dbs.db.transaction(async (tx) => {
      let ofertaId: string;
      try {
        const [oferta] = await tx
          .insert(comparativoOfertas)
          .values({
            comparativoId: comparativo.id,
            contactId: data.contactId,
            leadTimeDays: data.leadTimeDays ?? null,
            paymentTerms: data.paymentTerms ?? null,
            notes: data.notes ?? null,
          })
          .returning();
        ofertaId = oferta.id;
      } catch (err) {
        this.rethrowDuplicateContact(err);
      }
      await tx.insert(comparativoOfertaLineas).values(
        data.lineas.map((linea) => {
          const item = validItems.get(linea.budgetItemId)!;
          const quantity = linea.quantity ?? Number(item.quantity);
          const totalAmount = computeLineTotal(linea.unitPrice, quantity);
          return {
            ofertaId,
            budgetItemId: linea.budgetItemId,
            unitPrice: linea.unitPrice.toFixed(4),
            quantity: quantity.toFixed(4),
            totalAmount: totalAmount.toFixed(2),
          };
        }),
      );
      return ofertaId;
    });

    void this.audit.log({
      entityType: 'comparativo_oferta',
      entityId: id,
      action: 'create',
      newData: { comparativoId: comparativo.id, ...data },
    });
    return this.getOferta(id);
  }

  async updateOferta(
    comparativoId: string,
    ofertaId: string,
    input: ComparativoOfertaUpdateInput,
  ): Promise<ComparativoOfertaDto> {
    const { comparativo } = await this.find(comparativoId);
    if (comparativo.status !== 'abierto') {
      throw new ConflictException(
        'El comparativo ya está adjudicado o cancelado: no se puede editar',
      );
    }
    await this.findOferta(comparativo.id, ofertaId);
    const data = comparativoOfertaUpdateSchema.parse(input);

    await this.dbs.db.transaction(async (tx) => {
      if (
        data.leadTimeDays !== undefined ||
        data.paymentTerms !== undefined ||
        data.notes !== undefined
      ) {
        await tx
          .update(comparativoOfertas)
          .set({
            ...(data.leadTimeDays !== undefined && {
              leadTimeDays: data.leadTimeDays ?? null,
            }),
            ...(data.paymentTerms !== undefined && {
              paymentTerms: data.paymentTerms ?? null,
            }),
            ...(data.notes !== undefined && { notes: data.notes ?? null }),
            updatedAt: new Date(),
          })
          .where(eq(comparativoOfertas.id, ofertaId));
      }
      if (data.lineas !== undefined) {
        const validItems = await this.assertItemsBelongToPhase(
          comparativo.phaseId,
          data.lineas.map((l) => l.budgetItemId),
        );
        await tx
          .delete(comparativoOfertaLineas)
          .where(eq(comparativoOfertaLineas.ofertaId, ofertaId));
        await tx.insert(comparativoOfertaLineas).values(
          data.lineas.map((linea) => {
            const item = validItems.get(linea.budgetItemId)!;
            const quantity = linea.quantity ?? Number(item.quantity);
            const totalAmount = computeLineTotal(linea.unitPrice, quantity);
            return {
              ofertaId,
              budgetItemId: linea.budgetItemId,
              unitPrice: linea.unitPrice.toFixed(4),
              quantity: quantity.toFixed(4),
              totalAmount: totalAmount.toFixed(2),
            };
          }),
        );
      }
    });

    return this.getOferta(ofertaId);
  }

  async removeOferta(comparativoId: string, ofertaId: string): Promise<void> {
    const { comparativo } = await this.find(comparativoId);
    if (comparativo.status !== 'abierto') {
      throw new ConflictException(
        'El comparativo ya está adjudicado o cancelado: no se puede quitar una oferta',
      );
    }
    await this.findOferta(comparativo.id, ofertaId);
    await this.dbs.db
      .delete(comparativoOfertas)
      .where(eq(comparativoOfertas.id, ofertaId));
  }

  /**
   * Formaliza la adjudicación: marca la oferta ganadora, cierra el
   * comparativo y genera automáticamente el pedido/subcontrata en
   * `purchase_orders` (estado `emitido`, que ya hace de borrador en el
   * ciclo de compras existente — no hace falta un estado nuevo).
   */
  async adjudicar(
    id: string,
    input: ComparativoAdjudicarInput,
  ): Promise<ComparativoDto> {
    const companyId = await this.dbs.getCompanyId();
    const { comparativo, phase } = await this.find(id);
    if (comparativo.status !== 'abierto') {
      throw new ConflictException(
        'Este comparativo ya está adjudicado o cancelado',
      );
    }
    const data = comparativoAdjudicarSchema.parse(input);
    const oferta = await this.findOferta(comparativo.id, data.ofertaId);

    const lineas = await this.dbs.db
      .select()
      .from(comparativoOfertaLineas)
      .where(eq(comparativoOfertaLineas.ofertaId, oferta.id));
    if (lineas.length === 0) {
      throw new ConflictException(
        'La oferta seleccionada no tiene ninguna partida con precio',
      );
    }
    const offerTotal = computeOfertaTotal(
      lineas.map((l) => Number(l.totalAmount)),
    );
    const project = await this.findProject(comparativo.projectId);
    const orderDate = data.orderDate ?? todayIso();

    const updated = await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(comparativoOfertas)
        .set({ isAwarded: true, updatedAt: new Date() })
        .where(eq(comparativoOfertas.id, oferta.id));

      // Mismo criterio que `PurchaseOrdersService.create()`: correlativo por
      // obra, no global (ver `buildOrderNumber` en `@erp/shared`).
      const [last] = await tx
        .select({ seq: purchaseOrders.seq })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.projectId, comparativo.projectId),
            isNull(purchaseOrders.deletedAt),
          ),
        )
        .orderBy(desc(purchaseOrders.seq))
        .limit(1);
      const seq = (last?.seq ?? 0) + 1;

      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          companyId,
          projectId: comparativo.projectId,
          contactId: oferta.contactId,
          seq,
          orderNumber: buildOrderNumber(project.code, seq),
          orderDate,
          phaseId: comparativo.phaseId,
          description: `Adjudicación comparativo "${comparativo.title}" (${phase.code} — ${phase.name})`,
          amount: offerTotal.toFixed(2),
          notes: data.notes ?? null,
        })
        .returning();

      const [row] = await tx
        .update(comparativos)
        .set({
          status: 'adjudicado',
          awardedAt: new Date(),
          purchaseOrderId: order.id,
          updatedAt: new Date(),
        })
        .where(eq(comparativos.id, comparativo.id))
        .returning();
      return { row, order };
    });

    void this.audit.log({
      entityType: 'comparativo',
      entityId: comparativo.id,
      action: 'update',
      newData: {
        status: 'adjudicado',
        ofertaId: oferta.id,
        purchaseOrderId: updated.order.id,
        amount: offerTotal,
      },
    });
    const count = (await this.ofertaCounts([id])).get(id) ?? 0;
    return toDto(updated.row, phase, count);
  }

  /**
   * Oportunidades de ahorro: partidas donde el precio unitario de una oferta
   * **adjudicada** (lo que de verdad se paga) supera claramente el mínimo
   * unitario visto para el mismo código de partida en cualquier otra oferta
   * de la empresa — de la misma obra o de otra. Puramente aritmético
   * (`computeSavingsOpportunities`, `@erp/shared`), sin IA: la redacción de
   * un resumen narrativo sobre esta lista es un paso aparte y opcional
   * (`POST /comparativos/ahorro/resumen`), no depende de este cálculo.
   */
  async ahorro(): Promise<SavingsOpportunityDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && allowed.length === 0) return [];

    const filters = [
      eq(comparativos.companyId, companyId),
      isNull(comparativos.deletedAt),
    ];
    if (allowed !== null)
      filters.push(inArray(comparativos.projectId, allowed));

    const rows = await this.dbs.db
      .select({
        code: budgetItems.code,
        name: budgetItems.name,
        unitPrice: comparativoOfertaLineas.unitPrice,
        quantity: comparativoOfertaLineas.quantity,
        isAwarded: comparativoOfertas.isAwarded,
        projectId: comparativos.projectId,
        projectName: projects.name,
        contactId: comparativoOfertas.contactId,
        contactName: contacts.legalName,
      })
      .from(comparativoOfertaLineas)
      .innerJoin(
        comparativoOfertas,
        eq(comparativoOfertaLineas.ofertaId, comparativoOfertas.id),
      )
      .innerJoin(
        comparativos,
        eq(comparativoOfertas.comparativoId, comparativos.id),
      )
      .innerJoin(
        budgetItems,
        eq(comparativoOfertaLineas.budgetItemId, budgetItems.id),
      )
      .innerJoin(projects, eq(comparativos.projectId, projects.id))
      .innerJoin(contacts, eq(comparativoOfertas.contactId, contacts.id))
      .where(and(...filters));

    const observations: SavingsObservation[] = rows.map((r) => ({
      budgetItemCode: r.code,
      budgetItemName: r.name,
      unitPrice: Number(r.unitPrice),
      quantity: Number(r.quantity),
      projectId: r.projectId,
      projectName: r.projectName,
      contactId: r.contactId,
      contactName: r.contactName,
      isAwarded: r.isAwarded,
    }));

    return computeSavingsOpportunities(observations);
  }

  /**
   * Resumen narrativo opcional sobre una lista de oportunidades ya
   * calculadas (recibida, no recalculada — misma idea que
   * `InformesService`/`POST /informes/mensual/email`: la redacción es un
   * paso aparte del cálculo). Opt-in silencioso, pero aquí con `400` en vez
   * de degradar: a diferencia del informe mensual, esto es un botón
   * explícito "resumir con IA", no una respuesta que el usuario ya espera
   * ver siempre.
   */
  async resumenAhorro(
    opportunities: SavingsOpportunityDto[],
  ): Promise<{ resumen: string }> {
    if (!this.aiEnabled) {
      throw new BadRequestException(
        'El resumen de ahorro no está disponible: configura `ANTHROPIC_API_KEY` en el .env de la API.',
      );
    }
    if (opportunities.length === 0) {
      return { resumen: 'No hay oportunidades de ahorro detectadas.' };
    }

    const response = await this.anthropic().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: AHORRO_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Resume estas oportunidades de ahorro:\n\n${JSON.stringify(opportunities, null, 2)}`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text.trim()) {
      throw new BadRequestException(
        `El modelo no devolvió resultado (stop_reason: ${response.stop_reason})`,
      );
    }
    return { resumen: text.trim() };
  }

  /* ────────────────────── privados ────────────────────── */

  private anthropic(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  private async ofertaCounts(
    comparativoIds: string[],
  ): Promise<Map<string, number>> {
    if (comparativoIds.length === 0) return new Map();
    const rows = await this.dbs.db
      .select({
        comparativoId: comparativoOfertas.comparativoId,
        count: sql<number>`count(*)::int`,
      })
      .from(comparativoOfertas)
      .where(inArray(comparativoOfertas.comparativoId, comparativoIds))
      .groupBy(comparativoOfertas.comparativoId);
    return new Map(rows.map((r) => [r.comparativoId, r.count]));
  }

  private async getOferta(ofertaId: string): Promise<ComparativoOfertaDto> {
    const [row] = await this.dbs.db
      .select({
        oferta: comparativoOfertas,
        contactName: contacts.legalName,
      })
      .from(comparativoOfertas)
      .innerJoin(contacts, eq(comparativoOfertas.contactId, contacts.id))
      .where(eq(comparativoOfertas.id, ofertaId))
      .limit(1);
    if (!row) throw new NotFoundException('Oferta no encontrada');
    const lineas = await this.dbs.db
      .select()
      .from(comparativoOfertaLineas)
      .where(eq(comparativoOfertaLineas.ofertaId, ofertaId));
    const totalAmount = computeOfertaTotal(
      lineas.map((l) => Number(l.totalAmount)),
    );
    return {
      id: row.oferta.id,
      comparativoId: row.oferta.comparativoId,
      contactId: row.oferta.contactId,
      contactName: row.contactName,
      leadTimeDays: row.oferta.leadTimeDays,
      paymentTerms: row.oferta.paymentTerms,
      isAwarded: row.oferta.isAwarded,
      totalAmount,
      notes: row.oferta.notes,
      createdAt: row.oferta.createdAt.toISOString(),
      updatedAt: row.oferta.updatedAt.toISOString(),
    };
  }

  private async findOferta(comparativoId: string, ofertaId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(comparativoOfertas)
      .where(
        and(
          eq(comparativoOfertas.id, ofertaId),
          eq(comparativoOfertas.comparativoId, comparativoId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Oferta no encontrada');
    return row;
  }

  private async assertItemsBelongToPhase(
    phaseId: string,
    budgetItemIds: string[],
  ) {
    const uniqueIds = Array.from(new Set(budgetItemIds));
    const rows = await this.dbs.db
      .select()
      .from(budgetItems)
      .where(eq(budgetItems.phaseId, phaseId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of uniqueIds) {
      if (!byId.has(id)) {
        throw new NotFoundException(
          'Alguna partida de la oferta no pertenece a la fase del comparativo',
        );
      }
    }
    return byId;
  }

  private async findContact(contactId: string) {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.companyId, companyId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Contacto no encontrado');
    return row;
  }

  private async find(id: string) {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({
        comparativo: comparativos,
        phaseCode: projectPhases.code,
        phaseName: projectPhases.name,
      })
      .from(comparativos)
      .innerJoin(projectPhases, eq(comparativos.phaseId, projectPhases.id))
      .where(
        and(
          eq(comparativos.id, id),
          eq(comparativos.companyId, companyId),
          isNull(comparativos.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Comparativo no encontrado');
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(row.comparativo.projectId)) {
      throw new NotFoundException('Comparativo no encontrado');
    }
    return {
      comparativo: row.comparativo,
      phase: { code: row.phaseCode, name: row.phaseName },
    };
  }

  private async findPhase(phaseId: string, projectId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(projectPhases)
      .where(
        and(
          eq(projectPhases.id, phaseId),
          eq(projectPhases.projectId, projectId),
          isNull(projectPhases.deletedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException('Partida/fase no encontrada en esta obra');
    return row;
  }

  private async findProject(projectId: string) {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row;
  }

  private rethrowDuplicateContact(err: unknown): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    ) {
      throw new ConflictException(
        'Este proveedor ya tiene una oferta en este comparativo',
      );
    }
    throw err;
  }
}
