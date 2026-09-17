import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  budgetItems,
  budgets,
  certifications,
  invoiceLines,
  invoices,
  partesMaquinaria,
  partesPersonal,
  projectPhases,
  projects,
} from '@erp/db';
import {
  CostControlDto,
  FasePlanificadaInput,
  SobrecostePartidaInput,
  buildCurvaS,
  buildPlannedByPeriod,
  computeCostControl,
  computeSobrecostePorPartida,
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
          ne(invoices.status, 'anulada'),
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
