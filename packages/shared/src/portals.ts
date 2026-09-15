import { z } from 'zod';
import { round2 } from './calculo';

/**
 * Portales externos de autoservicio (Fase 14): subcontratas (CAE, facturas)
 * y clientes (seguimiento de obra). Aislados de la app principal — ver
 * `apps/web/src/app/portals` — y de los roles `subcontrata`/`cliente`
 * (`@erp/shared` → `auth.ts`).
 *
 * El CAE del portal de subcontratas reutiliza `contact_compliance_docs`
 * (`@erp/shared` → `compliance.ts`), filtrando por `users.contactId`; este
 * fichero solo cubre lo que no tenía tabla propia: la bandeja de entrada de
 * facturas que sube la subcontrata (no se escribe directo en `invoices`,
 * que lleva la cadena VeriFactu y la numeración fiscal) y los DTOs de solo
 * lectura del seguimiento de obra del portal de clientes.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const PORTAL_SUBMISSION_ESTADOS = [
  'pendiente_revision',
  'aceptada',
  'rechazada',
] as const;
export type PortalSubmissionEstado = (typeof PORTAL_SUBMISSION_ESTADOS)[number];

export const PORTAL_SUBMISSION_ESTADO_LABELS: Record<
  PortalSubmissionEstado,
  string
> = {
  pendiente_revision: 'Pendiente de revisión',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
};

/* ────────────────────── portal de subcontratas: facturas ────────────────────── */

export const portalFacturaSubmissionCreateSchema = z.object({
  documentId: z.string().uuid('Adjunta el PDF/XML de la factura'),
  numeroFacturaDeclarado: z
    .string()
    .trim()
    .min(1, 'Indica el número de factura')
    .max(50),
  fechaDeclarada: isoDate,
  importeDeclarado: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('El importe debe ser mayor que cero')
    .max(999_999_999),
  notas: z.string().trim().max(500).nullish(),
});
export type PortalFacturaSubmissionCreateInput = z.input<
  typeof portalFacturaSubmissionCreateSchema
>;

/** Revisión por el staff (administración): acepta o rechaza lo declarado por la subcontrata. */
export const portalFacturaRevisarSchema = z.object({
  estado: z.enum(['aceptada', 'rechazada']),
  notas: z.string().trim().max(500).nullish(),
  invoiceId: z.string().uuid('Factura no válida').nullish(),
});
export type PortalFacturaRevisarInput = z.input<
  typeof portalFacturaRevisarSchema
>;

export interface PortalFacturaSubmissionDto {
  id: string;
  contactId: string;
  contactNombre: string;
  documentId: string;
  numeroFacturaDeclarado: string;
  fechaDeclarada: string;
  importeDeclarado: number;
  estado: PortalSubmissionEstado;
  notas: string | null;
  invoiceId: string | null;
  createdAt: string;
}

/* ────────────────────── portal de clientes: seguimiento de obra ────────────────────── */

export interface ClientePortalObraDto {
  projectId: string;
  code: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  /** Presupuesto adjudicado de la obra (suma de fases), para el % de avance. */
  presupuestoTotal: number;
  /** Suma de certificaciones aprobadas hasta la fecha. */
  certificadoTotal: number;
  avancePct: number | null;
  ultimaCertificacionFecha: string | null;
}

/* ────────────────────── cálculo puro ────────────────────── */

/** % de avance de obra visible en el portal de clientes: certificado / presupuesto. */
export function computeAvancePct(
  certificadoTotal: number,
  presupuestoTotal: number,
): number | null {
  if (presupuestoTotal <= 0) return null;
  return round2((certificadoTotal / presupuestoTotal) * 100);
}
