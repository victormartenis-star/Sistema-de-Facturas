import { z } from 'zod';
import { daysBetween } from './calculo';

/**
 * Incidencias y control de seguridad PRL en obra (Fase 12): alta rápida de
 * un punto de inspección (andamios, acopios, EPIs…) y seguimiento de su
 * subsanación. Distinto de `contact_compliance_docs`/`proveedores.ts`
 * (documentación PRL de la subcontrata): esto es seguridad física en el
 * tajo, no papeleo.
 */

export const INCIDENCIA_PRL_GRAVEDADES = [
  'leve',
  'grave',
  'muy_grave',
] as const;
export type IncidenciaPRLGravedad = (typeof INCIDENCIA_PRL_GRAVEDADES)[number];

export const INCIDENCIA_PRL_GRAVEDAD_LABELS: Record<
  IncidenciaPRLGravedad,
  string
> = {
  leve: 'Leve',
  grave: 'Grave',
  muy_grave: 'Muy grave',
};

export const INCIDENCIA_PRL_ESTADOS = [
  'abierta',
  'en_subsanacion',
  'cerrada',
] as const;
export type IncidenciaPRLEstado = (typeof INCIDENCIA_PRL_ESTADOS)[number];

export const INCIDENCIA_PRL_ESTADO_LABELS: Record<IncidenciaPRLEstado, string> =
  {
    abierta: 'Abierta',
    en_subsanacion: 'En subsanación',
    cerrada: 'Cerrada',
  };

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const incidenciaPRLCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  fecha: isoDate,
  puntoInspeccion: z
    .string()
    .trim()
    .min(1, 'El punto de inspección es obligatorio')
    .max(200),
  descripcion: z
    .string()
    .trim()
    .min(1, 'La descripción es obligatoria')
    .max(2000),
  gravedad: z.enum(INCIDENCIA_PRL_GRAVEDADES).default('leve'),
  responsableSubsanacion: z.string().trim().max(150).nullish(),
  fechaLimiteSubsanacion: isoDate.nullish(),
  documentId: z.string().uuid('Documento no válido').nullish(),
  notas: z.string().trim().max(2000).nullish(),
});

export const incidenciaPRLUpdateSchema = incidenciaPRLCreateSchema
  .omit({ projectId: true })
  .partial()
  .extend({
    estado: z.enum(INCIDENCIA_PRL_ESTADOS).optional(),
    fechaCierre: isoDate.nullish(),
  });

export type IncidenciaPRLCreateInput = z.input<
  typeof incidenciaPRLCreateSchema
>;
export type IncidenciaPRLUpdateInput = z.input<
  typeof incidenciaPRLUpdateSchema
>;

export interface IncidenciaPRLDto {
  id: string;
  projectId: string;
  fecha: string;
  puntoInspeccion: string;
  descripcion: string;
  gravedad: IncidenciaPRLGravedad;
  estado: IncidenciaPRLEstado;
  responsableSubsanacion: string | null;
  fechaLimiteSubsanacion: string | null;
  fechaCierre: string | null;
  documentId: string | null;
  notas: string | null;
  /** true si sigue abierta/en subsanación y el plazo ya venció. */
  fueraDePlazo: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────────── lógica pura ─────────────────────────────── */

/**
 * Una incidencia está fuera de plazo cuando sigue abierta (no cerrada) y su
 * fecha límite de subsanación ya pasó.
 */
export function isIncidenciaFueraDePlazo(
  incidencia: {
    estado: IncidenciaPRLEstado;
    fechaLimiteSubsanacion: string | null;
  },
  today: string,
): boolean {
  if (incidencia.estado === 'cerrada' || !incidencia.fechaLimiteSubsanacion) {
    return false;
  }
  return daysBetween(today, incidencia.fechaLimiteSubsanacion) < 0;
}
