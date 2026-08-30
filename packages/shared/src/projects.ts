import { z } from 'zod';

/** Estados del ciclo de vida de una obra (ver 02-base-de-datos.md §2.2). */
export const PROJECT_STATUSES = [
  'oferta',
  'adjudicada',
  'en_curso',
  'pausada',
  'finalizada',
  'garantia',
  'cerrada',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  oferta: 'Oferta',
  adjudicada: 'Adjudicada',
  en_curso: 'En curso',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
  garantia: 'Garantía',
  cerrada: 'Cerrada',
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const projectCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'El código es obligatorio')
      .max(30, 'Máximo 30 caracteres'),
    name: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio')
      .max(200, 'Máximo 200 caracteres'),
    status: z.enum(PROJECT_STATUSES).default('en_curso'),
    startDate: isoDate.nullish(),
    expectedEnd: isoDate.nullish(),
    contractAmount: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .nonnegative('No puede ser negativo')
      .max(999_999_999_999.99)
      .nullish(),
    /** Coste meta interno, distinto del precio ofertado. */
    targetCost: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .nonnegative('No puede ser negativo')
      .max(999_999_999_999.99)
      .nullish(),
    retentionPct: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .min(0, 'Entre 0 y 100')
      .max(100, 'Entre 0 y 100')
      .default(5),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine(
    (p) => !p.startDate || !p.expectedEnd || p.expectedEnd >= p.startDate,
    {
      message: 'La fecha de fin prevista no puede ser anterior al inicio',
      path: ['expectedEnd'],
    },
  );

export const projectUpdateSchema = projectCreateSchema.innerType().partial();

export type ProjectCreateInput = z.input<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.input<typeof projectUpdateSchema>;

/** Forma de una obra tal como la devuelve la API. */
export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  startDate: string | null;
  expectedEnd: string | null;
  groupManagerId: string | null;
  siteManagerId: string | null;
  foremanId: string | null;
  contractAmount: number | null;
  targetCost: number | null;
  retentionPct: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
