import { z } from 'zod';

/**
 * Facturas de compra y de venta con:
 * - Imputación analítica por línea (obra + partida + categoría).
 * - Retención por garantía (% configurable, cobro/pago diferido).
 * - Inversión del sujeto pasivo (ISP): IVA 0 + leyenda legal obligatoria.
 * - Matching con albaranes validados (facturas de compra).
 */

export const INVOICE_KINDS = ['compra', 'venta'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  compra: 'Compra',
  venta: 'Venta',
};

export const INVOICE_STATUSES = [
  'borrador',
  'aprobada',
  'pagada',
  'anulada',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  pagada: 'Pagada',
  anulada: 'Anulada',
};

/** Leyenda legal obligatoria cuando se aplica inversión del sujeto pasivo. */
export const ISP_LEGEND =
  'Operación con inversión del sujeto pasivo conforme al art. 84.Uno.2º.f) de la Ley 37/1992 del IVA.';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const invoiceLineSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'La descripción es obligatoria')
    .max(300, 'Máximo 300 caracteres'),
  baseAmount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .max(999_999_999_999.99),
  vatPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0)
    .max(100)
    .default(21),
  projectId: z.string().uuid('Obra no válida').nullish(),
  phaseId: z.string().uuid('Partida no válida').nullish(),
  categoryId: z.string().uuid('Categoría no válida').nullish(),
});

export const invoiceCreateSchema = z.object({
  kind: z.enum(INVOICE_KINDS),
  contactId: z.string().uuid('Contacto no válido'),
  invoiceNumber: z
    .string()
    .trim()
    .min(1, 'El número de factura es obligatorio')
    .max(60, 'Máximo 60 caracteres'),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  isp: z.boolean().default(false),
  retentionPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'Entre 0 y 20')
    .max(20, 'Entre 0 y 20')
    .default(0),
  retentionReleaseDate: isoDate.nullish(),
  notes: z.string().trim().max(1000).nullish(),
  lines: z.array(invoiceLineSchema).min(1, 'Añade al menos una línea'),
  /** Solo compra: albaranes validados que soportan esta factura. */
  deliveryNoteIds: z.array(z.string().uuid()).default([]),
});

export const invoiceUpdateSchema = invoiceCreateSchema
  .omit({ kind: true })
  .partial();

export type InvoiceLineInput = z.input<typeof invoiceLineSchema>;
export type InvoiceCreateInput = z.input<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.input<typeof invoiceUpdateSchema>;

export interface InvoiceLineDto {
  id: string;
  description: string;
  baseAmount: number;
  vatPct: number;
  projectId: string | null;
  projectCode: string | null;
  phaseId: string | null;
  phaseCode: string | null;
  categoryId: string | null;
}

export interface InvoiceDeliveryNoteRef {
  id: string;
  noteNumber: string;
  amount: number;
}

export interface InvoiceDto {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  contactId: string;
  contactName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  isp: boolean;
  retentionPct: number;
  retentionAmount: number;
  /** Importe a cobrar/pagar al vencimiento ordinario (total - retención). */
  payableAmount: number;
  retentionReleaseDate: string | null;
  certificationId: string | null;
  notes: string | null;
  lines: InvoiceLineDto[];
  deliveryNotes: InvoiceDeliveryNoteRef[];
  createdAt: string;
  updatedAt: string;
}
