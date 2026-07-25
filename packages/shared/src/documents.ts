import { z } from 'zod';

/** Tipos documentales (02-base-de-datos.md §2.4). */
export const DOC_TYPES = [
  'factura_compra',
  'factura_venta',
  'albaran',
  'presupuesto',
  'certificacion',
  'pedido',
  'contrato',
  'ticket',
  'otro',
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  factura_compra: 'Factura de compra',
  factura_venta: 'Factura de venta',
  albaran: 'Albarán',
  presupuesto: 'Presupuesto',
  certificacion: 'Certificación',
  pedido: 'Pedido',
  contrato: 'Contrato',
  ticket: 'Ticket',
  otro: 'Otro',
};

/** Ciclo de vida de un documento en el pipeline OCR/IA. */
export const DOC_STATUSES = [
  'subido',
  'procesando',
  'extraido',
  'validado',
  'rechazado',
  'error',
] as const;

export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  subido: 'Subido',
  procesando: 'Procesando',
  extraido: 'Extraído',
  validado: 'Validado',
  rechazado: 'Rechazado',
  error: 'Error',
};

/** Formatos admitidos en la subida (Fase 1: PDF y foto). */
export const DOCUMENT_ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const DOCUMENT_MAX_SIZE_MB = 25;

/** Campos de texto que acompañan al archivo en el multipart de subida. */
export const documentUploadMetaSchema = z.object({
  projectId: z.string().uuid('Obra no válida').nullish(),
  docType: z.enum(DOC_TYPES).nullish(),
});

export type DocumentUploadMeta = z.infer<typeof documentUploadMetaSchema>;

export const documentUpdateSchema = z.object({
  projectId: z.string().uuid('Obra no válida').nullable().optional(),
  docType: z.enum(DOC_TYPES).nullable().optional(),
});

export type DocumentUpdateInput = z.input<typeof documentUpdateSchema>;

/** Forma de un documento tal como lo devuelve la API. */
export interface DocumentDto {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  docType: DocType | null;
  status: DocStatus;
  projectId: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}
