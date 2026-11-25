/**
 * Tesorería: vencimientos (cobros y pagos previstos) y previsión de
 * flujo de caja agrupada por semanas o meses, con alerta de tensión
 * cuando el saldo acumulado del periodo es negativo.
 */

import { z } from 'zod';
import { type EstadoLiquidacion } from './calculo';
import { type Transiciones } from './maquina-estados';

export const MILESTONE_DIRECTIONS = ['cobro', 'pago'] as const;
export type MilestoneDirection = (typeof MILESTONE_DIRECTIONS)[number];

export const MILESTONE_DIRECTION_LABELS: Record<MilestoneDirection, string> = {
  cobro: 'Cobro',
  pago: 'Pago',
};

export const MILESTONE_KINDS = ['ordinario', 'retencion'] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = {
  ordinario: 'Ordinario',
  retencion: 'Retención de garantía',
};

export const MILESTONE_STATUSES = ['previsto', 'pagado'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  previsto: 'Previsto',
  pagado: 'Liquidado',
};

/** Vencimiento: previsto ↔ pagado (reabrir un vencimiento liquidado es legal). */
export const MILESTONE_TRANSITIONS: Transiciones<MilestoneStatus> = {
  previsto: ['pagado'],
  pagado: ['previsto'],
};

/**
 * Instrumento de cobro/pago de un vencimiento — informativo, se marca a
 * mano (el ERP no integra con el banco). Sirve para cruzar en tesorería
 * los pagos aplazados vía confirming/pagaré frente al resto.
 */
export const PAYMENT_INSTRUMENTS = [
  'transferencia',
  'confirming',
  'pagare',
  'efectivo',
  'domiciliacion',
] as const;
export type PaymentInstrument = (typeof PAYMENT_INSTRUMENTS)[number];

export const PAYMENT_INSTRUMENT_LABELS: Record<PaymentInstrument, string> = {
  transferencia: 'Transferencia',
  confirming: 'Confirming',
  pagare: 'Pagaré',
  efectivo: 'Efectivo',
  domiciliacion: 'Domiciliación',
};

export const setPaymentInstrumentSchema = z.object({
  paymentInstrument: z.enum(PAYMENT_INSTRUMENTS),
});
export type SetPaymentInstrumentInput = z.input<
  typeof setPaymentInstrumentSchema
>;

export interface MilestoneDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  contactName: string;
  direction: MilestoneDirection;
  kind: MilestoneKind;
  paymentInstrument: PaymentInstrument;
  /** true si el cobro proviene de una certificación de obra (`certifications.invoiceId`). */
  fromCertification: boolean;
  dueDate: string;
  amount: number;
  status: MilestoneStatus;
  paidAt: string | null;
  /** Liquidado acumulado (cobros/pagos vigentes), con el signo del importe. */
  settledAmount: number;
  /** Saldo vivo: importe − liquidado. Es lo que cuenta en previsiones y cruces. */
  pendingAmount: number;
  settlementState: EstadoLiquidacion;
  /** Versión para If-Match al liquidar. */
  version: number;
}

/* ─────────────── liquidaciones (cobros y pagos totales o parciales) ─────────────── */

export const SETTLEMENT_STATUSES = ['vigente', 'anulada'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  vigente: 'Vigente',
  anulada: 'Anulada',
};

/** Una liquidación no se edita ni se borra: se anula (terminal). */
export const SETTLEMENT_TRANSITIONS: Transiciones<SettlementStatus> = {
  vigente: ['anulada'],
  anulada: [],
};

export const SETTLEMENT_STATE_LABELS: Record<EstadoLiquidacion, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  liquidado: 'Liquidado',
};

const fechaLiquidacion = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

export const settlementCreateSchema = z.object({
  /** Magnitud positiva que se cobra o paga (el signo lo pone el vencimiento). */
  importe: z
    .number()
    .finite()
    .positive('El importe debe ser mayor que cero')
    .max(9_999_999_999.99)
    .refine(
      (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
      'Como máximo dos decimales',
    ),
  fecha: fechaLiquidacion,
  bankAccountId: z.string().uuid().nullish(),
  paymentInstrument: z.enum(PAYMENT_INSTRUMENTS).optional(),
  referencia: z.string().trim().max(80).nullish(),
  notas: z.string().trim().max(500).nullish(),
});
export type SettlementCreateInput = z.input<typeof settlementCreateSchema>;

export const settlementCancelSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type SettlementCancelInput = z.input<typeof settlementCancelSchema>;

export interface SettlementDto {
  id: string;
  milestoneId: string;
  /** Con el signo del vencimiento (negativo en rectificativas). */
  amount: number;
  settledOn: string;
  status: SettlementStatus;
  bankAccountId: string | null;
  bankAccountName: string | null;
  bankTransactionId: string | null;
  paymentInstrument: PaymentInstrument;
  reference: string | null;
  notes: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
  createdAt: string;
  version: number;
  /**
   * `tesoreria` (caja) o no monetaria: aplicación de anticipo o
   * compensación (se anulan desde su documento en la cartera).
   */
  origen?: 'tesoreria' | 'anticipo' | 'compensacion';
}

export interface MilestoneDetailDto extends MilestoneDto {
  settlements: SettlementDto[];
}

/**
 * Cruce de vencimientos: cobros por certificación de obra frente a otros
 * cobros, y pagos aplazados (confirming/pagaré) frente al resto — la
 * pregunta real de tesorería en construcción es si lo que se espera cobrar
 * de las certificaciones llega a tiempo de cubrir lo que ya está
 * comprometido a pagar más adelante por confirming/pagaré.
 */
export interface MaturityGroupDto {
  total: number;
  items: MilestoneDto[];
}

export interface CrossedMaturitiesReportDto {
  from: string;
  to: string;
  cobrosPorCertificacion: MaturityGroupDto;
  cobrosOtros: MaturityGroupDto;
  pagosConfirmingPagare: MaturityGroupDto;
  pagosOtros: MaturityGroupDto;
}

export const CASHFLOW_GROUPINGS = ['semana', 'mes'] as const;
export type CashflowGrouping = (typeof CASHFLOW_GROUPINGS)[number];

export interface CashflowBucketDto {
  /** Primer día del periodo (AAAA-MM-DD). */
  periodStart: string;
  label: string;
  cobros: number;
  pagos: number;
  neto: number;
  /** Saldo acumulado desde el inicio del horizonte. */
  saldoAcumulado: number;
  /** true si el saldo acumulado queda en negativo: tensión de caja. */
  tension: boolean;
}

export interface CashflowReportDto {
  from: string;
  to: string;
  groupBy: CashflowGrouping;
  buckets: CashflowBucketDto[];
  totalCobros: number;
  totalPagos: number;
  /** Suma de saldos de las cuentas bancarias/caja activas al arrancar la proyección. */
  saldoInicial: number;
  saldoFinal: number;
  /** Número de periodos con tensión de caja. */
  alertas: number;
}

/* ─────────────────────── cuentas bancarias y caja ─────────────────────── */

export const BANK_ACCOUNT_KINDS = ['banco', 'caja'] as const;
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number];

export const BANK_ACCOUNT_KIND_LABELS: Record<BankAccountKind, string> = {
  banco: 'Cuenta bancaria',
  caja: 'Caja',
};

export const bankAccountCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  kind: z.enum(BANK_ACCOUNT_KINDS).default('banco'),
  iban: z.string().trim().max(34).nullish(),
  currentBalance: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .max(999_999_999_999.99)
    .default(0),
  isActive: z.boolean().default(true),
});

export const bankAccountUpdateSchema = bankAccountCreateSchema.partial();

export type BankAccountCreateInput = z.input<typeof bankAccountCreateSchema>;
export type BankAccountUpdateInput = z.input<typeof bankAccountUpdateSchema>;

export interface BankAccountDto {
  id: string;
  name: string;
  kind: BankAccountKind;
  iban: string | null;
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ───────────────────── proyección de iliquidez 30/60/90 ───────────────────── */

export const ILLIQUIDITY_HORIZONS = [30, 60, 90] as const;
export type IlliquidityHorizon = (typeof ILLIQUIDITY_HORIZONS)[number];

export interface IlliquidityHorizonDto {
  horizon: IlliquidityHorizon;
  to: string;
  saldoFinal: number;
  /** true si en algún periodo dentro del horizonte el saldo acumulado queda en negativo. */
  tension: boolean;
  /** Primer día, si lo hay, en el que el saldo acumulado queda en negativo. */
  primeraTensionEn: string | null;
}

export interface IlliquidityProjectionDto {
  from: string;
  saldoInicial: number;
  horizontes: IlliquidityHorizonDto[];
}
