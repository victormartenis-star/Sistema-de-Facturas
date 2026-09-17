import { z } from 'zod';

/**
 * Maestro de trabajadores (personal propio y subcontratado).
 *
 * Mismo hueco que cerró el maestro de `equipos` (Fase 13) pero para
 * personas: `partes_personal.worker_name` era texto libre porque no había
 * ficha del operario. Este maestro permite dar de alta cada trabajador una
 * vez (con su tarifa habitual) y enlazar los partes diarios a su ficha —
 * `worker_name` se mantiene como texto libre de compatibilidad, igual que
 * `partes_maquinaria.machine_name` con `equipos`.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const TRABAJADOR_TIPOS = ['propio', 'subcontratado'] as const;
export type TrabajadorTipo = (typeof TRABAJADOR_TIPOS)[number];

export const TRABAJADOR_TIPO_LABELS: Record<TrabajadorTipo, string> = {
  propio: 'Personal propio',
  subcontratado: 'Subcontratado',
};

export const trabajadorCreateSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  documentoIdentidad: z
    .string()
    .trim()
    .max(20, 'Máximo 20 caracteres')
    .nullish(),
  categoryId: z.string().uuid('Categoría no válida').nullish(),
  tipo: z.enum(TRABAJADOR_TIPOS).default('propio'),
  /** Subcontrata a la que pertenece; solo tiene sentido con tipo = 'subcontratado'. */
  proveedorId: z.string().uuid('Proveedor no válido').nullish(),
  ordinaryRateDefault: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(9_999.99)
    .nullish(),
  overtimeRateDefault: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(9_999.99)
    .nullish(),
  activo: z.boolean().default(true),
  fechaAlta: isoDate.nullish(),
  fechaBaja: isoDate.nullish(),
  notas: z.string().trim().max(1000).nullish(),
});

export const trabajadorUpdateSchema = trabajadorCreateSchema.partial();

export type TrabajadorCreateInput = z.input<typeof trabajadorCreateSchema>;
export type TrabajadorUpdateInput = z.input<typeof trabajadorUpdateSchema>;

export interface TrabajadorDto {
  id: string;
  nombre: string;
  documentoIdentidad: string | null;
  categoryId: string | null;
  tipo: TrabajadorTipo;
  proveedorId: string | null;
  proveedorNombre: string | null;
  ordinaryRateDefault: number | null;
  overtimeRateDefault: number | null;
  activo: boolean;
  fechaAlta: string | null;
  fechaBaja: string | null;
  notas: string | null;
  createdAt: string;
}
