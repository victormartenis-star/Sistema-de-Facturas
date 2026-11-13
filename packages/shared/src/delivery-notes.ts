import { z } from 'zod';
import { type Transiciones, puedeTransitar } from './maquina-estados';

/**
 * Albaranes y partes de trabajo. Circuito de punteado (matching):
 * pendiente → validado (jefe de obra) → facturado (vinculado a factura).
 * Una factura de compra solo se aprueba si cuadra con sus albaranes.
 */

export const DELIVERY_NOTE_STATUSES = [
  'pendiente',
  'validado',
  'facturado',
] as const;
export type DeliveryNoteStatus = (typeof DELIVERY_NOTE_STATUSES)[number];

export const DELIVERY_NOTE_STATUS_LABELS: Record<DeliveryNoteStatus, string> = {
  pendiente: 'Pendiente',
  validado: 'Validado',
  facturado: 'Facturado',
};

/**
 * Transiciones del albarán (usuario o sistema):
 * - pendiente → validado: usuario (`POST :id/validar`).
 * - validado → pendiente: usuario, solo sin factura (`POST :id/devolver`).
 * - validado → facturado: sistema, al aprobar la factura.
 * - facturado → validado: sistema, al rectificar/anular la factura.
 */
export const DELIVERY_NOTE_TRANSITIONS: Transiciones<DeliveryNoteStatus> = {
  pendiente: ['validado'],
  validado: ['pendiente', 'facturado'],
  facturado: ['validado'],
};

export function canTransitionDeliveryNote(
  from: DeliveryNoteStatus,
  to: DeliveryNoteStatus,
): boolean {
  return puedeTransitar(DELIVERY_NOTE_TRANSITIONS, from, to);
}

interface DeliveryNoteEstado {
  status: DeliveryNoteStatus;
  invoiceId: string | null;
}

/**
 * Edición del albarán según estado. Un validado sin factura solo admite
 * `description`: el importe validado pasó el 3-way match y para cambiarlo hay
 * que devolverlo a pendiente (auditado, con motivo) y revalidarlo.
 */
export function deliveryNoteEditBlockReason(
  n: DeliveryNoteEstado,
  campos: readonly string[],
): string | null {
  if (campos.length === 0 || n.status === 'pendiente') return null;
  if (n.status === 'facturado') {
    return 'No se puede editar un albarán ya facturado';
  }
  if (n.invoiceId) {
    return 'No se puede editar un albarán vinculado a una factura';
  }
  const prohibidos = campos.filter((c) => c !== 'description');
  if (prohibidos.length > 0) {
    return `Un albarán validado solo admite cambiar la descripción. Para corregir ${prohibidos.join(', ')}, devolver el albarán a pendiente`;
  }
  return null;
}

/** Solo se borra un albarán pendiente. */
export function canDeleteDeliveryNote(n: DeliveryNoteEstado): boolean {
  return n.status === 'pendiente';
}

/** Solo se devuelve a pendiente un albarán validado y sin factura. */
export function canReturnDeliveryNote(n: DeliveryNoteEstado): boolean {
  return n.status === 'validado' && n.invoiceId === null;
}

/** Motivo de la devolución de un albarán validado a pendiente. */
export const deliveryNoteReturnSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, 'Indica el motivo (mínimo 5 caracteres)')
    .max(500, 'Máximo 500 caracteres'),
});
export type DeliveryNoteReturnInput = z.input<typeof deliveryNoteReturnSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const deliveryNoteCreateSchema = z.object({
  contactId: z.string().uuid('Proveedor no válido'),
  projectId: z.string().uuid('Obra no válida').nullish(),
  phaseId: z.string().uuid('Partida no válida').nullish(),
  /**
   * Pedido al que responde el albarán. Opcional al darlo de alta —el albarán
   * puede llegar sin número de pedido, que es precisamente la incidencia—,
   * pero obligatorio para validarlo.
   */
  orderId: z.string().uuid('Pedido no válido').nullish(),
  noteNumber: z
    .string()
    .trim()
    .min(1, 'El número de albarán es obligatorio')
    .max(60, 'Máximo 60 caracteres'),
  noteDate: isoDate,
  description: z.string().trim().max(500).nullish(),
  amount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(999_999_999_999.99),
});

export const deliveryNoteUpdateSchema = deliveryNoteCreateSchema.partial();

export type DeliveryNoteCreateInput = z.input<typeof deliveryNoteCreateSchema>;
export type DeliveryNoteUpdateInput = z.input<typeof deliveryNoteUpdateSchema>;

export interface DeliveryNoteDto {
  id: string;
  contactId: string;
  contactName: string;
  projectId: string | null;
  projectCode: string | null;
  phaseId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  /** Motivo por el que no se puede validar todavía; null si se puede. */
  blockReason: string | null;
  noteNumber: string;
  noteDate: string;
  description: string | null;
  amount: number;
  status: DeliveryNoteStatus;
  validatedAt: string | null;
  invoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}
