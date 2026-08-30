import { z } from 'zod';
import { DOC_TYPES } from './documents';

/**
 * Extracción OCR/IA de un documento (02-base-de-datos.md §2.4): el modelo
 * de visión lee el original y devuelve los 7 campos clave de la Fase 1
 * (número, fecha, emisor, base, IVA, total y forma de pago), la clasificación
 * documental y de gasto, y una confianza 0-1 por campo. El resultado se
 * guarda en bruto en `extractions` y se revisa en la bandeja de validación.
 */

/** Slugs de las 8 categorías de gasto de sistema (02-base-de-datos.md §2.3). */
export const EXPENSE_CATEGORY_SLUGS = [
  'materiales',
  'mano_de_obra',
  'maquinaria',
  'subcontratas',
  'transporte',
  'herramientas',
  'gastos_generales',
  'otros',
] as const;

export type ExpenseCategorySlug = (typeof EXPENSE_CATEGORY_SLUGS)[number];

export const extractionPayloadSchema = z.object({
  docType: z
    .enum(DOC_TYPES)
    .describe('Tipo documental que mejor describe el documento'),
  invoiceNumber: z
    .string()
    .nullable()
    .describe('Número de factura o del documento; null si no aparece'),
  issueDate: z
    .string()
    .nullable()
    .describe('Fecha de emisión en formato AAAA-MM-DD; null si no aparece'),
  dueDate: z
    .string()
    .nullable()
    .describe('Fecha de vencimiento en formato AAAA-MM-DD; null si no aparece'),
  issuerName: z
    .string()
    .nullable()
    .describe('Razón social del emisor (proveedor en compras)'),
  issuerTaxId: z
    .string()
    .nullable()
    .describe('NIF/CIF del emisor, en mayúsculas y sin espacios ni guiones'),
  baseAmount: z
    .number()
    .nullable()
    .describe('Base imponible en euros; null si no aparece'),
  vatAmount: z
    .number()
    .nullable()
    .describe('Cuota de IVA en euros; 0 si es inversión del sujeto pasivo'),
  totalAmount: z.number().nullable().describe('Importe total en euros'),
  paymentMethod: z
    .string()
    .nullable()
    .describe('Forma de pago tal como aparece (transferencia, pagaré…)'),
  categorySlug: z
    .enum(EXPENSE_CATEGORY_SLUGS)
    .nullable()
    .describe(
      'Categoría de gasto si es un documento de compra; null si no aplica',
    ),
  projectHint: z
    .string()
    .nullable()
    .describe(
      'Código de la obra a la que parece pertenecer (de la lista dada) o texto literal del documento que la mencione; null si no hay pista',
    ),
  summary: z
    .string()
    .describe('Descripción en una frase del documento, en español'),
});

export type ExtractionPayload = z.infer<typeof extractionPayloadSchema>;

/** Confianza 0-1 por campo extraído. */
export const extractionConfidenceSchema = z.object({
  docType: z.number(),
  invoiceNumber: z.number(),
  issueDate: z.number(),
  dueDate: z.number(),
  issuerName: z.number(),
  issuerTaxId: z.number(),
  baseAmount: z.number(),
  vatAmount: z.number(),
  totalAmount: z.number(),
  paymentMethod: z.number(),
  categorySlug: z.number(),
  projectHint: z.number(),
});

export type ExtractionConfidence = z.infer<typeof extractionConfidenceSchema>;

/** Lo que devuelve el modelo (salida estructurada). */
export const extractionResultSchema = z.object({
  payload: extractionPayloadSchema,
  confidence: extractionConfidenceSchema,
  warnings: z
    .array(z.string())
    .describe(
      'Avisos detectados: descuadre base+IVA≠total, NIF con formato inválido, fecha improbable, texto ilegible…',
    ),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** Forma de una extracción tal como la devuelve la API. */
export interface ExtractionDto {
  id: string;
  documentId: string;
  model: string;
  payload: ExtractionPayload;
  confidence: ExtractionConfidence;
  warnings: string[];
  createdAt: string;
}

/** Una fila de la bandeja de validación: documento + lo que leyó la IA. */
export interface ValidationItemDto {
  documentId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: string;
  projectId: string | null;
  createdAt: string;
  extraction: ExtractionDto | null;
  /** Contacto existente con el mismo NIF/CIF que el emisor leído. */
  suggestedContactId: string | null;
  suggestedContactName: string | null;
  /** Obra cuyo código coincide con la pista encontrada en el documento. */
  suggestedProjectId: string | null;
  suggestedProjectCode: string | null;
}

/**
 * Validación humana de una extracción: el usuario confirma o corrige lo leído.
 * Si se indica `contactId` y hay importes, se crea la factura en borrador.
 */
export const extractionValidateSchema = z.object({
  invoiceNumber: z.string().trim().max(60).nullish(),
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD')
    .nullish(),
  baseAmount: z.number().nonnegative('No puede ser negativo').nullish(),
  vatAmount: z.number().nonnegative('No puede ser negativo').nullish(),
  contactId: z.string().uuid('Contacto no válido').nullish(),
  projectId: z.string().uuid('Obra no válida').nullish(),
  categoryId: z.string().uuid('Categoría no válida').nullish(),
  /** Crear la factura de compra en borrador a partir de estos datos. */
  createInvoice: z.boolean().default(false),
});

export type ExtractionValidateInput = z.input<typeof extractionValidateSchema>;

export interface ValidationResultDto {
  documentId: string;
  status: string;
  invoiceId: string | null;
  message: string;
}
