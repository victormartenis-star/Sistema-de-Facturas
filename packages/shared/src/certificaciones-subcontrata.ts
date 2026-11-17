import { z } from 'zod';
import { puedeTransitar, type Transiciones } from './maquina-estados';

/**
 * Certificaciones de subcontrata y retención de garantía.
 *
 * Es el lado de COSTE de la producción: lo que la constructora debe a cada
 * subcontratista por lo ejecutado contra su `contratos_subcontrata`. Se
 * certifica **a origen** (importe acumulado medido), la API calcula el
 * periodo, retiene el % de garantía del contrato y el líquido a pagar.
 *
 * La aritmética vive en `calculo.ts` (`computeCertSubcontrata`,
 * `resumenRetencionGarantia`, `motivoDevolucionInvalida`).
 */

export const CERT_SUBCONTRATA_STATUSES = [
  'borrador',
  'aprobada',
  'pagada',
  'anulada',
] as const;
export type CertSubcontrataStatus = (typeof CERT_SUBCONTRATA_STATUSES)[number];

export const CERT_SUBCONTRATA_STATUS_LABELS: Record<
  CertSubcontrataStatus,
  string
> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  pagada: 'Pagada',
  anulada: 'Anulada',
};

/**
 * borrador → aprobada | anulada; aprobada → pagada | anulada.
 * `pagada` y `anulada` son terminales: un pago no se deshace desde aquí.
 * Que solo se anule la ÚLTIMA certificación vigente es una regla de la API
 * (depende de las demás filas), no de la tabla de transiciones.
 */
export const CERT_SUBCONTRATA_TRANSITIONS: Transiciones<CertSubcontrataStatus> =
  {
    borrador: ['aprobada', 'anulada'],
    aprobada: ['pagada', 'anulada'],
    pagada: [],
    anulada: [],
  };

export function canTransitionCertSubcontrata(
  from: CertSubcontrataStatus,
  to: CertSubcontrataStatus,
): boolean {
  return puedeTransitar(CERT_SUBCONTRATA_TRANSITIONS, from, to);
}

/** Estados que cuentan como producción certificada (y retención practicada). */
export const CERT_SUBCONTRATA_VIGENTES: readonly CertSubcontrataStatus[] = [
  'aprobada',
  'pagada',
];

export function esCertSubcontrataVigente(
  status: CertSubcontrataStatus,
): boolean {
  return CERT_SUBCONTRATA_VIGENTES.includes(status);
}

/* ────────────────────── esquemas de entrada ────────────────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

const importe = z
  .number({ invalid_type_error: 'Debe ser un número' })
  .finite()
  .nonnegative('No puede ser negativo')
  .max(999_999_999_999.99)
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, {
    message: 'Máximo dos decimales',
  });

const periodoBase = z.object({
  fecha: isoDate,
  periodoDesde: isoDate,
  periodoHasta: isoDate,
  importeOrigen: importe,
  notas: z.string().trim().max(2000).nullish(),
});

const periodoCoherente = (v: {
  periodoDesde?: string;
  periodoHasta?: string;
}) => !v.periodoDesde || !v.periodoHasta || v.periodoDesde <= v.periodoHasta;

const MENSAJE_PERIODO = {
  message: 'El inicio del periodo no puede ser posterior al final',
  path: ['periodoHasta'],
};

export const certSubcontrataCreateSchema = periodoBase
  .strict()
  .refine(periodoCoherente, MENSAJE_PERIODO);

export const certSubcontrataUpdateSchema = periodoBase
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'No hay cambios que aplicar',
  })
  .refine(periodoCoherente, MENSAJE_PERIODO);

export const certSubcontrataPagarSchema = z
  .object({ fechaPago: isoDate })
  .strict();

export const certSubcontrataAnularSchema = z
  .object({
    motivo: z
      .string()
      .trim()
      .min(3, 'Indica el motivo de la anulación')
      .max(500),
  })
  .strict();

export const devolucionGarantiaCreateSchema = z
  .object({
    fecha: isoDate,
    importe: importe.refine((n) => n > 0, 'Debe ser mayor que 0'),
    motivo: z.string().trim().min(3, 'Indica el motivo').max(500),
  })
  .strict();

export const contratosSubcontrataQuerySchema = z.object({
  proyectoId: z.string().uuid().optional(),
  proveedorId: z.string().uuid().optional(),
});

export type CertSubcontrataCreateInput = z.input<
  typeof certSubcontrataCreateSchema
>;
export type CertSubcontrataUpdateInput = z.input<
  typeof certSubcontrataUpdateSchema
>;
export type CertSubcontrataPagarInput = z.input<
  typeof certSubcontrataPagarSchema
>;
export type CertSubcontrataAnularInput = z.input<
  typeof certSubcontrataAnularSchema
>;
export type DevolucionGarantiaCreateInput = z.input<
  typeof devolucionGarantiaCreateSchema
>;
export type ContratosSubcontrataQuery = z.input<
  typeof contratosSubcontrataQuerySchema
>;

/* ─────────────────────────────── DTO ─────────────────────────────── */

export interface CertSubcontrataDto {
  id: string;
  version: number;
  contratoId: string;
  numero: number;
  fecha: string;
  periodoDesde: string;
  periodoHasta: string;
  importeOrigen: number;
  importeAnterior: number;
  importePeriodo: number;
  retencionPct: number;
  retencionImporte: number;
  importeLiquido: number;
  status: CertSubcontrataStatus;
  aprobadaAt: string | null;
  fechaPago: string | null;
  anuladaAt: string | null;
  motivoAnulacion: string | null;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DevolucionGarantiaDto {
  id: string;
  contratoId: string;
  fecha: string;
  importe: number;
  motivo: string;
  createdAt: string;
}

export interface RetencionGarantiaDto {
  contratoId: string;
  retenido: number;
  devuelto: number;
  pendiente: number;
  devoluciones: DevolucionGarantiaDto[];
}

/** Contrato de subcontrata con su situación de producción y garantía. */
export interface ContratoSubcontrataResumenDto {
  id: string;
  numeroContrato: string;
  proveedorId: string;
  proveedorNombre: string;
  proyectoId: string;
  proyectoCodigo: string;
  proyectoNombre: string;
  status: string;
  importeTotal: number;
  importeEjecutado: number;
  pctEjecutado: number;
  retencionGarantiaPct: number;
  retencionPendiente: number;
  certificacionesVigentes: number;
  hayBorrador: boolean;
}
