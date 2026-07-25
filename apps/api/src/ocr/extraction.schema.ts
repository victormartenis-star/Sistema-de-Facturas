import { DOC_TYPES, EXPENSE_CATEGORY_SLUGS } from '@erp/shared';

/**
 * Esquema JSON de la salida estructurada del modelo. Se escribe a mano (en vez
 * de derivarlo de Zod) porque el helper `zodOutputFormat` del SDK requiere
 * Zod 4 y el monorepo va con Zod 3; la respuesta se valida igualmente contra
 * `extractionResultSchema` de @erp/shared, así que no se pierde seguridad.
 *
 * Requisitos de las salidas estructuradas: todo objeto lleva
 * `additionalProperties: false` y lista en `required` todas sus propiedades.
 */

const nullableString = (description: string) => ({
  type: ['string', 'null'],
  description,
});

const nullableNumber = (description: string) => ({
  type: ['number', 'null'],
  description,
});

const confidence = (field: string) => ({
  type: 'number',
  description: `Confianza 0-1 en el campo ${field} (0 si se devolvió null)`,
});

const CONFIDENCE_FIELDS = [
  'docType',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'issuerName',
  'issuerTaxId',
  'baseAmount',
  'vatAmount',
  'totalAmount',
  'paymentMethod',
  'categorySlug',
  'projectHint',
] as const;

export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['payload', 'confidence', 'warnings'],
  properties: {
    payload: {
      type: 'object',
      additionalProperties: false,
      required: [
        'docType',
        'invoiceNumber',
        'issueDate',
        'dueDate',
        'issuerName',
        'issuerTaxId',
        'baseAmount',
        'vatAmount',
        'totalAmount',
        'paymentMethod',
        'categorySlug',
        'projectHint',
        'summary',
      ],
      properties: {
        docType: {
          type: 'string',
          enum: [...DOC_TYPES],
          description: 'Tipo documental que mejor describe el documento',
        },
        invoiceNumber: nullableString(
          'Número de factura o del documento; null si no aparece',
        ),
        issueDate: nullableString(
          'Fecha de emisión en formato AAAA-MM-DD; null si no aparece',
        ),
        dueDate: nullableString(
          'Fecha de vencimiento en formato AAAA-MM-DD; null si no aparece',
        ),
        issuerName: nullableString(
          'Razón social del emisor (el proveedor en una factura de compra)',
        ),
        issuerTaxId: nullableString(
          'NIF/CIF del emisor en mayúsculas, sin espacios ni guiones',
        ),
        baseAmount: nullableNumber('Base imponible en euros'),
        vatAmount: nullableNumber(
          'Cuota de IVA en euros; 0 en inversión del sujeto pasivo',
        ),
        totalAmount: nullableNumber('Importe total en euros'),
        paymentMethod: nullableString(
          'Forma de pago tal como aparece (transferencia, pagaré, efectivo…)',
        ),
        categorySlug: {
          type: ['string', 'null'],
          enum: [...EXPENSE_CATEGORY_SLUGS, null],
          description:
            'Categoría de gasto si es un documento de compra; null si no aplica',
        },
        projectHint: nullableString(
          'Código de obra de la lista dada, o texto del documento que mencione la obra; null si no hay pista',
        ),
        summary: {
          type: 'string',
          description: 'Descripción del documento en una frase, en español',
        },
      },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: [...CONFIDENCE_FIELDS],
      properties: Object.fromEntries(
        CONFIDENCE_FIELDS.map((field) => [field, confidence(field)]),
      ),
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Avisos en español para quien valide: descuadres, NIF extraño, fecha improbable, documento ilegible…',
    },
  },
} as const;
