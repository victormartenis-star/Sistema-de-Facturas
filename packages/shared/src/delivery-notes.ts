import { z } from 'zod';

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
