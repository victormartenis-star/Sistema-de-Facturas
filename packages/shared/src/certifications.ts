import { z } from 'zod';

/**
 * Certificaciones de obra con facturación a origen:
 * cada certificación registra el % ejecutado acumulado (a origen) y el
 * importe del periodo se calcula descontando lo ya certificado antes.
 */

export const CERT_STATUSES = ['borrador', 'facturada'] as const;
export type CertStatus = (typeof CERT_STATUSES)[number];

export const CERT_STATUS_LABELS: Record<CertStatus, string> = {
  borrador: 'Borrador',
  facturada: 'Facturada',
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const certificationCreateSchema = z.object({
  projectId: z.string().uuid('Obra no válida'),
  certDate: isoDate,
  cumulativePct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .gt(0, 'Debe ser mayor que 0')
    .max(100, 'No puede superar el 100 %'),
  retentionPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'Entre 0 y 20')
    .max(20, 'Entre 0 y 20')
    .nullish(), // si no se indica, se usa la retención de la obra
  notes: z.string().trim().max(1000).nullish(),
});

export type CertificationCreateInput = z.input<
  typeof certificationCreateSchema
>;

/** Datos para emitir la factura de venta desde una certificación. */
export const certificationInvoiceSchema = z.object({
  /** Cliente al que se emite la factura. */
  contactId: z.string().uuid('Cliente no válido'),
  invoiceNumber: z
    .string()
    .trim()
    .min(1, 'El número de factura es obligatorio')
    .max(60, 'Máximo 60 caracteres'),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  /** En construcción entre empresas lo habitual es facturar con ISP. */
  isp: z.boolean().default(true),
  retentionReleaseDate: isoDate.nullish(),
});

export type CertificationInvoiceInput = z.input<
  typeof certificationInvoiceSchema
>;

export interface CertificationDto {
  id: string;
  projectId: string;
  seq: number;
  certDate: string;
  /** % ejecutado acumulado a origen. */
  cumulativePct: number;
  /** Importe acumulado a origen (contrato × %). */
  cumulativeAmount: number;
  /** Lo certificado en periodos anteriores. */
  previousAmount: number;
  /** Importe de este periodo (acumulado - anterior). */
  periodAmount: number;
  retentionPct: number;
  retentionAmount: number;
  status: CertStatus;
  invoiceId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
