/**
 * Flujos de aprobación por umbral (SAP Release Strategy / Oracle Approvals).
 *
 * - Regla: por operación y (opcional) obra, desde qué importe se exige
 *   aprobación y de qué nivel (administración < gerente < admin).
 * - Solicitud: snapshot del documento (importe, obra, nivel exigido) con su
 *   decisión. Una sola viva (pendiente o aprobada) por documento.
 * - Puertas: validar un albarán contra un pedido (liberación del pedido),
 *   aprobar una factura de compra y aprobar una certificación de subcontrata.
 * - Segregación: quien solicita no decide.
 * Reglas puras en `calculo.ts` (`reglaAplicable`, `evaluarAprobacion`,
 * `impedimentoAprobador`, `exigeReaprobacion`).
 */

import { z } from 'zod';
import type {
  EstadoSolicitudAprobacion,
  EvaluacionAprobacion,
  OperacionAprobacion,
  RolAprobador,
} from './calculo';
import type { Transiciones } from './maquina-estados';
import {
  MAX_NIVELES_APROBACION,
  nivelAprobacionSchema,
  type NivelAprobacionDto,
  type PasoAprobacionDto,
} from './grc';

export type {
  EstadoSolicitudAprobacion,
  OperacionAprobacion,
  RolAprobador,
} from './calculo';

export const OPERACIONES_APROBACION = [
  'pedido_compra',
  'factura_compra',
  'certificacion_subcontrata',
] as const satisfies readonly OperacionAprobacion[];

export const OPERACION_APROBACION_LABELS: Record<OperacionAprobacion, string> =
  {
    pedido_compra: 'Pedido de compra',
    factura_compra: 'Factura de compra',
    certificacion_subcontrata: 'Certificación de subcontrata',
  };

/** Qué paso queda retenido sin aprobación, por operación. */
export const PUERTA_APROBACION_LABELS: Record<OperacionAprobacion, string> = {
  pedido_compra: 'validar albaranes contra el pedido (liberación)',
  factura_compra: 'aprobar la factura (pasa a pagadera)',
  certificacion_subcontrata: 'aprobar la certificación',
};

export const ROLES_APROBADOR = [
  'administracion',
  'gerente',
  'admin',
] as const satisfies readonly RolAprobador[];

export const ROL_APROBADOR_LABELS: Record<RolAprobador, string> = {
  administracion: 'Administración',
  gerente: 'Gerencia',
  admin: 'Dirección (admin)',
};

export const ESTADOS_SOLICITUD_APROBACION = [
  'pendiente',
  'aprobada',
  'rechazada',
  'invalidada',
  'anulada',
] as const satisfies readonly EstadoSolicitudAprobacion[];

export const ESTADO_SOLICITUD_LABELS: Record<
  EstadoSolicitudAprobacion,
  string
> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  invalidada: 'Invalidada',
  anulada: 'Anulada',
};

/** Una aprobada solo puede invalidarse; las demás decisiones son terminales. */
export const APPROVAL_REQUEST_TRANSITIONS: Transiciones<EstadoSolicitudAprobacion> =
  {
    pendiente: ['aprobada', 'rechazada', 'invalidada', 'anulada'],
    aprobada: ['invalidada'],
    rechazada: [],
    invalidada: [],
    anulada: [],
  };

const importe = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999.99)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );

const motivo = z.string().trim().min(3).max(500);

export const reglaAprobacionCreateSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  operacion: z.enum(OPERACIONES_APROBACION),
  importeMinimo: importe,
  rolRequerido: z.enum(ROLES_APROBADOR),
  /** Obra concreta; sin ella, la regla vale para todas. */
  projectId: z.string().uuid().nullish(),
  activa: z.boolean().default(true),
  /** Cadena multinivel (fase 7); vacía = un solo nivel con `rolRequerido`. */
  niveles: z
    .array(nivelAprobacionSchema)
    .max(MAX_NIVELES_APROBACION)
    .optional(),
});
export type ReglaAprobacionCreateInput = z.input<
  typeof reglaAprobacionCreateSchema
>;

export const reglaAprobacionUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(120).optional(),
    importeMinimo: importe.optional(),
    rolRequerido: z.enum(ROLES_APROBADOR).optional(),
    activa: z.boolean().optional(),
    niveles: z
      .array(nivelAprobacionSchema)
      .max(MAX_NIVELES_APROBACION)
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type ReglaAprobacionUpdateInput = z.input<
  typeof reglaAprobacionUpdateSchema
>;

export const solicitudAprobacionCreateSchema = z.object({
  operacion: z.enum(OPERACIONES_APROBACION),
  entidadId: z.string().uuid(),
  comentario: z.string().trim().max(500).nullish(),
});
export type SolicitudAprobacionCreateInput = z.input<
  typeof solicitudAprobacionCreateSchema
>;

export const decisionAprobarSchema = z.object({
  comentario: z.string().trim().max(500).nullish(),
  /** Justificación de una excepción de segregación de funciones (política «justificar»). */
  justificacionSod: z.string().trim().max(500).nullish(),
});
export type DecisionAprobarInput = z.input<typeof decisionAprobarSchema>;

/** Rechazar y anular exigen motivo. */
export const decisionMotivoSchema = z.object({ motivo });
export type DecisionMotivoInput = z.input<typeof decisionMotivoSchema>;

export const solicitudesQuerySchema = z.object({
  estado: z.enum(ESTADOS_SOLICITUD_APROBACION).optional(),
  operacion: z.enum(OPERACIONES_APROBACION).optional(),
  entidadId: z.string().uuid().optional(),
  /** Solo las pendientes que el usuario puede decidir. */
  paraMi: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type SolicitudesQuery = z.infer<typeof solicitudesQuerySchema>;

export const estadoAprobacionQuerySchema = z.object({
  operacion: z.enum(OPERACIONES_APROBACION),
  entidadId: z.string().uuid(),
});
export type EstadoAprobacionQuery = z.infer<typeof estadoAprobacionQuerySchema>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface ReglaAprobacionDto {
  id: string;
  nombre: string;
  operacion: OperacionAprobacion;
  importeMinimo: number;
  rolRequerido: RolAprobador;
  projectId: string | null;
  projectCodigo: string | null;
  activa: boolean;
  version: number;
  /** Cadena multinivel; vacía = un solo nivel con `rolRequerido`. */
  niveles?: NivelAprobacionDto[];
}

export interface SolicitudAprobacionDto {
  id: string;
  operacion: OperacionAprobacion;
  entidadId: string;
  /** Número del documento (pedido, factura, certificación). */
  referencia: string;
  projectId: string | null;
  reglaId: string | null;
  importe: number;
  rolRequerido: RolAprobador;
  estado: EstadoSolicitudAprobacion;
  comentario: string | null;
  solicitadaPor: string | null;
  solicitadaEn: string;
  decididaPor: string | null;
  decididaEn: string | null;
  motivoDecision: string | null;
  /** El usuario actual puede aprobarla o rechazarla. */
  puedoDecidir: boolean;
  version: number;
  /** Multinivel (fase 7): nivel activo, total y pasos de la cadena. */
  nivelActual?: number;
  totalNiveles?: number;
  pasos?: PasoAprobacionDto[];
  /** Por qué el usuario no puede decidir (rol, asignación o SoD), o conflictos auditables. */
  avisoSod?: string | null;
}

export interface EstadoAprobacionDto {
  operacion: OperacionAprobacion;
  entidadId: string;
  referencia: string;
  importe: number;
  regla: ReglaAprobacionDto | null;
  solicitud: SolicitudAprobacionDto | null;
  evaluacion: EvaluacionAprobacion;
}
