import { z } from 'zod';

/**
 * Actas de recepción de obra (Fase 12): recepción provisional o definitiva,
 * con su lista de repasos (defectos pendientes de subsanar). El acta solo
 * puede firmarse "sin reservas" cuando todos sus repasos están subsanados
 * — `computeActaEstadoFirma` es la regla que decide eso.
 */

export const ACTA_RECEPCION_TIPOS = ['provisional', 'definitiva'] as const;
export type ActaRecepcionTipo = (typeof ACTA_RECEPCION_TIPOS)[number];

export const ACTA_RECEPCION_TIPO_LABELS: Record<ActaRecepcionTipo, string> = {
  provisional: 'Recepción provisional',
  definitiva: 'Recepción definitiva',
};

export const ACTA_RECEPCION_ESTADOS = [
  'pendiente_firma',
  'firmada_sin_reservas',
  'firmada_con_reservas',
] as const;
export type ActaRecepcionEstado = (typeof ACTA_RECEPCION_ESTADOS)[number];

export const ACTA_RECEPCION_ESTADO_LABELS: Record<ActaRecepcionEstado, string> =
  {
    pendiente_firma: 'Pendiente de firma',
    firmada_sin_reservas: 'Firmada sin reservas',
    firmada_con_reservas: 'Firmada con reservas',
  };

export const REPASO_ESTADOS = ['pendiente', 'subsanado'] as const;
export type RepasoEstado = (typeof REPASO_ESTADOS)[number];

export const REPASO_ESTADO_LABELS: Record<RepasoEstado, string> = {
  pendiente: 'Pendiente',
  subsanado: 'Subsanado',
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const actaRecepcionCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  tipo: z.enum(ACTA_RECEPCION_TIPOS),
  fecha: isoDate,
  documentId: z.string().uuid('Documento no válido').nullish(),
  notas: z.string().trim().max(2000).nullish(),
});

export const actaRecepcionUpdateSchema = actaRecepcionCreateSchema
  .omit({ projectId: true })
  .partial();

export type ActaRecepcionCreateInput = z.input<
  typeof actaRecepcionCreateSchema
>;
export type ActaRecepcionUpdateInput = z.input<
  typeof actaRecepcionUpdateSchema
>;

export const repasoCreateSchema = z.object({
  descripcion: z
    .string()
    .trim()
    .min(1, 'La descripción del repaso es obligatoria')
    .max(500),
  responsable: z.string().trim().max(150).nullish(),
  fechaLimite: isoDate.nullish(),
});

export const repasoUpdateSchema = repasoCreateSchema.partial().extend({
  estado: z.enum(REPASO_ESTADOS).optional(),
  fechaSubsanacion: isoDate.nullish(),
});

export type RepasoCreateInput = z.input<typeof repasoCreateSchema>;
export type RepasoUpdateInput = z.input<typeof repasoUpdateSchema>;

export interface ActaRecepcionDto {
  id: string;
  projectId: string;
  tipo: ActaRecepcionTipo;
  fecha: string;
  estado: ActaRecepcionEstado;
  documentId: string | null;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActaRecepcionRepasoDto {
  id: string;
  actaId: string;
  descripcion: string;
  responsable: string | null;
  fechaLimite: string | null;
  estado: RepasoEstado;
  fechaSubsanacion: string | null;
  sortOrder: number;
}

/* ─────────────────────────────── lógica pura ─────────────────────────────── */

/**
 * Estado de firma resultante de un acta según sus repasos: sin reservas
 * solo si no hay ninguno pendiente (sin repasos también cuenta como sin
 * reservas — recepción limpia).
 */
export function computeActaEstadoFirma(
  repasos: { estado: RepasoEstado }[],
): Extract<
  ActaRecepcionEstado,
  'firmada_sin_reservas' | 'firmada_con_reservas'
> {
  const hayPendientes = repasos.some((r) => r.estado === 'pendiente');
  return hayPendientes ? 'firmada_con_reservas' : 'firmada_sin_reservas';
}

/** Progreso de subsanación del acta: repasos resueltos sobre el total. */
export function computeRepasosProgreso(repasos: { estado: RepasoEstado }[]): {
  total: number;
  subsanados: number;
  pctSubsanado: number;
} {
  const total = repasos.length;
  const subsanados = repasos.filter((r) => r.estado === 'subsanado').length;
  return {
    total,
    subsanados,
    pctSubsanado: total === 0 ? 100 : Math.round((subsanados / total) * 100),
  };
}
