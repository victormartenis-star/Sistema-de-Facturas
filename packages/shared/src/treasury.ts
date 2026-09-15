/**
 * Tesorería: vencimientos (cobros y pagos previstos) y previsión de
 * flujo de caja agrupada por semanas o meses, con alerta de tensión
 * cuando el saldo acumulado del periodo es negativo.
 */

import { z } from 'zod';

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

export interface MilestoneDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  contactName: string;
  direction: MilestoneDirection;
  kind: MilestoneKind;
  dueDate: string;
  amount: number;
  status: MilestoneStatus;
  paidAt: string | null;
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
