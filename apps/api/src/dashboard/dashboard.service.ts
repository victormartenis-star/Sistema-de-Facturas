import { Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lt, sql, sum } from 'drizzle-orm';
import {
  certifications,
  invoices,
  paymentMilestones,
  projects,
  purchaseOrders,
} from '@erp/db';
import { round2 } from '@erp/shared';
import { DbService } from '../db/db.service';

export interface DashboardResumenDto {
  obras: {
    total: number;
    enCurso: number;
    contratado: number;
  };
  certificaciones: {
    totalCertificado: number;
    retencionAcumulada: number;
    certsPendientesFacturar: number;
  };
  tesoreria: {
    pendienteCobro: number;
    pendientePago: number;
    vencidoCobro: number;
    vencidoPago: number;
  };
  compras: {
    pedidosPendientes: number;
    importePedidosPendientes: number;
  };
  facturas: {
    ventaBorradores: number;
    compraBorradores: number;
  };
}

@Injectable()
export class DashboardService {
  constructor(private readonly dbs: DbService) {}

  async resumen(): Promise<DashboardResumenDto> {
    const companyId = this.dbs.getCompanyId();
    const today = new Date().toISOString().slice(0, 10);

    // ── Obras ──────────────────────────────────────────────────────────────
    const allProjects = await this.dbs.db
      .select({
        status: projects.status,
        contractAmount: projects.contractAmount,
      })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), isNull(projects.deletedAt)));

    const totalObras = allProjects.length;
    const enCurso = allProjects.filter((p) => p.status === 'en_curso');
    const contratado = enCurso.reduce(
      (s, p) => s + (p.contractAmount !== null ? Number(p.contractAmount) : 0),
      0,
    );

    // ── Certificaciones ────────────────────────────────────────────────────
    const certRows = await this.dbs.db
      .select({
        periodAmount: certifications.periodAmount,
        retentionAmount: certifications.retentionAmount,
        status: certifications.status,
      })
      .from(certifications)
      .where(
        and(
          eq(certifications.companyId, companyId),
          isNull(certifications.deletedAt),
        ),
      );

    const totalCertificado = certRows.reduce(
      (s, c) => s + Number(c.periodAmount),
      0,
    );
    const retencionAcumulada = certRows.reduce(
      (s, c) => s + Number(c.retentionAmount),
      0,
    );
    const certsPendientesFacturar = certRows.filter(
      (c) => c.status === 'borrador',
    ).length;

    // ── Tesorería ──────────────────────────────────────────────────────────
    const milestonesRows = await this.dbs.db
      .select({
        direction: paymentMilestones.direction,
        dueDate: paymentMilestones.dueDate,
        amount: paymentMilestones.amount,
        status: paymentMilestones.status,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(paymentMilestones.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(paymentMilestones.status, 'previsto'),
          isNull(invoices.deletedAt),
        ),
      );

    let pendienteCobro = 0;
    let pendientePago = 0;
    let vencidoCobro = 0;
    let vencidoPago = 0;

    for (const m of milestonesRows) {
      const amt = Number(m.amount);
      const vencido = m.dueDate < today;
      if (m.direction === 'cobro') {
        pendienteCobro += amt;
        if (vencido) vencidoCobro += amt;
      } else {
        pendientePago += amt;
        if (vencido) vencidoPago += amt;
      }
    }

    // ── Compras (pedidos) ──────────────────────────────────────────────────
    const pedidosRows = await this.dbs.db
      .select({
        amount: purchaseOrders.amount,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      );

    const pedidosPendientes = pedidosRows.filter(
      (p) => p.status === 'emitido' || p.status === 'servido_parcial',
    );

    // ── Facturas ───────────────────────────────────────────────────────────
    const facturaRows = await this.dbs.db
      .select({ kind: invoices.kind, status: invoices.status })
      .from(invoices)
      .where(
        and(eq(invoices.companyId, companyId), isNull(invoices.deletedAt)),
      );

    const ventaBorradores = facturaRows.filter(
      (f) => f.kind === 'venta' && f.status === 'borrador',
    ).length;
    const compraBorradores = facturaRows.filter(
      (f) => f.kind === 'compra' && f.status === 'borrador',
    ).length;

    return {
      obras: {
        total: totalObras,
        enCurso: enCurso.length,
        contratado: round2(contratado),
      },
      certificaciones: {
        totalCertificado: round2(totalCertificado),
        retencionAcumulada: round2(retencionAcumulada),
        certsPendientesFacturar,
      },
      tesoreria: {
        pendienteCobro: round2(pendienteCobro),
        pendientePago: round2(pendientePago),
        vencidoCobro: round2(vencidoCobro),
        vencidoPago: round2(vencidoPago),
      },
      compras: {
        pedidosPendientes: pedidosPendientes.length,
        importePedidosPendientes: round2(
          pedidosPendientes.reduce((s, p) => s + Number(p.amount ?? 0), 0),
        ),
      },
      facturas: {
        ventaBorradores,
        compraBorradores,
      },
    };
  }
}
