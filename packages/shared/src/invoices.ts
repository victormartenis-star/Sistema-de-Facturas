import { z } from 'zod';
import { type Transiciones, puedeTransitar } from './maquina-estados';
import type { VerifactuStatus } from './verifactu';

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
  'rectificada',
  'anulada',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  pagada: 'Pagada',
  rectificada: 'Rectificada',
  anulada: 'Anulada',
};

/**
 * Transiciones de la factura.
 * - borrador → aprobada (`aprobar`) | anulada (`anular`).
 * - aprobada → pagada (último vencimiento liquidado) | rectificada (al aprobar
 *   una rectificativa total) | anulada (ver `invoiceCancelBlockReason`).
 * - pagada → aprobada: solo sistema, cuando tesorería reabre un vencimiento;
 *   pagada → rectificada: al aprobar una rectificativa total.
 * - rectificada y anulada son terminales.
 */
export const INVOICE_TRANSITIONS: Transiciones<InvoiceStatus> = {
  borrador: ['aprobada', 'anulada'],
  aprobada: ['pagada', 'rectificada', 'anulada'],
  pagada: ['aprobada', 'rectificada'],
  rectificada: [],
  anulada: [],
};

export const RECTIFICATION_KINDS = ['total', 'diferencias'] as const;
export type RectificationKind = (typeof RECTIFICATION_KINDS)[number];

export const RECTIFICATION_KIND_LABELS: Record<RectificationKind, string> = {
  total: 'Total',
  diferencias: 'Por diferencias',
};

/**
 * ¿Se puede rectificar? `null` si sí; si no, el motivo para el 409.
 * Solo se rectifica una factura aprobada o pagada. Una rectificativa no se
 * rectifica en total (se emitiría otra por diferencias).
 */
export function invoiceRectifyBlockReason(
  i: { status: InvoiceStatus; isRectification: boolean },
  clase: RectificationKind,
): string | null {
  if (i.status === 'rectificada') {
    return 'La factura ya está rectificada';
  }
  if (i.status !== 'aprobada' && i.status !== 'pagada') {
    return 'Solo se rectifican facturas aprobadas o pagadas';
  }
  if (i.isRectification && clase === 'total') {
    return 'Una factura rectificativa no se rectifica en total: emite otra rectificativa por diferencias';
  }
  return null;
}

export function canTransitionInvoice(
  from: InvoiceStatus,
  to: InvoiceStatus,
): boolean {
  return puedeTransitar(INVOICE_TRANSITIONS, from, to);
}

/** Editar y borrar: solo en borrador. */
export function canEditInvoice(status: InvoiceStatus): boolean {
  return status === 'borrador';
}
export function canDeleteInvoice(status: InvoiceStatus): boolean {
  return status === 'borrador';
}

/**
 * ¿Se puede anular? `null` si sí; si no, el motivo para el 409.
 * - Borrador: siempre.
 * - Venta aprobada: no. Una factura de venta emitida se corrige con rectificativa
 *   (art. 15 RD 1619/2012).
 * - Compra aprobada: sí, solo sin vencimientos pagados (el motivo se exige en la API).
 * - Pagada o anulada: no.
 */
export function invoiceCancelBlockReason(i: {
  kind: InvoiceKind;
  status: InvoiceStatus;
  hasPaidMilestones: boolean;
}): string | null {
  if (i.status === 'borrador') return null;
  if (i.status === 'anulada') return 'La factura ya está anulada';
  if (i.status === 'pagada') {
    return 'No se puede anular una factura pagada: reabre antes el vencimiento o registra una rectificativa';
  }
  if (i.kind === 'venta') {
    return 'Una factura de venta emitida no se anula: se corrige con una factura rectificativa';
  }
  if (i.hasPaidMilestones) {
    return 'No se puede anular una factura con vencimientos pagados';
  }
  return null;
}

/** Motivo de anulación; la API lo exige fuera de borrador. */
export const invoiceCancelSchema = z.object({
  motivo: z.string().trim().min(5).max(500).optional(),
});
export type InvoiceCancelInput = z.input<typeof invoiceCancelSchema>;

/**
 * Estado que le corresponde a la factura según sus vencimientos; `null` si no
 * debe tocarse (borrador, anulada).
 */
export function invoiceStatusFromMilestones(
  current: InvoiceStatus,
  hayPrevistos: boolean,
): InvoiceStatus | null {
  if (current !== 'aprobada' && current !== 'pagada') return null;
  return hayPrevistos ? 'aprobada' : 'pagada';
}

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

export const invoiceRectifySchema = z
  .object({
    clase: z.enum(RECTIFICATION_KINDS),
    issueDate: isoDate,
    motivo: z.string().trim().min(5).max(500),
    /** Obligatorias si clase = 'diferencias'; prohibidas si clase = 'total' (se derivan). */
    lines: z.array(invoiceLineSchema).min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.clase === 'diferencias' && !v.lines) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines'],
        message: 'La rectificativa por diferencias exige líneas con el delta',
      });
    }
    if (v.clase === 'total' && v.lines) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines'],
        message: 'La rectificativa total deriva sus líneas de la original',
      });
    }
  });
export type InvoiceRectifyInput = z.input<typeof invoiceRectifySchema>;

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
  rectifiesInvoiceId: string | null;
  rectifiesInvoiceNumber: string | null;
  rectificationKind: RectificationKind | null;
  rectificationReason: string | null;
  /** Rectificativas activas (no anuladas) de esta factura. */
  rectifiedByInvoiceIds: string[];
  cancelReason: string | null;
  notes: string | null;
  lines: InvoiceLineDto[];
  deliveryNotes: InvoiceDeliveryNoteRef[];
  /** Estado del registro VeriFactu real (Fase 14) — distinto de la huella interna, ver `verifactu.ts`. */
  verifactuStatus: VerifactuStatus;
  createdAt: string;
  updatedAt: string;
}
