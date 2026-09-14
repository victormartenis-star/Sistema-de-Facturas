import { z } from 'zod';
import { round2 } from './calculo';

/**
 * Comparativos de ofertas y adjudicación de subcontratas (Fase 10).
 *
 * Un comparativo cubre una fase/capítulo de obra: la matriz de precios es
 * "una fila por partida de esa fase (de `budget_items`), una columna por
 * oferta de proveedor". Al adjudicar, se genera automáticamente un pedido
 * (`purchase_orders`) en estado `emitido` — ese estado ya hace de borrador
 * en el ciclo de compras existente, no hace falta un estado nuevo.
 */

export const COMPARATIVO_STATUSES = [
  'abierto',
  'adjudicado',
  'cancelado',
] as const;
export type ComparativoStatus = (typeof COMPARATIVO_STATUSES)[number];

export const COMPARATIVO_STATUS_LABELS: Record<ComparativoStatus, string> = {
  abierto: 'Abierto',
  adjudicado: 'Adjudicado',
  cancelado: 'Cancelado',
};

/* ────────────────────── esquemas de entrada ────────────────────── */

export const comparativoCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  phaseId: z.string().uuid('El capítulo/fase es obligatorio'),
  title: z
    .string()
    .trim()
    .min(1, 'El título es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  notes: z.string().trim().max(2000).nullish(),
});

export const comparativoUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).nullish(),
});

export type ComparativoCreateInput = z.input<typeof comparativoCreateSchema>;
export type ComparativoUpdateInput = z.input<typeof comparativoUpdateSchema>;

const ofertaLineaSchema = z.object({
  budgetItemId: z.string().uuid('Partida no válida'),
  unitPrice: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(999_999_999.9999),
  /** Medición ofertada; si no se indica, se usa la de la partida del presupuesto. */
  quantity: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(999_999_999.9999)
    .nullish(),
});

export const comparativoOfertaCreateSchema = z.object({
  contactId: z.string().uuid('El proveedor es obligatorio'),
  leadTimeDays: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .int('Debe ser un número entero de días')
    .nonnegative('No puede ser negativo')
    .nullish(),
  paymentTerms: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Precio ofertado por partida; las partidas sin precio quedan sin cubrir. */
  lineas: z
    .array(ofertaLineaSchema)
    .min(1, 'Añade el precio de al menos una partida'),
});

export const comparativoOfertaUpdateSchema = comparativoOfertaCreateSchema
  .omit({ contactId: true })
  .partial();

export type ComparativoOfertaCreateInput = z.input<
  typeof comparativoOfertaCreateSchema
>;
export type ComparativoOfertaUpdateInput = z.input<
  typeof comparativoOfertaUpdateSchema
>;

export const comparativoAdjudicarSchema = z.object({
  ofertaId: z.string().uuid('Selecciona la oferta ganadora'),
  /** Fecha del pedido/subcontrata generado; por defecto, hoy. */
  orderDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD')
    .nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type ComparativoAdjudicarInput = z.input<
  typeof comparativoAdjudicarSchema
>;

/* ─────────────────────────────── DTOs ─────────────────────────────── */

export interface ComparativoDto {
  id: string;
  projectId: string;
  phaseId: string;
  phaseCode: string;
  phaseName: string;
  title: string;
  status: ComparativoStatus;
  awardedAt: string | null;
  purchaseOrderId: string | null;
  notes: string | null;
  ofertaCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComparativoOfertaDto {
  id: string;
  comparativoId: string;
  contactId: string;
  contactName: string;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  isAwarded: boolean;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Una partida de la fase comparada (una fila de la matriz). */
export interface ComparativoMatrizPartidaDto {
  budgetItemId: string;
  code: string;
  name: string;
  unit: string;
  targetQuantity: number;
  targetUnitPrice: number;
  targetTotal: number;
}

/** Precio ofertado por una oferta para una partida (una celda de la matriz). */
export interface ComparativoMatrizCeldaDto {
  budgetItemId: string;
  unitPrice: number | null;
  quantity: number | null;
  totalAmount: number | null;
}

/** Una columna de la matriz: la oferta completa con todas sus celdas. */
export interface ComparativoMatrizOfertaDto {
  ofertaId: string;
  contactId: string;
  contactName: string;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  isAwarded: boolean;
  totalAmount: number;
  deviationVsTarget: number;
  deviationVsTargetPct: number | null;
  celdas: ComparativoMatrizCeldaDto[];
}

/** La matriz comparativa completa: filas = partidas, columnas = ofertas. */
export interface ComparativoMatrizDto {
  comparativoId: string;
  title: string;
  status: ComparativoStatus;
  projectId: string;
  phaseId: string;
  phaseCode: string;
  phaseName: string;
  targetTotal: number;
  partidas: ComparativoMatrizPartidaDto[];
  ofertas: ComparativoMatrizOfertaDto[];
  /** Id de la oferta más económica (por importe total); null si no hay ninguna. */
  cheapestOfertaId: string | null;
}

/* ────────────────────── lógica pura ────────────────────── */

/** Importe de una línea de oferta: precio unitario × medición. */
export function computeLineTotal(unitPrice: number, quantity: number): number {
  return round2(unitPrice * quantity);
}

/** Importe total de una oferta: suma de sus líneas. */
export function computeOfertaTotal(lineTotals: number[]): number {
  return round2(lineTotals.reduce((sum, v) => sum + v, 0));
}

/** Desviación de una oferta frente al precio objetivo (presupuesto de la fase). */
export function computeDeviationVsTarget(
  offerTotal: number,
  targetTotal: number,
): { deviation: number; deviationPct: number | null } {
  const deviation = round2(offerTotal - targetTotal);
  return {
    deviation,
    deviationPct:
      targetTotal > 0 ? round2((deviation / targetTotal) * 100) : null,
  };
}

/**
 * Id de la oferta más económica por importe total. En empate, la primera
 * de la lista (orden estable). `null` si no hay ninguna oferta.
 */
export function findCheapestOfertaId(
  ofertas: { ofertaId: string; totalAmount: number }[],
): string | null {
  if (ofertas.length === 0) return null;
  return ofertas.reduce((min, o) => (o.totalAmount < min.totalAmount ? o : min))
    .ofertaId;
}
