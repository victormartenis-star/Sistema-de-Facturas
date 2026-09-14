import { z } from 'zod';
import { round2 } from './calculo';

/**
 * Partes de trabajo diario: personal y maquinaria (Fase 10).
 *
 * Cierran el hueco del "Coste Real Imputado" que hasta ahora solo recogía
 * facturas de compra — en construcción la factura del subcontratista
 * siempre llega semanas después de que el operario trabajase; sin partes
 * diarios, el control de costes va con retraso todo el mes.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

/* ────────────────────── partes de personal ────────────────────── */

export const partePersonalCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  phaseId: z.string().uuid('Partida no válida').nullish(),
  workerName: z
    .string()
    .trim()
    .min(1, 'El nombre del operario es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  categoryId: z.string().uuid('Categoría no válida').nullish(),
  workDate: isoDate,
  ordinaryHours: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(24, 'Máximo 24 horas')
    .default(0),
  overtimeHours: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(24, 'Máximo 24 horas')
    .default(0),
  ordinaryRate: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(9_999.99),
  overtimeRate: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(9_999.99),
  notes: z.string().trim().max(1000).nullish(),
});

export const partePersonalUpdateSchema = partePersonalCreateSchema
  .omit({ projectId: true })
  .partial();

export type PartePersonalCreateInput = z.input<
  typeof partePersonalCreateSchema
>;
export type PartePersonalUpdateInput = z.input<
  typeof partePersonalUpdateSchema
>;

export interface PartePersonalDto {
  id: string;
  projectId: string;
  phaseId: string | null;
  phaseCode: string | null;
  workerName: string;
  categoryId: string | null;
  workDate: string;
  ordinaryHours: number;
  overtimeHours: number;
  ordinaryRate: number;
  overtimeRate: number;
  totalCost: number;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/* ────────────────────── partes de maquinaria ────────────────────── */

export const MAQUINARIA_OWNERSHIPS = ['propia', 'alquilada'] as const;
export type MaquinariaOwnership = (typeof MAQUINARIA_OWNERSHIPS)[number];

export const MAQUINARIA_OWNERSHIP_LABELS: Record<MaquinariaOwnership, string> =
  {
    propia: 'Propia',
    alquilada: 'Alquilada',
  };

export const parteMaquinariaCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  phaseId: z.string().uuid('Partida no válida').nullish(),
  machineName: z
    .string()
    .trim()
    .min(1, 'El nombre/matrícula de la máquina es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  ownership: z.enum(MAQUINARIA_OWNERSHIPS).default('propia'),
  workDate: isoDate,
  hoursUsed: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(24, 'Máximo 24 horas')
    .default(0),
  fuelLiters: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(99_999.99)
    .nullish(),
  hourlyRate: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(9_999.99),
  notes: z.string().trim().max(1000).nullish(),
});

export const parteMaquinariaUpdateSchema = parteMaquinariaCreateSchema
  .omit({ projectId: true })
  .partial();

export type ParteMaquinariaCreateInput = z.input<
  typeof parteMaquinariaCreateSchema
>;
export type ParteMaquinariaUpdateInput = z.input<
  typeof parteMaquinariaUpdateSchema
>;

export interface ParteMaquinariaDto {
  id: string;
  projectId: string;
  phaseId: string | null;
  phaseCode: string | null;
  machineName: string;
  ownership: MaquinariaOwnership;
  workDate: string;
  hoursUsed: number;
  fuelLiters: number | null;
  hourlyRate: number;
  totalCost: number;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/* ────────────────────── lógica pura ────────────────────── */

/** Coste de un parte de personal: horas ordinarias + extra a su precio cada una. */
export function computePartePersonalCost(input: {
  ordinaryHours: number;
  overtimeHours: number;
  ordinaryRate: number;
  overtimeRate: number;
}): number {
  return round2(
    input.ordinaryHours * input.ordinaryRate +
      input.overtimeHours * input.overtimeRate,
  );
}

/** Coste de un parte de maquinaria: horas de uso × tarifa horaria. */
export function computeParteMaquinariaCost(input: {
  hoursUsed: number;
  hourlyRate: number;
}): number {
  return round2(input.hoursUsed * input.hourlyRate);
}
