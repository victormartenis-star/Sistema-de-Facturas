import { z } from 'zod';
import { amountsMatch, round2 } from './calculo';

/**
 * Pedidos de compra.
 *
 * Es la pieza central del procedimiento de compras: el punto en el que el
 * coste se compromete y el único momento en el que todavía se puede parar una
 * compra no controlada —antes de que el material llegue a obra, no cuando la
 * factura ya está registrada—.
 */

export const PURCHASE_ORDER_STATUSES = [
  'emitido',
  'servido_parcial',
  'servido',
  'facturado',
  'cerrado',
  'anulado',
] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> =
  {
    emitido: 'Emitido',
    servido_parcial: 'Servido parcialmente',
    servido: 'Servido',
    facturado: 'Facturado',
    cerrado: 'Cerrado',
    anulado: 'Anulado',
  };

/* ─────────────────────────── numeración ─────────────────────────── */

/**
 * Número de pedido: código de obra + correlativo propio de esa obra.
 *
 *   OBR-045 + 32 → OBR-045-PED-0032
 *
 * El correlativo es por obra, no global: así el número dice a qué obra
 * pertenece el pedido sin tener que consultarlo en ningún sitio.
 */
export function buildOrderNumber(projectCode: string, seq: number): string {
  return `${projectCode}-PED-${String(seq).padStart(4, '0')}`;
}

/** Extrae el correlativo de un número de pedido; null si no tiene el formato. */
export function parseOrderSeq(orderNumber: string): number | null {
  const match = /-PED-(\d{4,})$/.exec(orderNumber.trim());
  return match ? Number(match[1]) : null;
}

/* ───────────────────────── regla de oro ───────────────────────── */

/**
 * Estados en los que un pedido admite que le lleguen albaranes. Un pedido
 * cerrado o anulado ya no recibe material: si llega, es una incidencia.
 */
const RECEIVING_STATUSES: PurchaseOrderStatus[] = [
  'emitido',
  'servido_parcial',
  'servido',
];

export function canReceiveDeliveries(status: PurchaseOrderStatus): boolean {
  return RECEIVING_STATUSES.includes(status);
}

/** Motivo por el que un albarán no puede validarse, o null si puede. */
export function deliveryNoteBlockReason(note: {
  orderNumber: string | null;
  orderStatus: PurchaseOrderStatus | null;
}): string | null {
  if (!note.orderNumber || !note.orderStatus) {
    // Texto tipo del manual de procesos, para que el albarán y el sistema
    // digan exactamente lo mismo.
    return 'Pendiente de validación. Falta número de pedido.';
  }
  if (!canReceiveDeliveries(note.orderStatus)) {
    return `El pedido ${note.orderNumber} está ${PURCHASE_ORDER_STATUS_LABELS[
      note.orderStatus
    ].toLowerCase()}: no debería recibir más material`;
  }
  return null;
}

/**
 * Estado que le corresponde a un pedido según lo que se le ha servido.
 *
 * Se deriva de los albaranes en lugar de fijarse a mano: un estado que se
 * teclea se queda obsoleto el primer día que alguien olvida cambiarlo.
 * Los estados terminales (facturado, cerrado, anulado) no se recalculan.
 */
export function deriveOrderStatus(
  current: PurchaseOrderStatus,
  orderAmount: number,
  deliveredAmount: number,
): PurchaseOrderStatus {
  if (
    current === 'facturado' ||
    current === 'cerrado' ||
    current === 'anulado'
  ) {
    return current;
  }
  if (deliveredAmount <= 0) return 'emitido';
  if (
    amountsMatch(deliveredAmount, orderAmount) ||
    deliveredAmount > orderAmount
  )
    return 'servido';
  return 'servido_parcial';
}

/** Importe del pedido pendiente de servir (nunca negativo). */
export function pendingToDeliver(
  orderAmount: number,
  deliveredAmount: number,
): number {
  return round2(Math.max(0, orderAmount - deliveredAmount));
}

/* ────────────────────── esquemas de entrada ────────────────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const purchaseOrderCreateSchema = z
  .object({
    projectId: z.string().uuid('La obra es obligatoria'),
    contactId: z.string().uuid('El proveedor es obligatorio'),
    orderDate: isoDate,
    phaseId: z.string().uuid('Capítulo no válido').nullish(),
    categoryId: z.string().uuid('Categoría no válida').nullish(),
    description: z
      .string()
      .trim()
      .min(1, 'Describe qué se pide')
      .max(500, 'Máximo 500 caracteres'),
    amount: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .nonnegative('No puede ser negativo')
      .max(999_999_999_999.99),
    expectedDate: isoDate.nullish(),
    requestedBy: z.string().trim().max(120).nullish(),
    urgent: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((o) => !o.expectedDate || o.expectedDate >= o.orderDate, {
    message: 'La entrega no puede ser anterior a la fecha del pedido',
    path: ['expectedDate'],
  });

export const purchaseOrderUpdateSchema = purchaseOrderCreateSchema
  .innerType()
  .partial()
  .omit({ projectId: true });

export type PurchaseOrderCreateInput = z.input<
  typeof purchaseOrderCreateSchema
>;
export type PurchaseOrderUpdateInput = z.input<
  typeof purchaseOrderUpdateSchema
>;

/* ─────────────────────────────── DTOs ─────────────────────────────── */

export interface PurchaseOrderDto {
  id: string;
  orderNumber: string;
  seq: number;
  projectId: string;
  projectCode: string;
  projectName: string;
  contactId: string;
  contactName: string;
  orderDate: string;
  phaseId: string | null;
  phaseCode: string | null;
  categoryId: string | null;
  description: string;
  amount: number;
  expectedDate: string | null;
  /** Días de retraso sobre la fecha comprometida; 0 si aún no ha vencido. */
  daysLate: number;
  requestedBy: string | null;
  status: PurchaseOrderStatus;
  urgent: boolean;
  /** Suma de los albaranes imputados al pedido. */
  deliveredAmount: number;
  /** Suma de los albaranes ya facturados. */
  invoicedAmount: number;
  pendingToDeliver: number;
  /** Recibido y todavía sin factura: la provisión del cierre mensual. */
  pendingToInvoice: number;
  deliveryNoteCount: number;
  notes: string | null;
  createdAt: string;
}

/** Una fila del cuadro de trazabilidad mensual por obra. */
export interface TraceabilityRowDto {
  orderId: string;
  orderNumber: string;
  contactName: string;
  amount: number;
  hasDeliveryNote: boolean;
  hasInvoice: boolean;
  deliveredAmount: number;
  invoicedAmount: number;
  /** Importe recibido sin facturar: lo que hay que provisionar. */
  accrualAmount: number;
  reading: string;
}

export interface TraceabilityReportDto {
  projectId: string | null;
  projectCode: string | null;
  rows: TraceabilityRowDto[];
  /**
   * Provisión de albaranes recibidos sin facturar. Si no se provisiona, el
   * coste del mes sale falseado a la baja y el margen aparenta ser mejor de
   * lo que es.
   */
  totalAccrual: number;
  totalOrdered: number;
  totalDelivered: number;
  totalInvoiced: number;
}

/**
 * Lectura en lenguaje llano de una fila de trazabilidad. Es la columna que
 * convierte el cuadro en algo accionable en lugar de en una tabla de síes y
 * noes.
 */
export function traceabilityReading(row: {
  hasDeliveryNote: boolean;
  hasInvoice: boolean;
  accrualAmount: number;
}): string {
  if (row.hasDeliveryNote && row.hasInvoice) {
    return row.accrualAmount > 0
      ? 'Facturado en parte: el resto sigue pendiente de factura'
      : 'Ciclo completo';
  }
  if (row.hasDeliveryNote && !row.hasInvoice) {
    return 'Material recibido sin factura: coste real oculto si no se provisiona';
  }
  if (!row.hasDeliveryNote && row.hasInvoice) {
    return 'Factura sin albarán: no debería haberse aprobado';
  }
  return 'Pedido pendiente de suministro: riesgo de plazo';
}
