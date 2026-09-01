import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  CostForecast,
  Project,
  certifications,
  costForecasts,
  deliveryNotes,
  invoiceLines,
  invoices,
  projectMonthlyPlan,
  projects,
  purchaseOrders,
  variations,
} from '@erp/db';
import {
  CostForecastDto,
  CostForecastInput,
  MonthlyInput,
  MonthlyPlanRowDto,
  MonthlyPlanSaveInput,
  ProjectEconomicsDto,
  VariationStatus,
  buildMonthlyEvolution,
  computeBudgetImpact,
  computeMarginAtCompletion,
  computeProbableCost,
  reconcilePlan,
  formatEuros,
  costForecastSchema,
  monthlyPlanSaveSchema,
  round2,
  startOfMonth,
  todayIso,
} from '@erp/shared';
import { DbService } from '../db/db.service';

@Injectable()
export class ForecastService {
  constructor(private readonly dbs: DbService) {}

  /* ───────────────────── planificación mensual ───────────────────── */

  async getPlan(projectId: string): Promise<MonthlyPlanRowDto[]> {
    await this.findProject(projectId);
    const rows = await this.dbs.db
      .select()
      .from(projectMonthlyPlan)
      .where(
        and(
          eq(projectMonthlyPlan.projectId, projectId),
          isNull(projectMonthlyPlan.deletedAt),
        ),
      )
      .orderBy(asc(projectMonthlyPlan.month));
    return rows.map((r) => ({
      month: r.month,
      plannedProduction: Number(r.plannedProduction),
      plannedCost: Number(r.plannedCost),
    }));
  }

  /**
   * Guarda el reparto completo. Es una sustitución, no un merge: el plan es
   * un reparto del total y editarlo fila a fila deja descuadres invisibles.
   */
  async savePlan(
    projectId: string,
    input: MonthlyPlanSaveInput,
  ): Promise<MonthlyPlanRowDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    await this.findProject(projectId);
    const data = monthlyPlanSaveSchema.parse(input);

    await this.dbs.db.transaction(async (tx) => {
      await tx
        .delete(projectMonthlyPlan)
        .where(eq(projectMonthlyPlan.projectId, projectId));
      if (data.rows.length > 0) {
        await tx.insert(projectMonthlyPlan).values(
          data.rows.map((r) => ({
            companyId,
            projectId,
            month: r.month,
            plannedProduction: r.plannedProduction.toFixed(2),
            plannedCost: r.plannedCost.toFixed(2),
          })),
        );
      }
    });
    return this.getPlan(projectId);
  }

  /* ─────────────────── previsión de coste pendiente ─────────────────── */

  async listForecasts(projectId: string): Promise<CostForecastDto[]> {
    await this.findProject(projectId);
    const rows = await this.dbs.db
      .select()
      .from(costForecasts)
      .where(
        and(
          eq(costForecasts.projectId, projectId),
          isNull(costForecasts.deletedAt),
        ),
      )
      .orderBy(desc(costForecasts.asOfMonth));
    return rows.map(toForecastDto);
  }

  /**
   * Declara el coste que queda por contratar y ejecutar. Si ya hay previsión
   * de ese mes se sustituye: el jefe de obra puede corregirse dentro del mes,
   * pero no puede haber dos cifras para el mismo cierre.
   */
  async saveForecast(
    projectId: string,
    input: CostForecastInput,
  ): Promise<CostForecastDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    await this.findProject(projectId);
    const data = costForecastSchema.parse(input);

    const id = await this.dbs.db.transaction(async (tx) => {
      await tx
        .delete(costForecasts)
        .where(
          and(
            eq(costForecasts.projectId, projectId),
            eq(costForecasts.asOfMonth, data.asOfMonth),
          ),
        );
      const [row] = await tx
        .insert(costForecasts)
        .values({
          companyId,
          projectId,
          asOfMonth: data.asOfMonth,
          pendingToContract: data.pendingToContract.toFixed(2),
          notes: data.notes ?? null,
          reportedBy: data.reportedBy ?? null,
        })
        .returning();
      return row.id;
    });

    const [row] = await this.dbs.db
      .select()
      .from(costForecasts)
      .where(eq(costForecasts.id, id))
      .limit(1);
    return toForecastDto(row);
  }

  /* ──────────────────── la fotografía económica ──────────────────── */

  /**
   * Coste probable y evolución mensual de una obra: lo que se revisa en
   * pantalla en la reunión mensual.
   */
  async economics(projectId: string): Promise<ProjectEconomicsDto> {
    const project = await this.findProject(projectId);

    const [
      invoicedCost,
      accruedCost,
      committedCost,
      lastForecast,
      plan,
      realProduction,
      realCost,
      withoutOrder,
      approvedVariations,
    ] = await Promise.all([
      this.invoicedCost(projectId),
      this.accruedCost(projectId),
      this.committedCost(projectId),
      this.lastForecast(projectId),
      this.getPlan(projectId),
      this.productionByMonth(projectId),
      this.costByMonth(projectId),
      this.deliveredWithoutOrder(projectId),
      this.variationAmounts(projectId),
    ]);

    const probableCost = computeProbableCost({
      invoicedCost,
      accruedCost,
      committedCost,
      pendingToContract: lastForecast?.pendingToContract ?? 0,
    });

    // El presupuesto de venta que cuenta es el **actualizado**: el inicial
    // más las modificaciones aprobadas por DF y Propiedad. Lo pendiente no
    // computa como ingreso, así que no entra aquí.
    const budgetImpact = computeBudgetImpact(
      Number(project.contractAmount ?? 0),
      approvedVariations,
    );

    const atCompletion = computeMarginAtCompletion(
      budgetImpact.updatedBudget,
      project.targetCost === null ? null : Number(project.targetCost),
      probableCost.total,
    );

    const evolution = buildMonthlyEvolution(
      mergeMonths(plan, realProduction, realCost),
    );

    // El reparto tiene que sumar el presupuesto; si no, la evolución compara
    // el coste real contra un plan que no es el plan.
    const planReconciliation = reconcilePlan(
      plan,
      budgetImpact.updatedBudget,
      project.targetCost === null ? null : Number(project.targetCost),
    );

    return {
      projectId,
      projectCode: project.code,
      projectName: project.name,
      probableCost,
      atCompletion,
      budgetImpact,
      planReconciliation,
      evolution,
      lastForecast,
      warnings: buildWarnings(project, probableCost, atCompletion, evolution, {
        hasPlan: plan.length > 0,
        lastForecast,
        withoutOrder,
        budgetImpact,
        planReconciliation,
      }),
    };
  }

  /* ────────────────────────── agregados ────────────────────────── */

  /** Base imponible de las facturas de compra vivas imputadas a la obra. */
  private async invoicedCost(projectId: string): Promise<number> {
    const [row] = await this.dbs.db
      .select({
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
      );
    return round2(Number(row?.total ?? 0));
  }

  /**
   * Albaranes recibidos y todavía sin factura: la provisión del cierre.
   *
   * Se cuentan **también los que están pendientes de validar**. Un albarán
   * sin validar puede tener una incidencia, pero el material ya está en obra
   * y el coste ya se ha incurrido; dejarlo fuera es exactamente el error que
   * hace que el coste del mes salga a la baja y el margen aparente ser mejor
   * de lo que es. Ante la duda, el coste se reconoce antes, no después.
   */
  private async accruedCost(projectId: string): Promise<number> {
    const [row] = await this.dbs.db
      .select({
        total: sql<string>`coalesce(sum(${deliveryNotes.amount}), 0)`,
      })
      .from(deliveryNotes)
      .where(
        and(
          eq(deliveryNotes.projectId, projectId),
          isNull(deliveryNotes.invoiceId),
          isNull(deliveryNotes.deletedAt),
        ),
      );
    return round2(Number(row?.total ?? 0));
  }

  /** Modificaciones vivas de la obra, para el presupuesto actualizado. */
  private async variationAmounts(projectId: string) {
    const rows = await this.dbs.db
      .select()
      .from(variations)
      .where(
        and(eq(variations.projectId, projectId), isNull(variations.deletedAt)),
      );
    return rows.map((v) => ({
      status: v.status as VariationStatus,
      salesVariation: Number(v.salesVariation),
      costVariation: Number(v.costVariation),
      executed: v.executed,
    }));
  }

  /** Material recibido sin pedido: la fuga que la regla de oro persigue. */
  private async deliveredWithoutOrder(projectId: string): Promise<number> {
    const [row] = await this.dbs.db
      .select({
        total: sql<string>`coalesce(sum(${deliveryNotes.amount}), 0)`,
      })
      .from(deliveryNotes)
      .where(
        and(
          eq(deliveryNotes.projectId, projectId),
          isNull(deliveryNotes.orderId),
          isNull(deliveryNotes.deletedAt),
        ),
      );
    return round2(Number(row?.total ?? 0));
  }

  /**
   * Pedidos vivos por la parte todavía no servida. Se resta lo ya recibido
   * para no contar dos veces el material que ya está en la provisión o en la
   * factura.
   */
  private async committedCost(projectId: string): Promise<number> {
    const delivered = this.dbs.db
      .select({
        orderId: deliveryNotes.orderId,
        amount: sql<string>`sum(${deliveryNotes.amount})`.as('delivered'),
      })
      .from(deliveryNotes)
      .where(isNull(deliveryNotes.deletedAt))
      .groupBy(deliveryNotes.orderId)
      .as('d');

    const [row] = await this.dbs.db
      .select({
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
      );
    return round2(Number(row?.total ?? 0));
  }

  /** Producción real: lo certificado en el mes, por fecha de certificación. */
  private async productionByMonth(
    projectId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.dbs.db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${certifications.certDate}), 'YYYY-MM-DD')`,
        total: sql<string>`sum(${certifications.periodAmount})`,
      })
      .from(certifications)
      .where(
        and(
          eq(certifications.projectId, projectId),
          isNull(certifications.deletedAt),
        ),
      )
      .groupBy(sql`date_trunc('month', ${certifications.certDate})`);
    return new Map(rows.map((r) => [r.month, round2(Number(r.total))]));
  }

  /** Coste real del mes: facturas de compra por fecha de emisión. */
  private async costByMonth(projectId: string): Promise<Map<string, number>> {
    const rows = await this.dbs.db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${invoices.issueDate}), 'YYYY-MM-DD')`,
        total: sql<string>`sum(${invoiceLines.baseAmount})`,
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
      .groupBy(sql`date_trunc('month', ${invoices.issueDate})`);
    return new Map(rows.map((r) => [r.month, round2(Number(r.total))]));
  }

  private async lastForecast(
    projectId: string,
  ): Promise<CostForecastDto | null> {
    const [row] = await this.dbs.db
      .select()
      .from(costForecasts)
      .where(
        and(
          eq(costForecasts.projectId, projectId),
          isNull(costForecasts.deletedAt),
        ),
      )
      .orderBy(desc(costForecasts.asOfMonth))
      .limit(1);
    return row ? toForecastDto(row) : null;
  }

  private async findProject(projectId: string): Promise<Project> {
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row;
  }
}

function toForecastDto(row: CostForecast): CostForecastDto {
  return {
    id: row.id,
    asOfMonth: row.asOfMonth,
    pendingToContract: Number(row.pendingToContract),
    notes: row.notes,
    reportedBy: row.reportedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Une el plan con lo real. Se recorren todos los meses que aparecen en
 * cualquiera de las tres series: un mes con coste real y sin plan tiene que
 * salir igualmente, porque es precisamente el que nadie había previsto.
 */
function mergeMonths(
  plan: MonthlyPlanRowDto[],
  production: Map<string, number>,
  cost: Map<string, number>,
): MonthlyInput[] {
  const months = new Set<string>([
    ...plan.map((p) => p.month),
    ...production.keys(),
    ...cost.keys(),
  ]);
  const planByMonth = new Map(plan.map((p) => [p.month, p]));

  return [...months].sort().map((month) => ({
    month,
    plannedProduction: planByMonth.get(month)?.plannedProduction ?? 0,
    plannedCost: planByMonth.get(month)?.plannedCost ?? 0,
    realProduction: production.get(month) ?? 0,
    realCost: cost.get(month) ?? 0,
  }));
}

/** Avisos en lenguaje llano, los que hay que leer antes de la reunión. */
function buildWarnings(
  project: Project,
  probableCost: ReturnType<typeof computeProbableCost>,
  atCompletion: ReturnType<typeof computeMarginAtCompletion>,
  evolution: ReturnType<typeof buildMonthlyEvolution>,
  context: {
    hasPlan: boolean;
    lastForecast: CostForecastDto | null;
    /** Importe recibido en obra sin pedido detrás. */
    withoutOrder: number;
    budgetImpact: ReturnType<typeof computeBudgetImpact>;
    planReconciliation: ReturnType<typeof reconcilePlan>;
  },
): string[] {
  const warnings: string[] = [];

  if (project.contractAmount === null) {
    warnings.push(
      'La obra no tiene presupuesto de venta: sin él no hay margen que calcular.',
    );
  }
  if (project.targetCost === null) {
    warnings.push(
      'Falta el coste objetivo. Es la meta interna contra la que se mide la desviación; el presupuesto de venta no sirve para eso.',
    );
  }
  if (context.hasPlan && !context.planReconciliation.matches) {
    const r = context.planReconciliation;
    const partes = [
      r.productionGap !== 0 &&
        `producción repartida ${formatEuros(r.plannedProductionTotal)} frente a ${formatEuros(r.salesBudget)} de presupuesto`,
      r.costGap !== null &&
        r.costGap !== 0 &&
        `coste repartido ${formatEuros(r.plannedCostTotal)} frente a ${formatEuros(r.targetCost ?? 0)} de objetivo`,
    ].filter(Boolean);
    warnings.push(
      `El reparto mensual no cuadra con el presupuesto: ${partes.join('; ')}. La evolución se está comparando con un plan que no es el plan.`,
    );
  }
  if (!context.hasPlan) {
    warnings.push(
      'No hay planificación mensual. Sin repartir producción y coste por meses no existe el corte mensual y la evolución no puede compararse con nada.',
    );
  }
  if (!context.lastForecast) {
    warnings.push(
      'Nadie ha declarado el coste pendiente de contratar. El coste probable se está calculando solo con lo ya pedido, así que sale corto.',
    );
  } else {
    const currentMonth = startOfMonth(todayIso());
    if (context.lastForecast.asOfMonth < currentMonth) {
      warnings.push(
        `La última previsión de coste pendiente es de ${context.lastForecast.asOfMonth.slice(0, 7)}: está sin actualizar para el cierre en curso.`,
      );
    }
  }
  if (probableCost.accruedCost > 0) {
    warnings.push(
      `Hay ${formatEuros(probableCost.accruedCost)} en albaranes recibidos sin facturar. Si no se provisionan, el coste del mes sale a la baja.`,
    );
  }
  if (context.withoutOrder > 0) {
    warnings.push(
      `Han entrado ${formatEuros(context.withoutOrder)} de material sin pedido. Es coste que nadie autorizó antes de que llegara: regulariza el pedido o registra la incidencia.`,
    );
  }
  if (context.budgetImpact.executedNotApprovedCount > 0) {
    warnings.push(
      `Hay ${formatEuros(context.budgetImpact.executedNotApprovedCost)} de coste en modificados que se están ejecutando sin aprobar: consumen coste sin generar ingreso.`,
    );
  }
  if (context.budgetImpact.potentialImpact !== 0) {
    warnings.push(
      `Quedan ${formatEuros(context.budgetImpact.potentialImpact)} de impacto pendiente de aprobación. No computa como ingreso mientras la Propiedad no lo apruebe.`,
    );
  }
  if (evolution.firstDivergenceMonth) {
    warnings.push(
      `El coste real se separó del plan en ${evolution.firstDivergenceMonth.slice(0, 7)}: la causa hay que buscarla en ese mes, no en el último.`,
    );
  }
  const mesEnCurso = startOfMonth(todayIso());
  const sinCerrar = evolution.rows.filter(
    (r) => r.month < mesEnCurso && !r.hasRealData,
  );
  if (sinCerrar.length > 0) {
    warnings.push(
      `${sinCerrar.length} mes(es) ya vencidos sin producción ni coste anotados (desde ${sinCerrar[0].month.slice(0, 7)}). Salen como «sin datos», que no es lo mismo que estar en objetivo: hasta que no se cierren, el semáforo de la obra no dice nada.`,
    );
  }
  if (!atCompletion.costKnown) {
    warnings.push(
      'No hay ningún coste registrado todavía: sin facturas, pedidos ni previsión no se puede calcular el margen. Lo que se ve no es una obra sana, es una obra vacía.',
    );
  }
  if (atCompletion.margin !== null && atCompletion.margin < 0) {
    warnings.push(
      'El margen previsto a cierre es negativo: la obra va a perder dinero si nada cambia.',
    );
  }
  return warnings;
}
