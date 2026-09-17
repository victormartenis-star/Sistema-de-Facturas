import { z } from 'zod';

/**
 * Partidas/fases de ejecución de una obra (imputación analítica).
 * Cada partida lleva su presupuesto teórico; el desvío se calcula
 * comparándolo con el gasto real imputado en líneas de factura.
 *
 * `plannedStartDate`/`plannedEndDate` son el cronograma planificado de la
 * partida (introducido a mano, no inferido de fechas reales) — la base que
 * permite calcular una curva de avance planificada real en `cost-control.ts`
 * (`buildCurvaPlanificada`), en vez de fabricar una interpolación de la
 * curva real como si fuera el plan. Ver [[Control de Costes y Partes
 * Diarios]] para el porqué de no haberlo hecho antes con datos inventados.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const phaseCreateSchema = z
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
    budgetAmount: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .nonnegative('No puede ser negativo')
      .max(999_999_999_999.99)
      .nullish(),
    plannedStartDate: isoDate.nullish(),
    plannedEndDate: isoDate.nullish(),
  })
  .refine(
    (v) =>
      !v.plannedStartDate ||
      !v.plannedEndDate ||
      v.plannedStartDate <= v.plannedEndDate,
    {
      message:
        'La fecha de inicio planificada no puede ser posterior a la de fin',
      path: ['plannedEndDate'],
    },
  );

export const phaseUpdateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'El código es obligatorio')
      .max(30, 'Máximo 30 caracteres')
      .optional(),
    name: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio')
      .max(200, 'Máximo 200 caracteres')
      .optional(),
    budgetAmount: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .nonnegative('No puede ser negativo')
      .max(999_999_999_999.99)
      .nullish(),
    plannedStartDate: isoDate.nullish(),
    plannedEndDate: isoDate.nullish(),
  })
  .partial()
  .refine(
    (v) =>
      !v.plannedStartDate ||
      !v.plannedEndDate ||
      v.plannedStartDate <= v.plannedEndDate,
    {
      message:
        'La fecha de inicio planificada no puede ser posterior a la de fin',
      path: ['plannedEndDate'],
    },
  );

export type PhaseCreateInput = z.input<typeof phaseCreateSchema>;
export type PhaseUpdateInput = z.input<typeof phaseUpdateSchema>;

export interface PhaseDto {
  id: string;
  projectId: string;
  code: string;
  name: string;
  budgetAmount: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Una fila del informe de desvío presupuestario. */
export interface DeviationRowDto {
  phaseId: string | null; // null = gasto sin partida asignada
  code: string;
  name: string;
  budget: number;
  actual: number;
  deviation: number; // actual - budget (positivo = sobrecoste)
  deviationPct: number | null; // null si budget = 0
}

/** Informe "Presupuesto teórico vs. gasto real imputado" de una obra. */
export interface DeviationReportDto {
  projectId: string;
  contractAmount: number | null;
  budgetTotal: number;
  actualTotal: number;
  deviation: number;
  deviationPct: number | null;
  rows: DeviationRowDto[];
}
