import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  budgetItems,
  budgets,
  certifications,
  invoiceLines,
  invoices,
  paymentMilestones,
  partesMaquinaria,
  partesPersonal,
  projectPhases,
  projects,
} from '@erp/db';
import {
  CostControlDto,
  DesviacionPartidaInput,
  FacturaIvaInput,
  ObraEconomicsDto,
  BaseFacturaObra,
  RetencionMovimientoFactura,
  FasePlanificadaInput,
  SobrecostePartidaInput,
  buildCurvaS,
  buildPlannedByPeriod,
  computeCostControl,
  computeDesviacionPorPartida,
  computeIvaObra,
  computeMargenBrutoObra,
  computeMargenPrevistoObra,
  computeRetencionesObra,
  prorratearRetencionesDeObra,
  computeSobrecostePorPartida,
  fromCents,
  sumCents,
  toCents,
  todayIso,
} from '@erp/shared';
import { DbService } from '../db/db.service';

@Injectable()
export class CostControlService {
  constructor(private readonly dbs: DbService) {}

  async get(projectId: string): Promise<CostControlDto> {
    const project = await this.findProject(projectId);

    // BAC: partidas del presupuesto activo si existe; si no, importe de contrato.
    const [activeBudget] = await this.dbs.db
      .select({ id: budgets.id })
      .from(budgets)
      .where(
        and(
          eq(budgets.projectId, projectId),
          eq(budgets.status, 'activo'),
          isNull(budgets.deletedAt),
        ),
      )
      .limit(1);

    const phases = await this.dbs.db
      .select()
      .from(projectPhases)
      .where(
        and(
          eq(projectPhases.projectId, projectId),
          isNull(projectPhases.deletedAt),
        ),
      );

    const budgetByPhase = new Map<string, number>();
    let bac = 0;
    if (activeBudget) {
      const rows = await this.dbs.db
        .select({
          phaseId: budgetItems.phaseId,
          total: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        })
        .from(budgetItems)
        .where(eq(budgetItems.budgetId, activeBudget.id))
        .groupBy(budgetItems.phaseId);
      for (const row of rows) {
        const amount = Number(row.total);
        bac += amount;
        if (row.phaseId) budgetByPhase.set(row.phaseId, amount);
      }
    } else {
      bac =
        project.contractAmount === null ? 0 : Number(project.contractAmount);
      for (const phase of phases) {
        budgetByPhase.set(phase.id, Number(phase.budgetAmount ?? 0));
      }
    }

    // AC: facturas de compra no anuladas + partes de personal + partes de maquinaria.
    const { invoiceRows, personalRows, maquinariaRows } =
      await this.loadCostRows(projectId);

    const facturasCompra = invoiceRows.reduce((s, r) => s + Number(r.total), 0);
    const partesPersonalTotal = personalRows.reduce(
      (s, r) => s + Number(r.total),
      0,
    );
    const partesMaquinariaTotal = maquinariaRows.reduce(
      (s, r) => s + Number(r.total),
      0,
    );
    const ac = facturasCompra + partesPersonalTotal + partesMaquinariaTotal;

    const actualByPhase = new Map<string, number>();
    for (const [phaseId, total] of [
      ...invoiceRows.map((r) => [r.phaseId, Number(r.total)] as const),
      ...personalRows.map((r) => [r.phaseId, Number(r.total)] as const),
      ...maquinariaRows.map((r) => [r.phaseId, Number(r.total)] as const),
    ]) {
      if (!phaseId) continue;
      actualByPhase.set(phaseId, (actualByPhase.get(phaseId) ?? 0) + total);
    }

    // EV: última certificación (mayor seq) de la obra.
    const [lastCert] = await this.dbs.db
      .select({ cumulativeAmount: certifications.cumulativeAmount })
      .from(certifications)
      .where(
        and(
          eq(certifications.projectId, projectId),
          isNull(certifications.deletedAt),
        ),
      )
      .orderBy(sql`${certifications.seq} desc`)
      .limit(1);
    const ev = lastCert ? Number(lastCert.cumulativeAmount) : 0;

    const result = computeCostControl({ bac, ac, ev });

    const sobrecosteInput: SobrecostePartidaInput[] = phases.map((phase) => ({
      phaseId: phase.id,
      code: phase.code,
      name: phase.name,
      budget: budgetByPhase.get(phase.id) ?? 0,
      actual: actualByPhase.get(phase.id) ?? 0,
    }));
    const sobrecostePorPartida = computeSobrecostePorPartida(sobrecosteInput);

    const plannedInput: FasePlanificadaInput[] = phases
      .filter((p) => p.plannedStartDate && p.plannedEndDate)
      .map((p) => ({
        budgetAmount: budgetByPhase.get(p.id) ?? 0,
        plannedStartDate: p.plannedStartDate!,
        plannedEndDate: p.plannedEndDate!,
      }));
    const plannedByPeriod = buildPlannedByPeriod(plannedInput);
    const curvaPlanificadaPartidasSinFechas = phases.filter(
      (p) =>
        (budgetByPhase.get(p.id) ?? 0) > 0 &&
        (!p.plannedStartDate || !p.plannedEndDate),
    ).length;

    const curvaS = await this.buildCurvaSParaObra(projectId, plannedByPeriod);

    return {
      projectId,
      ...result,
      acBreakdown: {
        facturasCompra: Math.round(facturasCompra * 100) / 100,
        partesPersonal: Math.round(partesPersonalTotal * 100) / 100,
        partesMaquinaria: Math.round(partesMaquinariaTotal * 100) / 100,
      },
      sobrecostePorPartida,
      curvaS,
      curvaPlanificadaPartidasSinFechas,
    };
  }

  /** Coste real agrupado por partida y origen (`phaseId` nulo = sin partida). */
  private async loadCostRows(projectId: string, soloBorrador = false) {
    const invoiceRows = await this.dbs.db
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
          soloBorrador
            ? eq(invoices.status, 'borrador')
            : ne(invoices.status, 'anulada'),
          isNull(invoices.deletedAt),
        ),
      )
      .groupBy(invoiceLines.phaseId);

    const personalRows = await this.dbs.db
      .select({
        phaseId: partesPersonal.phaseId,
        total: sql<string>`coalesce(sum(${partesPersonal.totalCost}), 0)`,
      })
      .from(partesPersonal)
      .where(
        and(
          eq(partesPersonal.projectId, projectId),
          isNull(partesPersonal.deletedAt),
        ),
      )
      .groupBy(partesPersonal.phaseId);

    const maquinariaRows = await this.dbs.db
      .select({
        phaseId: partesMaquinaria.phaseId,
        total: sql<string>`coalesce(sum(${partesMaquinaria.totalCost}), 0)`,
      })
      .from(partesMaquinaria)
      .where(
        and(
          eq(partesMaquinaria.projectId, projectId),
          isNull(partesMaquinaria.deletedAt),
        ),
      )
      .groupBy(partesMaquinaria.phaseId);

    return { invoiceRows, personalRows, maquinariaRows };
  }

  /**
   * Economía de la obra en tiempo real: margen bruto, desviación por partida
   * (con la fila "Sin partida"), retenciones e IVA. Sin caché: agregados SQL
   * y reglas puras de `@erp/shared`.
   */
  async getEconomics(projectId: string): Promise<ObraEconomicsDto> {
    const project = await this.findProject(projectId);

    const phases = await this.dbs.db
      .select()
      .from(projectPhases)
      .where(
        and(
          eq(projectPhases.projectId, projectId),
          isNull(projectPhases.deletedAt),
        ),
      );

    // Presupuesto por partida: el del presupuesto activo; sin él, el de cada partida.
    const [activeBudget] = await this.dbs.db
      .select({ id: budgets.id })
      .from(budgets)
      .where(
        and(
          eq(budgets.projectId, projectId),
          eq(budgets.status, 'activo'),
          isNull(budgets.deletedAt),
        ),
      )
      .limit(1);
    const budgetByPhase = new Map<string | null, bigint>();
    if (activeBudget) {
      const rows = await this.dbs.db
        .select({
          phaseId: budgetItems.phaseId,
          total: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        })
        .from(budgetItems)
        .where(eq(budgetItems.budgetId, activeBudget.id))
        .groupBy(budgetItems.phaseId);
      for (const r of rows) budgetByPhase.set(r.phaseId, toCents(r.total));
    } else {
      for (const ph of phases) {
        budgetByPhase.set(ph.id, toCents(ph.budgetAmount ?? 0));
      }
    }

    // Costes por partida y origen.
    const { invoiceRows, personalRows, maquinariaRows } =
      await this.loadCostRows(projectId);
    const { invoiceRows: borradorRows } = await this.loadCostRows(
      projectId,
      true,
    );
    type Origen = 'facturasCompra' | 'partesPersonal' | 'partesMaquinaria';
    const costes = new Map<string | null, Record<Origen, bigint>>();
    const imputa = (
      rows: { phaseId: string | null; total: string }[],
      origen: Origen,
    ) => {
      for (const r of rows) {
        const fila = costes.get(r.phaseId) ?? {
          facturasCompra: 0n,
          partesPersonal: 0n,
          partesMaquinaria: 0n,
        };
        fila[origen] += toCents(r.total);
        costes.set(r.phaseId, fila);
      }
    };
    imputa(invoiceRows, 'facturasCompra');
    imputa(personalRows, 'partesPersonal');
    imputa(maquinariaRows, 'partesMaquinaria');

    const cero = {
      facturasCompra: 0n,
      partesPersonal: 0n,
      partesMaquinaria: 0n,
    };
    const filaDe = (
      phaseId: string | null,
      key: string | null,
      code: string,
      name: string,
    ): DesviacionPartidaInput => {
      const c = costes.get(key) ?? cero;
      return {
        phaseId,
        code,
        name,
        budget: fromCents(budgetByPhase.get(key) ?? 0n),
        facturasCompra: fromCents(c.facturasCompra),
        partesPersonal: fromCents(c.partesPersonal),
        partesMaquinaria: fromCents(c.partesMaquinaria),
      };
    };
    const desviacionRows = phases.map((ph) =>
      filaDe(ph.id, ph.id, ph.code, ph.name),
    );
    // Sin partida (o de una partida ya borrada): todo cae en "Sin partida".
    const idsPartidas = new Set(phases.map((ph) => ph.id));
    for (const key of new Set([...budgetByPhase.keys(), ...costes.keys()])) {
      if (key !== null && idsPartidas.has(key)) continue;
      desviacionRows.push(filaDe(null, key, '', ''));
    }

    const totalOrigen = (o: Origen) =>
      fromCents(sumCents([...costes.values()].map((c) => c[o])));

    // EV: última certificación (mayor seq) de la obra.
    const [lastCert] = await this.dbs.db
      .select({ cumulativeAmount: certifications.cumulativeAmount })
      .from(certifications)
      .where(
        and(
          eq(certifications.projectId, projectId),
          isNull(certifications.deletedAt),
        ),
      )
      .orderBy(sql`${certifications.seq} desc`)
      .limit(1);

    // Una sola consulta: TODAS las líneas de las facturas no anuladas que
    // tocan la obra. Las de otras obras solo sirven de peso para el prorrateo
    // (la respuesta contiene únicamente importes de la obra pedida).
    const lineas = await this.dbs.db
      .select({
        invoiceId: invoiceLines.invoiceId,
        kind: invoices.kind,
        isp: invoices.isp,
        status: invoices.status,
        projectId: invoiceLines.projectId,
        baseAmount: invoiceLines.baseAmount,
        vatPct: invoiceLines.vatPct,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(
        and(
          ne(invoices.status, 'anulada'),
          isNull(invoices.deletedAt),
          inArray(
            invoiceLines.invoiceId,
            this.dbs.db
              .select({ id: invoiceLines.invoiceId })
              .from(invoiceLines)
              .where(eq(invoiceLines.projectId, projectId)),
          ),
        ),
      );

    // Facturación emitida (aprobada, pagada o rectificada); las rectificativas
    // entran con su signo, así original y rectificativa netean. La base es
    // exacta por línea: no se prorratea.
    const emitidas = lineas.filter((l) =>
      (['aprobada', 'pagada', 'rectificada'] as string[]).includes(l.status),
    );
    const facturadoVenta = sumCents(
      emitidas
        .filter((l) => l.projectId === projectId && l.kind === 'venta')
        .map((l) => toCents(l.baseAmount)),
    );
    const porFactura = new Map<string, FacturaIvaInput>();
    for (const l of emitidas) {
      const f = porFactura.get(l.invoiceId) ?? {
        kind: l.kind,
        isp: l.isp,
        lines: [],
      };
      f.lines.push({
        baseAmount: Number(l.baseAmount),
        vatPct: Number(l.vatPct),
        projectId: l.projectId,
      });
      porFactura.set(l.invoiceId, f);
    }

    // Retenciones: la retención es de cabecera (sobre la base total de la
    // factura). Una factura repartida entre obras aporta a cada una su parte,
    // en proporción a su base (resto mayor; ver prorratearRetencionesDeObra).
    const idsFacturas = [...new Set(lineas.map((l) => l.invoiceId))];
    const bases: BaseFacturaObra[] = lineas.map((l) => ({
      invoiceId: l.invoiceId,
      projectId: l.projectId,
      baseAmount: l.baseAmount,
    }));
    const movimientos: RetencionMovimientoFactura[] =
      idsFacturas.length === 0
        ? []
        : await this.dbs.db
            .select({
              invoiceId: paymentMilestones.invoiceId,
              direction: paymentMilestones.direction,
              amount: paymentMilestones.amount,
              dueDate: paymentMilestones.dueDate,
              status: paymentMilestones.status,
            })
            .from(paymentMilestones)
            .where(
              and(
                inArray(paymentMilestones.invoiceId, idsFacturas),
                eq(paymentMilestones.kind, 'retencion'),
              ),
            );

    const margen = computeMargenBrutoObra({
      certificado: lastCert?.cumulativeAmount ?? 0,
      facturadoVenta: fromCents(facturadoVenta),
      costes: {
        facturasCompra: totalOrigen('facturasCompra'),
        partesPersonal: totalOrigen('partesPersonal'),
        partesMaquinaria: totalOrigen('partesMaquinaria'),
      },
      facturasCompraEnBorrador: fromCents(
        sumCents(borradorRows.map((r) => toCents(r.total))),
      ),
    });
    return {
      projectId: project.id,
      generadoEn: new Date().toISOString(),
      margen,
      desviaciones: computeDesviacionPorPartida(desviacionRows),
      retenciones: computeRetencionesObra(
        prorratearRetencionesDeObra(movimientos, bases, projectId),
        todayIso(),
      ),
      iva: computeIvaObra([...porFactura.values()], projectId),
      // El presupuesto activo se trata como coste previsto.
      previsto: computeMargenPrevistoObra({
        contrato: project.contractAmount,
        totalPresupuestado: fromCents(sumCents([...budgetByPhase.values()])),
        margenActualPct: margen.margenSobreCertificadoPct,
      }),
    };
  }

  /**
   * Serie mensual: coste real acumulado (facturas de compra + partes)
   * frente a valor ganado acumulado (importe de periodo de cada
   * certificación) y, si hay partidas con cronograma planificado, el Valor
   * Planificado (PV) acumulado — ver `buildPlannedByPeriod` en `@erp/shared`.
   */
  private async buildCurvaSParaObra(
    projectId: string,
    plannedByPeriod: Map<string, number>,
  ): Promise<ReturnType<typeof buildCurvaS>> {
    const invoiceRows = await this.dbs.db
      .select({ date: invoices.issueDate, amount: invoiceLines.baseAmount })
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
    const personalRows = await this.dbs.db
      .select({
        date: partesPersonal.workDate,
        amount: partesPersonal.totalCost,
      })
      .from(partesPersonal)
      .where(
        and(
          eq(partesPersonal.projectId, projectId),
          isNull(partesPersonal.deletedAt),
        ),
      );
    const maquinariaRows = await this.dbs.db
      .select({
        date: partesMaquinaria.workDate,
        amount: partesMaquinaria.totalCost,
      })
      .from(partesMaquinaria)
      .where(
        and(
          eq(partesMaquinaria.projectId, projectId),
          isNull(partesMaquinaria.deletedAt),
        ),
      );
    const certRows = await this.dbs.db
      .select({
        date: certifications.certDate,
        amount: certifications.periodAmount,
      })
      .from(certifications)
      .where(
        and(
          eq(certifications.projectId, projectId),
          isNull(certifications.deletedAt),
        ),
      );

    const actualByPeriod = new Map<string, number>();
    for (const row of [...invoiceRows, ...personalRows, ...maquinariaRows]) {
      const period = row.date.slice(0, 7);
      actualByPeriod.set(
        period,
        (actualByPeriod.get(period) ?? 0) + Number(row.amount),
      );
    }
    const earnedByPeriod = new Map<string, number>();
    for (const row of certRows) {
      const period = row.date.slice(0, 7);
      earnedByPeriod.set(
        period,
        (earnedByPeriod.get(period) ?? 0) + Number(row.amount),
      );
    }
    return buildCurvaS(actualByPeriod, earnedByPeriod, plannedByPeriod);
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
}
