import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  bankAccounts,
  bankGuarantees,
  certifications,
  checks,
  invoiceLines,
  invoices,
  paymentMilestones,
  purchaseOrders,
  sepaRemittanceItems,
  sepaRemittances,
} from '@erp/db';
import {
  CUENTA_TALONES_TRANSITO,
  addDays,
  centsToNumeric,
  comisionesAvalPrevistas,
  fromCents,
  liquidezQuerySchema,
  normalizarHorizontes,
  proyectarLiquidez,
  todayIso,
  toCents,
  type FlujoLiquidez,
  type LiquidezDto,
  type LiquidezQuery,
} from '@erp/shared';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';
import { reglaBanca } from './comun';

const PEDIDOS_ABIERTOS = ['emitido', 'servido_parcial', 'servido'] as const;
const COL_PEDIDO_ID = sql.raw('"purchase_orders"."id"');

/**
 * Previsión de liquidez (SAP Cash Management / Oracle Cash Positioning) por
 * horizontes y semanas:
 *  - saldo inicial: contable de bancos (572x sin 5729, los talones en
 *    tránsito); con `bankAccountId`, el saldo de la cuenta; por obra, sin saldo;
 *  - cobros y pagos vivos de cartera (atrasados el primer día), talones en
 *    tránsito a su fecha de pago, certificaciones pendientes de facturar y
 *    pedidos de compra comprometidos (con su plazo de cobro o pago) y
 *    comisiones previstas de los avales emitidos vivos.
 * Con `bankAccountId` solo cuentan los flujos asignados a esa cuenta
 * (remesas preparadas, talones y avales de la cuenta). Por obra, solo los de
 * la obra; el rol `obra` solo ve sus obras.
 */
@Injectable()
export class LiquidezService {
  constructor(
    private readonly dbs: DbService,
    private readonly contabilidad: ContabilidadService,
  ) {}

  async prevision(input: LiquidezQuery): Promise<LiquidezDto> {
    const q = liquidezQuerySchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const db = this.dbs.db;
    const desde = q.desde ?? todayIso();
    const horizontes = reglaBanca(() => normalizarHorizontes(q.horizontes));
    const hasta = addDays(desde, horizontes[horizontes.length - 1]);
    const plazoCobroDias = q.plazoCobroDias ?? 60;
    const plazoPagoDias = q.plazoPagoDias ?? 60;

    const accesibles = await this.dbs.getObrasAccesibles();
    if (
      accesibles !== null &&
      (!q.projectId || !accesibles.includes(q.projectId))
    ) {
      throw new ForbiddenException({
        code: 'PROJECT_ACCESS_DENIED',
        message: 'Elige una de tus obras para ver su previsión',
      });
    }
    const obra = q.projectId ?? null;
    const cuenta = obra ? null : (q.bankAccountId ?? null);

    // Saldo inicial.
    let saldoInicial = 0n;
    let transito = 0n;
    let fuenteSaldo: LiquidezDto['fuenteSaldo'] = 'ninguno';
    const cuentas = obra
      ? []
      : await db
          .select({
            id: bankAccounts.id,
            name: bankAccounts.name,
            saldo: bankAccounts.currentBalance,
          })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.companyId, companyId),
              eq(bankAccounts.isActive, true),
              isNull(bankAccounts.deletedAt),
            ),
          );
    if (cuenta) {
      const c = cuentas.find((x) => x.id === cuenta);
      saldoInicial = toCents(c?.saldo ?? '0');
      fuenteSaldo = 'cuenta';
    } else if (!obra) {
      const saldos = await this.contabilidad.saldosAFecha(
        db,
        companyId,
        desde,
        ['572'],
      );
      for (const [codigo, s] of saldos) {
        if (codigo.startsWith(CUENTA_TALONES_TRANSITO)) transito += s;
        else saldoInicial += s;
      }
      fuenteSaldo = 'contable';
    }

    // Factura con alguna línea imputada a la obra.
    const deObra = (facturaId: PgColumn): SQL =>
      exists(
        db
          .select({ x: invoiceLines.id })
          .from(invoiceLines)
          .where(
            and(
              eq(invoiceLines.invoiceId, facturaId),
              eq(invoiceLines.projectId, obra!),
            ),
          ),
      );
    const flujos: FlujoLiquidez[] = [];

    // 1. Cartera: vencimientos vivos (con cuenta: solo los de remesas preparadas de la cuenta).
    const vencimientos = await db
      .select({
        importe: paymentMilestones.amount,
        liquidado: paymentMilestones.settledAmount,
        fecha: paymentMilestones.dueDate,
        direccion: paymentMilestones.direction,
        ejecucion: sepaRemittances.executionDate,
        cuentaRemesa: sepaRemittances.bankAccountId,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .leftJoin(
        sepaRemittanceItems,
        and(
          eq(sepaRemittanceItems.milestoneId, paymentMilestones.id),
          eq(sepaRemittanceItems.status, 'incluida'),
        ),
      )
      .leftJoin(
        sepaRemittances,
        eq(sepaRemittances.id, sepaRemittanceItems.remittanceId),
      )
      .where(
        and(
          eq(paymentMilestones.companyId, companyId),
          eq(paymentMilestones.status, 'previsto'),
          eq(invoices.status, 'aprobada'),
          lte(paymentMilestones.dueDate, hasta),
          ...(obra ? [deObra(invoices.id)] : []),
        ),
      );
    for (const v of vencimientos) {
      if (cuenta && v.cuentaRemesa !== cuenta) continue;
      const pendiente = toCents(v.importe) - toCents(v.liquidado);
      const magnitud = pendiente < 0n ? -pendiente : pendiente;
      if (magnitud === 0n) continue;
      flujos.push({
        fecha: v.ejecucion ?? v.fecha,
        importe: centsToNumeric(v.direccion === 'cobro' ? magnitud : -magnitud),
        categoria: v.direccion === 'cobro' ? 'cobros' : 'pagos',
      });
    }

    // 2. Talones en tránsito: liquidados contra 5729, aún no compensados en el banco.
    const talones = await db
      .select({ c: checks })
      .from(checks)
      .innerJoin(
        paymentMilestones,
        eq(paymentMilestones.id, checks.milestoneId),
      )
      .where(
        and(
          eq(checks.companyId, companyId),
          inArray(checks.status, ['emitido', 'entregado']),
          ...(cuenta ? [eq(checks.bankAccountId, cuenta)] : []),
          ...(obra ? [deObra(paymentMilestones.invoiceId)] : []),
        ),
      );
    for (const { c } of talones) {
      const fecha = c.dueDate ?? c.issueDate;
      if (fecha > hasta) continue;
      const imp = toCents(c.amount);
      flujos.push({
        fecha,
        importe: centsToNumeric(c.direction === 'emitido' ? -imp : imp),
        categoria: 'talones',
      });
    }

    if (!cuenta) {
      // 3. Certificaciones pendientes de facturar: líquido (sin retención) a su plazo de cobro.
      const certs = await db
        .select({
          fecha: certifications.certDate,
          periodo: certifications.periodAmount,
          retencion: certifications.retentionAmount,
        })
        .from(certifications)
        .where(
          and(
            eq(certifications.companyId, companyId),
            eq(certifications.status, 'borrador'),
            isNull(certifications.deletedAt),
            ...(obra ? [eq(certifications.projectId, obra)] : []),
          ),
        );
      for (const c of certs) {
        const liquido = toCents(c.periodo) - toCents(c.retencion ?? '0');
        if (liquido <= 0n) continue;
        flujos.push({
          fecha: addDays(c.fecha, plazoCobroDias),
          importe: centsToNumeric(liquido),
          categoria: 'certificaciones',
        });
      }

      // 4. Pedidos comprometidos: importe − facturado (albaranes o líneas), a su plazo de pago.
      const pedidos = await db
        .select({
          importe: purchaseOrders.amount,
          fecha: sql<string>`coalesce(${purchaseOrders.expectedDate}, ${purchaseOrders.orderDate})`,
          ejecutado: sql<string>`(coalesce((select sum(dn.amount) from delivery_notes dn where dn.order_id = ${COL_PEDIDO_ID} and dn.invoice_id is not null and dn.deleted_at is null), 0)
            + coalesce((select sum(il.base_amount) from invoice_lines il
                join purchase_order_lines pol on pol.id = il.purchase_order_line_id
                join invoices i on i.id = il.invoice_id
                where pol.order_id = ${COL_PEDIDO_ID} and i.status in ('aprobada', 'pagada') and i.deleted_at is null), 0))`,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.companyId, companyId),
            inArray(purchaseOrders.status, [...PEDIDOS_ABIERTOS]),
            isNull(purchaseOrders.deletedAt),
            ...(obra ? [eq(purchaseOrders.projectId, obra)] : []),
          ),
        );
      for (const p of pedidos) {
        const pendiente = toCents(p.importe) - toCents(p.ejecutado);
        if (pendiente <= 0n) continue;
        flujos.push({
          fecha: addDays(p.fecha, plazoPagoDias),
          importe: centsToNumeric(-pendiente),
          categoria: 'compras',
        });
      }
    }

    // 5. Comisiones previstas de los avales emitidos vivos.
    const avales = await db
      .select()
      .from(bankGuarantees)
      .where(
        and(
          eq(bankGuarantees.companyId, companyId),
          eq(bankGuarantees.direction, 'emitido'),
          inArray(bankGuarantees.status, ['vigente', 'liberado_parcial']),
          ...(cuenta ? [eq(bankGuarantees.bankAccountId, cuenta)] : []),
          ...(obra ? [eq(bankGuarantees.projectId, obra)] : []),
        ),
      );
    for (const a of avales) {
      for (const c of comisionesAvalPrevistas({
        emision: a.issueDate,
        vencimiento: a.expiryDate,
        periodoMeses: a.commissionPeriodMonths,
        tasaAnualPct: a.commissionRatePct,
        saldoVivo: a.outstandingAmount,
        desde,
        hasta,
      })) {
        flujos.push({
          fecha: c.fecha,
          importe: -c.importe,
          categoria: 'avales',
        });
      }
    }

    const proyeccion = proyectarLiquidez({
      desde,
      horizontes,
      saldoInicial: centsToNumeric(saldoInicial),
      flujos,
    });
    return {
      ...proyeccion,
      fuenteSaldo,
      saldoTransito5729: fromCents(transito),
      cuentas: cuentas.map((c) => ({
        bankAccountId: c.id,
        nombre: c.name,
        saldo: Number(c.saldo),
      })),
      supuestos: { plazoCobroDias, plazoPagoDias },
    };
  }
}
