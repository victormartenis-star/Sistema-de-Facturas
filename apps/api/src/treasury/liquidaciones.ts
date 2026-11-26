import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  bankAccounts,
  invoices,
  paymentMilestones,
  paymentSettlements,
  type PaymentSettlement,
  type Tx,
} from '@erp/db';
import {
  centsToNumeric,
  importeLiquidacionConSigno,
  invoiceStatusFromMilestones,
  motivoLiquidacionInvalida,
  toCents,
  todayIso,
  type InvoiceStatus,
  type PaymentInstrument,
} from '@erp/shared';
import type { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { verificarVersion } from '../common/version';

/**
 * Núcleo de las liquidaciones (cobros y pagos totales o parciales) de un
 * vencimiento. Funciones sobre una transacción abierta, sin inyección de
 * dependencias: las usan `TreasuryService`, la conciliación bancaria y
 * `InvoicesService` sin dependencias circulares entre módulos.
 *
 * Orden de bloqueo: factura → vencimiento (el mismo que anular y
 * rectificar), para que pagar y anular a la vez no se interbloqueen.
 * Las reglas de importe viven en `@erp/shared` (`motivoLiquidacionInvalida`).
 */

export interface Contexto {
  tx: Tx;
  audit: AuditService;
  companyId: string;
  userId: string | null;
}

export interface DatosLiquidacion {
  /** Magnitud positiva que se cobra o paga. */
  cantidad: number;
  fecha: string;
  bankAccountId?: string | null;
  paymentInstrument?: PaymentInstrument;
  referencia?: string | null;
  notas?: string | null;
  bankTransactionId?: string | null;
  /**
   * Liquidación no monetaria (cartera): aplicación de un anticipo o
   * compensación, con su contrapartida (4380 / 4070 / 5550) y documento.
   */
  noMonetaria?: {
    origen: 'anticipo' | 'compensacion';
    contrapartida: string;
    anticipoId?: string;
    compensacionId?: string;
  };
  /** Talón con que se paga o cobra (se anula solo desde el talón). */
  talonId?: string;
  /** Partida de remesa SEPA (se devuelve solo desde la remesa). */
  remesaPartidaId?: string;
}

function liquidacionBloqueada(): ConflictException {
  return new ConflictException({
    code: 'AR_AP_CLEARING_SETTLEMENT_LOCKED',
    message:
      'La liquidación viene de una compensación o de la aplicación de un anticipo: anúlala desde su documento en la cartera',
  });
}

const FACTURA_LIQUIDABLE: readonly InvoiceStatus[] = [
  'aprobada',
  'pagada',
  'rectificada',
];

function vencimientoNoEncontrado(): NotFoundException {
  return new NotFoundException({
    code: 'DUE_NOT_FOUND',
    message: 'Vencimiento no encontrado',
  });
}

/** Bloquea factura y vencimiento (en ese orden) y los devuelve. */
export async function bloquearVencimiento(
  { tx, companyId }: Contexto,
  milestoneId: string,
) {
  const [ref] = await tx
    .select({ invoiceId: paymentMilestones.invoiceId })
    .from(paymentMilestones)
    .where(
      and(
        eq(paymentMilestones.id, milestoneId),
        eq(paymentMilestones.companyId, companyId),
      ),
    )
    .limit(1);
  if (!ref) throw vencimientoNoEncontrado();
  const [factura] = await tx
    .select({ id: invoices.id, status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, ref.invoiceId))
    .for('update');
  const [vencimiento] = await tx
    .select()
    .from(paymentMilestones)
    .where(eq(paymentMilestones.id, milestoneId))
    .for('update');
  if (!vencimiento || !factura) throw vencimientoNoEncontrado();
  return { factura, vencimiento };
}

/** Recalcula el estado de la factura con la regla pura (pagada si no quedan vencimientos vivos). */
async function sincronizarFactura(
  tx: Tx,
  factura: { id: string; status: string },
): Promise<void> {
  const [vivo] = await tx
    .select({ id: paymentMilestones.id })
    .from(paymentMilestones)
    .where(
      and(
        eq(paymentMilestones.invoiceId, factura.id),
        eq(paymentMilestones.status, 'previsto'),
      ),
    )
    .limit(1);
  const siguiente = invoiceStatusFromMilestones(
    factura.status as InvoiceStatus,
    Boolean(vivo),
  );
  if (siguiente && siguiente !== factura.status) {
    await cambiarEstado(
      tx,
      invoices,
      'invoice',
      factura.id,
      factura.status as InvoiceStatus,
      siguiente,
    );
  }
}

/** Escribe el nuevo liquidado del vencimiento y, si cambia, su estado. */
async function aplicarLiquidado(
  tx: Tx,
  vencimiento: typeof paymentMilestones.$inferSelect,
  nuevoLiquidado: bigint,
  fechaCierre: string | null,
): Promise<void> {
  const completo = nuevoLiquidado === toCents(vencimiento.amount);
  const estado = vencimiento.status;
  const extra = {
    settledAmount: centsToNumeric(nuevoLiquidado),
  };
  if (completo && estado === 'previsto') {
    await cambiarEstado(
      tx,
      paymentMilestones,
      'milestone',
      vencimiento.id,
      'previsto',
      'pagado',
      { ...extra, paidAt: fechaCierre },
      vencimiento.version,
    );
  } else if (!completo && estado === 'pagado') {
    await cambiarEstado(
      tx,
      paymentMilestones,
      'milestone',
      vencimiento.id,
      'pagado',
      'previsto',
      { ...extra, paidAt: null },
      vencimiento.version,
    );
  } else {
    await tx
      .update(paymentMilestones)
      .set({
        ...extra,
        version: sql`${paymentMilestones.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentMilestones.id, vencimiento.id),
          eq(paymentMilestones.version, vencimiento.version),
        ),
      );
  }
}

/**
 * Registra un cobro o pago (total o parcial) contra un vencimiento.
 * Rechazos: 404 `DUE_NOT_FOUND`, 409 `DUE_INVOICE_NOT_PAYABLE`,
 * 409 `DUE_ALREADY_SETTLED`, 422 `SETTLEMENT_EXCEEDS_OUTSTANDING`,
 * 422 `SETTLEMENT_AMOUNT_INVALID`, 422 `SETTLEMENT_DATE_IN_FUTURE`,
 * 422 `ACCOUNT_NOT_FOUND`, 409 `VERSION_CONFLICT`.
 */
export async function registrarLiquidacion(
  ctx: Contexto,
  milestoneId: string,
  datos: DatosLiquidacion,
  versionEsperada?: number,
): Promise<PaymentSettlement> {
  const { tx, companyId } = ctx;
  const { factura, vencimiento } = await bloquearVencimiento(ctx, milestoneId);
  verificarVersion(vencimiento.version, versionEsperada);
  if (!FACTURA_LIQUIDABLE.includes(factura.status as InvoiceStatus)) {
    throw new ConflictException({
      code: 'DUE_INVOICE_NOT_PAYABLE',
      message: `La factura está en estado «${factura.status}»: solo se cobran o pagan facturas aprobadas`,
    });
  }
  const rechazo = motivoLiquidacionInvalida({
    importe: vencimiento.amount,
    liquidado: vencimiento.settledAmount,
    cantidad: datos.cantidad,
    fecha: datos.fecha,
    hoy: todayIso(),
  });
  if (rechazo) {
    throw rechazo.code === 'DUE_ALREADY_SETTLED'
      ? new ConflictException(rechazo)
      : new UnprocessableEntityException(rechazo);
  }
  if (datos.bankAccountId) {
    const [cuenta] = await tx
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, datos.bankAccountId),
          eq(bankAccounts.companyId, companyId),
          eq(bankAccounts.isActive, true),
        ),
      )
      .limit(1);
    if (!cuenta) {
      throw new UnprocessableEntityException({
        code: 'ACCOUNT_NOT_FOUND',
        message: 'La cuenta bancaria no existe o está inactiva',
      });
    }
  }

  const importe = importeLiquidacionConSigno(
    vencimiento.amount,
    datos.cantidad,
  );
  const [liquidacion] = await tx
    .insert(paymentSettlements)
    .values({
      companyId,
      milestoneId,
      amount: centsToNumeric(importe),
      settledOn: datos.fecha,
      bankAccountId: datos.bankAccountId ?? null,
      bankTransactionId: datos.bankTransactionId ?? null,
      paymentInstrument:
        datos.paymentInstrument ??
        (vencimiento.paymentInstrument as PaymentInstrument),
      reference: datos.referencia ?? null,
      notes: datos.notas ?? null,
      source: datos.noMonetaria?.origen ?? 'tesoreria',
      offsetAccount: datos.noMonetaria?.contrapartida ?? null,
      advanceId: datos.noMonetaria?.anticipoId ?? null,
      nettingId: datos.noMonetaria?.compensacionId ?? null,
      checkId: datos.talonId ?? null,
      remittanceItemId: datos.remesaPartidaId ?? null,
      createdBy: ctx.userId,
    })
    .returning();
  const nuevoLiquidado = toCents(vencimiento.settledAmount) + importe;
  await aplicarLiquidado(tx, vencimiento, nuevoLiquidado, datos.fecha);
  await sincronizarFactura(tx, factura);
  await ctx.audit.registrar(tx, [
    {
      entityType: 'payment_settlement',
      entityId: liquidacion.id,
      action: 'create',
      newData: liquidacion,
    },
    {
      entityType: 'payment_milestone',
      entityId: milestoneId,
      action: 'update',
      oldData: {
        settledAmount: vencimiento.settledAmount,
        status: vencimiento.status,
      },
      newData: { settledAmount: centsToNumeric(nuevoLiquidado) },
    },
  ]);
  return liquidacion;
}

/** Liquida todo el saldo vivo de un vencimiento (acción «pagar» de siempre). */
export async function liquidarPendiente(
  ctx: Contexto,
  milestoneId: string,
  extra: Omit<DatosLiquidacion, 'cantidad'>,
  versionEsperada?: number,
): Promise<PaymentSettlement> {
  const [v] = await ctx.tx
    .select({
      amount: paymentMilestones.amount,
      settledAmount: paymentMilestones.settledAmount,
    })
    .from(paymentMilestones)
    .where(
      and(
        eq(paymentMilestones.id, milestoneId),
        eq(paymentMilestones.companyId, ctx.companyId),
      ),
    )
    .limit(1);
  if (!v) throw vencimientoNoEncontrado();
  const pendiente = toCents(v.amount) - toCents(v.settledAmount);
  const magnitud = pendiente < 0n ? -pendiente : pendiente;
  return registrarLiquidacion(
    ctx,
    milestoneId,
    { ...extra, cantidad: Number(magnitud) / 100 },
    versionEsperada,
  );
}

/**
 * Anula una liquidación vigente: deja de contar en el liquidado y, si el
 * vencimiento estaba cerrado, lo reabre. Rechazos: 404 `SETTLEMENT_NOT_FOUND`,
 * 409 `SETTLEMENT_ALREADY_CANCELLED`, 409 `VERSION_CONFLICT`.
 */
export async function anularLiquidacion(
  ctx: Contexto,
  settlementId: string,
  motivo: string,
  versionEsperada?: number,
  /** Solo la cartera, al anular el anticipo o la compensación de origen. */
  desdeDocumento = false,
): Promise<PaymentSettlement> {
  const { tx, companyId } = ctx;
  const [actual] = await tx
    .select()
    .from(paymentSettlements)
    .where(
      and(
        eq(paymentSettlements.id, settlementId),
        eq(paymentSettlements.companyId, companyId),
      ),
    )
    .limit(1);
  if (!actual) {
    throw new NotFoundException({
      code: 'SETTLEMENT_NOT_FOUND',
      message: 'Liquidación no encontrada',
    });
  }
  if (actual.source !== 'tesoreria' && !desdeDocumento) {
    throw liquidacionBloqueada();
  }
  if (actual.checkId && !desdeDocumento) {
    throw new ConflictException({
      code: 'CHECK_SETTLEMENT_LOCKED',
      message:
        'La liquidación se hizo con un talón: anúlalo, detenlo o devuélvelo desde Talones',
    });
  }
  if (actual.remittanceItemId && !desdeDocumento) {
    throw new ConflictException({
      code: 'SEPA_SETTLEMENT_LOCKED',
      message:
        'La liquidación es de una remesa SEPA: registra la devolución de la partida desde Remesas',
    });
  }
  const { factura, vencimiento } = await bloquearVencimiento(
    ctx,
    actual.milestoneId,
  );
  verificarVersion(actual.version, versionEsperada);
  if (actual.status === 'anulada') {
    throw new ConflictException({
      code: 'SETTLEMENT_ALREADY_CANCELLED',
      message: 'La liquidación ya está anulada',
    });
  }
  const anulada = await cambiarEstado(
    tx,
    paymentSettlements,
    'settlement',
    settlementId,
    'vigente',
    'anulada',
    {
      reversalReason: motivo.slice(0, 240),
      reversedAt: new Date(),
      reversedBy: ctx.userId,
    },
    actual.version,
  );
  const nuevoLiquidado =
    toCents(vencimiento.settledAmount) - toCents(actual.amount);
  await aplicarLiquidado(tx, vencimiento, nuevoLiquidado, null);
  await sincronizarFactura(tx, factura);
  await ctx.audit.registrar(tx, [
    {
      entityType: 'payment_settlement',
      entityId: settlementId,
      action: 'update',
      oldData: { status: 'vigente' },
      newData: { status: 'anulada', motivo },
    },
    {
      entityType: 'payment_milestone',
      entityId: vencimiento.id,
      action: 'update',
      oldData: {
        settledAmount: vencimiento.settledAmount,
        status: vencimiento.status,
      },
      newData: { settledAmount: centsToNumeric(nuevoLiquidado) },
    },
  ]);
  return anulada;
}

/** Anula todas las liquidaciones vigentes del vencimiento (acción «reabrir»). Devuelve cuántas. */
export async function anularTodas(
  ctx: Contexto,
  milestoneId: string,
  motivo: string,
): Promise<number> {
  const vigentes = await ctx.tx
    .select({ id: paymentSettlements.id })
    .from(paymentSettlements)
    .where(
      and(
        eq(paymentSettlements.milestoneId, milestoneId),
        eq(paymentSettlements.companyId, ctx.companyId),
        eq(paymentSettlements.status, 'vigente'),
      ),
    );
  for (const { id } of vigentes) await anularLiquidacion(ctx, id, motivo);
  return vigentes.length;
}
