/**
 * Tesorería: vencimientos (cobros y pagos previstos) y previsión de
 * flujo de caja agrupada por semanas o meses, con alerta de tensión
 * cuando el saldo acumulado del periodo es negativo.
 */

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
  saldoFinal: number;
  /** Número de periodos con tensión de caja. */
  alertas: number;
}
