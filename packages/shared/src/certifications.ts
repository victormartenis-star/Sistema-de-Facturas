import { z } from 'zod';
import { type Transiciones, puedeTransitar } from './maquina-estados';

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

/**
 * Transiciones de la certificación: borrador → facturada (`facturar`) y
 * facturada → borrador solo por sistema, cuando su factura se rectifica.
 */
export const CERT_TRANSITIONS: Transiciones<CertStatus> = {
  borrador: ['facturada'],
  facturada: ['borrador'],
};

export function canTransitionCertification(
  from: CertStatus,
  to: CertStatus,
): boolean {
  return puedeTransitar(CERT_TRANSITIONS, from, to);
}

/** Crear/editar/borrar líneas y borrar la certificación: solo en borrador. */
export function canEditCertification(status: CertStatus): boolean {
  return status === 'borrador';
}

/**
 * Motivo de rechazo del % a origen, o `null`. Una certificación normal debe
 * superar el % anterior; una rectificativa puede bajar o igualarlo (nunca
 * superarlo: para subir se certifica normalmente).
 */
export function certificationPctBlockReason(i: {
  cumulativePct: number;
  previousPct: number;
  isRectification: boolean;
}): string | null {
  if (i.isRectification) {
    if (i.cumulativePct > i.previousPct) {
      return `Una certificación rectificativa no puede superar el ${i.previousPct.toFixed(2)} % ya certificado`;
    }
    return null;
  }
  if (i.cumulativePct <= i.previousPct) {
    return `El % a origen debe superar el ${i.previousPct.toFixed(2)} % ya certificado`;
  }
  return null;
}

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

/** Certificación rectificativa: fija el nuevo acumulado a origen (puede bajar). */
export const certificationRectifySchema = z.object({
  certDate: isoDate,
  cumulativePct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'Entre 0 y 100')
    .max(100, 'No puede superar el 100 %'),
  motivo: z.string().trim().min(5).max(500),
  notes: z.string().trim().max(1000).nullish(),
});
export type CertificationRectifyInput = z.input<
  typeof certificationRectifySchema
>;

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
  rectifiesCertificationId: string | null;
  rectificationReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Líneas de certificación ───────────────────────────────────────────────

export const certificationLineCreateSchema = z.object({
  budgetItemId: z.string().uuid('Partida no válida'),
  cumulativePct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'Entre 0 y 100')
    .max(100, 'Entre 0 y 100'),
  cumulativeAmount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'Debe ser ≥ 0'),
  periodAmount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'Debe ser ≥ 0'),
  notes: z.string().trim().max(500).nullish(),
});

export type CertificationLineCreateInput = z.input<
  typeof certificationLineCreateSchema
>;

export const certificationLineUpdateSchema =
  certificationLineCreateSchema.partial();
export type CertificationLineUpdateInput = z.input<
  typeof certificationLineUpdateSchema
>;

export interface CertificationLineDto {
  id: string;
  certificationId: string;
  budgetItemId: string;
  cumulativePct: number;
  cumulativeAmount: number;
  periodAmount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
