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

/* ────────────────────── recomendaciones de ahorro (Fase 15) ────────────────────── */

/**
 * Una línea de oferta ya vista, aplanada para el análisis: qué partida
 * (por `budget_items.code`, no por id — el mismo código BC3/manual puede
 * repetirse en presupuestos distintos de obras distintas, y es lo que
 * permite comparar "este mismo material/trabajo" entre obras), a qué precio,
 * en qué obra, de qué proveedor, y si esa oferta es la que se adjudicó (el
 * precio que de verdad se paga) o solo una oferta recibida.
 */
export interface SavingsObservation {
  budgetItemCode: string;
  budgetItemName: string;
  unitPrice: number;
  quantity: number;
  projectId: string;
  projectName: string;
  contactId: string;
  contactName: string;
  isAwarded: boolean;
}

export interface SavingsOpportunityDto {
  budgetItemCode: string;
  budgetItemName: string;
  paidProjectId: string;
  paidProjectName: string;
  paidContactId: string;
  paidContactName: string;
  paidUnitPrice: number;
  minUnitPrice: number;
  minProjectId: string;
  minProjectName: string;
  minContactId: string;
  minContactName: string;
  /** % de sobreprecio del pagado sobre el mínimo visto para el mismo código. */
  overpayPct: number;
  /** Ahorro potencial en € si se hubiera pagado el mínimo, a la medición realmente adjudicada. */
  potentialSavingsAmount: number;
}

export const SAVINGS_THRESHOLD_PCT_DEFAULT = 10;

/** Cuerpo de `POST /comparativos/ahorro/resumen`: la lista ya calculada, no recalculada. */
export const savingsResumenSchema = z.object({
  opportunities: z
    .array(
      z.object({
        budgetItemCode: z.string(),
        budgetItemName: z.string(),
        paidProjectId: z.string(),
        paidProjectName: z.string(),
        paidContactId: z.string(),
        paidContactName: z.string(),
        paidUnitPrice: z.number(),
        minUnitPrice: z.number(),
        minProjectId: z.string(),
        minProjectName: z.string(),
        minContactId: z.string(),
        minContactName: z.string(),
        overpayPct: z.number(),
        potentialSavingsAmount: z.number(),
      }),
    )
    .max(200),
});
export type SavingsResumenInput = z.input<typeof savingsResumenSchema>;

/**
 * Detecta partidas donde el precio unitario **pagado** (de una oferta
 * adjudicada) supera claramente el mínimo unitario visto para el mismo
 * código de partida en cualquier otra oferta de la empresa — de la misma
 * obra o de otra. Puramente aritmético, sin IA: agrupa por código, calcula
 * el mínimo del grupo, y para cada línea adjudicada que se pase del umbral
 * (`thresholdPct`, por defecto `SAVINGS_THRESHOLD_PCT_DEFAULT`) frente a ese
 * mínimo, genera una oportunidad con la referencia de dónde se vio el
 * precio más bajo. Ordenado de mayor a menor sobreprecio.
 */
export function computeSavingsOpportunities(
  observations: SavingsObservation[],
  thresholdPct: number = SAVINGS_THRESHOLD_PCT_DEFAULT,
): SavingsOpportunityDto[] {
  const byCode = new Map<string, SavingsObservation[]>();
  for (const obs of observations) {
    const list = byCode.get(obs.budgetItemCode) ?? [];
    list.push(obs);
    byCode.set(obs.budgetItemCode, list);
  }

  const opportunities: SavingsOpportunityDto[] = [];
  for (const group of byCode.values()) {
    const cheapest = group.reduce((min, o) =>
      o.unitPrice < min.unitPrice ? o : min,
    );
    if (cheapest.unitPrice <= 0) continue;

    for (const paid of group) {
      if (!paid.isAwarded) continue;
      if (
        paid.contactId === cheapest.contactId &&
        paid.projectId === cheapest.projectId
      ) {
        continue; // es el propio mínimo, no hay hueco que señalar
      }
      const overpayPct = round2(
        ((paid.unitPrice - cheapest.unitPrice) / cheapest.unitPrice) * 100,
      );
      if (overpayPct <= thresholdPct) continue;

      opportunities.push({
        budgetItemCode: paid.budgetItemCode,
        budgetItemName: paid.budgetItemName,
        paidProjectId: paid.projectId,
        paidProjectName: paid.projectName,
        paidContactId: paid.contactId,
        paidContactName: paid.contactName,
        paidUnitPrice: paid.unitPrice,
        minUnitPrice: cheapest.unitPrice,
        minProjectId: cheapest.projectId,
        minProjectName: cheapest.projectName,
        minContactId: cheapest.contactId,
        minContactName: cheapest.contactName,
        overpayPct,
        potentialSavingsAmount: round2(
          (paid.unitPrice - cheapest.unitPrice) * paid.quantity,
        ),
      });
    }
  }

  return opportunities.sort((a, b) => b.overpayPct - a.overpayPct);
}
