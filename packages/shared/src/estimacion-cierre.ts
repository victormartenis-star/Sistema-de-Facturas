/**
 * Estimación al cierre (EAC) editable por obra, al estilo de SAP PS (Estimate
 * at Completion / forecast de costes) y Oracle PPM (Estimate at Completion
 * por proyecto).
 *
 * Cada cambio es una versión inmutable (secuencia por obra) con su fecha de
 * efecto, motivo y usuario. La vigente a una fecha es la de mayor secuencia
 * con efecto en o antes de esa fecha; una versión sin importe vuelve al
 * cálculo automático. La estimación efectiva nunca baja del coste real
 * (`costeEstimadoCierreEfectivo` en `calculo.ts`) y alimenta el cuadro de
 * márgenes y la provisión por pérdidas previstas.
 */

import { z } from 'zod';
import type { OrigenEstimacionCierre } from './calculo';

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

export const estimacionCierreSetSchema = z.object({
  /** Coste estimado al cierre; null vuelve al cálculo automático. */
  costeEstimado: z
    .number()
    .finite()
    .min(0)
    .max(9_999_999_999.99)
    .refine(
      (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
      'Como máximo dos decimales',
    )
    .nullable(),
  motivo: z.string().trim().min(3).max(240),
  /** Fecha de efecto (por defecto, hoy); no anterior a la de la vigente. */
  fecha: fecha.optional(),
});
export type EstimacionCierreSetInput = z.input<
  typeof estimacionCierreSetSchema
>;

export interface VersionEstimacionCierreDto {
  version: number;
  fecha: string;
  /** null: vuelta al cálculo automático. */
  costeEstimado: number | null;
  motivo: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  creadoEn: string;
}

export interface EstimacionCierreObraDto {
  projectId: string;
  codigo: string;
  contrato: number | null;
  presupuestado: number;
  costeReal: number;
  comprometido: number;
  costeEstimadoCierreAutomatico: number;
  costeEstimadoCierre: number;
  origen: OrigenEstimacionCierre;
  ajustadaAlReal: boolean;
  margenProyectado: number | null;
  /**
   * Versión vigente: la que se envía en If-Match. 0 si nunca se fijó (en ese
   * caso no se envía If-Match, que solo admite enteros positivos).
   */
  version: number;
  vigente: VersionEstimacionCierreDto | null;
  historial: VersionEstimacionCierreDto[];
}
