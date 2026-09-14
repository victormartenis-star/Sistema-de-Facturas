import { z } from 'zod';
import { daysBetween } from './calculo';

/**
 * Permisos públicos y licencias de obra (Fase 12): licencia de obra, vado,
 * ocupación de vía pública, gestión de residuos. Solo se avisa de
 * caducidad de los permisos ya `concedido` con fecha de vencimiento — un
 * trámite todavía en curso no "caduca", simplemente tarda.
 */

export const PERMISO_TIPOS = [
  'licencia_obra',
  'vado',
  'ocupacion_via_publica',
  'gestion_residuos',
] as const;
export type PermisoTipo = (typeof PERMISO_TIPOS)[number];

export const PERMISO_TIPO_LABELS: Record<PermisoTipo, string> = {
  licencia_obra: 'Licencia de obra',
  vado: 'Vado',
  ocupacion_via_publica: 'Ocupación de vía pública',
  gestion_residuos: 'Gestión de residuos',
};

export const PERMISO_STATUSES = [
  'solicitado',
  'en_tramite',
  'concedido',
  'denegado',
] as const;
export type PermisoStatus = (typeof PERMISO_STATUSES)[number];

export const PERMISO_STATUS_LABELS: Record<PermisoStatus, string> = {
  solicitado: 'Solicitado',
  en_tramite: 'En trámite',
  concedido: 'Concedido',
  denegado: 'Denegado',
};

/** Días antes del vencimiento en los que se avisa. */
export const PERMISO_ALERT_WARNING_DAYS = 30;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const permisoCreateSchema = z
  .object({
    projectId: z.string().uuid('La obra es obligatoria'),
    tipo: z.enum(PERMISO_TIPOS),
    organismoPublico: z
      .string()
      .trim()
      .min(1, 'El organismo público es obligatorio')
      .max(200),
    numeroExpediente: z.string().trim().max(100).nullish(),
    fechaSolicitud: isoDate,
    fechaResolucion: isoDate.nullish(),
    fechaVencimiento: isoDate.nullish(),
    status: z.enum(PERMISO_STATUSES).default('solicitado'),
    canonImporte: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .nonnegative('No puede ser negativo')
      .nullish(),
    documentId: z.string().uuid('Documento no válido').nullish(),
    notas: z.string().trim().max(2000).nullish(),
  })
  .refine((d) => !d.fechaResolucion || d.fechaResolucion >= d.fechaSolicitud, {
    message: 'La fecha de resolución no puede ser anterior a la solicitud',
    path: ['fechaResolucion'],
  });

export const permisoUpdateSchema = permisoCreateSchema
  .innerType()
  .omit({ projectId: true })
  .partial();

export type PermisoCreateInput = z.input<typeof permisoCreateSchema>;
export type PermisoUpdateInput = z.input<typeof permisoUpdateSchema>;

export interface PermisoPublicoDto {
  id: string;
  projectId: string;
  tipo: PermisoTipo;
  organismoPublico: string;
  numeroExpediente: string | null;
  fechaSolicitud: string;
  fechaResolucion: string | null;
  fechaVencimiento: string | null;
  status: PermisoStatus;
  canonImporte: number | null;
  documentId: string | null;
  notas: string | null;
  /** Nivel de alerta de caducidad a fecha de hoy; null si no aplica. */
  alertLevel: PermisoAlertLevel;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────────── lógica pura ─────────────────────────────── */

export type PermisoAlertLevel = 'vencido' | 'proximo_vencimiento' | null;

/**
 * Nivel de alerta de caducidad de un permiso ya concedido. `null` si no
 * aplica (el trámite no está concedido, o no tiene fecha de vencimiento —
 * p. ej. una licencia de obra sin caducidad).
 */
export function computePermisoAlertLevel(
  permiso: { status: PermisoStatus; fechaVencimiento: string | null },
  today: string,
  horizonDays = PERMISO_ALERT_WARNING_DAYS,
): PermisoAlertLevel {
  if (permiso.status !== 'concedido' || !permiso.fechaVencimiento) {
    return null;
  }
  const days = daysBetween(today, permiso.fechaVencimiento);
  if (days < 0) return 'vencido';
  if (days <= horizonDays) return 'proximo_vencimiento';
  return null;
}

export interface PermisoAlertItem {
  id: string;
  projectId: string;
  tipo: PermisoTipo;
  organismoPublico: string;
  fechaVencimiento: string;
  /** Días hasta vencimiento; negativo si ya venció. */
  daysToExpiry: number;
  level: 'vencido' | 'proximo_vencimiento';
}

/** Filtra y ordena (primero los más urgentes) los permisos que requieren aviso. */
export function computePermisoAlerts(
  permisos: {
    id: string;
    projectId: string;
    tipo: PermisoTipo;
    organismoPublico: string;
    status: PermisoStatus;
    fechaVencimiento: string | null;
  }[],
  today: string,
  horizonDays = PERMISO_ALERT_WARNING_DAYS,
): PermisoAlertItem[] {
  return permisos
    .map((p) => {
      const level = computePermisoAlertLevel(p, today, horizonDays);
      if (!level || !p.fechaVencimiento) return null;
      return {
        id: p.id,
        projectId: p.projectId,
        tipo: p.tipo,
        organismoPublico: p.organismoPublico,
        fechaVencimiento: p.fechaVencimiento,
        daysToExpiry: daysBetween(today, p.fechaVencimiento),
        level,
      };
    })
    .filter((a): a is PermisoAlertItem => a !== null)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}
