/**
 * Provisión por pérdidas previstas en obra (contratos onerosos): NRV 14 PGC y
 * adaptación sectorial de empresas constructoras, al estilo del análisis de
 * resultados de SAP PS / CO-PC (reserva por pérdida inminente) y del Project
 * Costing de Oracle.
 *
 * Por obra y mes: la pérdida esperada (coste estimado al cierre − contrato)
 * se reconoce entera; el grado de avance ya ha llevado a resultados la parte
 * realizada (coste real − producción), así que la provisión cubre el resto.
 * Cada cierre contabiliza solo el ajuste frente a la provisión vigente:
 * dotación 6954 (obra) a 4994, o exceso 4994 a 7954 (obra). Un cierre se
 * anula por contra-asiento. Reglas puras en `calculo.ts`
 * (`calcularProvisionPerdidas`, `asientoProvisionPerdidas`).
 */

import { z } from 'zod';
import type { CalculoProvisionPerdidas, EstadoWip } from './calculo';
import { ESTADOS_WIP } from './wip';

/** Cuentas PGC de la provisión por pérdidas previstas. */
export const CUENTAS_PROVISION_PERDIDAS = {
  /** Provisión por contratos onerosos (pasivo). */
  provision: '4994',
  /** Dotación a la provisión (gasto de la obra). */
  dotacion: '6954',
  /** Exceso de provisión (ingreso de la obra). */
  exceso: '7954',
} as const;

const periodo = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM');

export const provisionPerdidasContabilizarSchema = z.object({
  periodo,
  projectId: z.string().uuid(),
});
export type ProvisionPerdidasContabilizarInput = z.input<
  typeof provisionPerdidasContabilizarSchema
>;

export const provisionPerdidasCierreSchema = z.object({ periodo });
export type ProvisionPerdidasCierreInput = z.input<
  typeof provisionPerdidasCierreSchema
>;

export const provisionPerdidasAnularSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type ProvisionPerdidasAnularInput = z.input<
  typeof provisionPerdidasAnularSchema
>;

export const provisionPerdidasQuerySchema = z.object({
  periodo: periodo.optional(),
  projectId: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_WIP).optional(),
});
export type ProvisionPerdidasQuery = z.infer<
  typeof provisionPerdidasQuerySchema
>;

export const provisionPerdidasPropuestaQuerySchema = z.object({
  periodo,
  projectId: z.string().uuid().optional(),
});
export type ProvisionPerdidasPropuestaQuery = z.infer<
  typeof provisionPerdidasPropuestaQuerySchema
>;

/* ────────────────────────────── DTOs ────────────────────────────── */

/** Cálculo de un cierre (sin contabilizar). */
export interface PropuestaProvisionPerdidasDto extends CalculoProvisionPerdidas {
  projectId: string;
  codigo: string;
  nombre: string;
  periodo: string;
  /** Último día del periodo: fecha del asiento. */
  fechaCierre: string;
  produccion: number;
  costeReal: number;
  obraTerminada: boolean;
  /** Ya hay un cierre contabilizado para este periodo. */
  contabilizado: boolean;
  /** Periodo del último cierre contabilizado de la obra (o null). */
  ultimoPeriodo: string | null;
}

export interface ProvisionPerdidasDto extends CalculoProvisionPerdidas {
  id: string;
  projectId: string;
  codigo: string;
  periodo: string;
  fechaCierre: string;
  produccion: number;
  costeReal: number;
  estado: EstadoWip;
  asientoId: string | null;
  contraAsientoId: string | null;
  motivoAnulacion: string | null;
  version: number;
}

export interface ResultadoCierreProvisionPerdidasDto {
  periodo: string;
  contabilizados: number;
  /** Suma de los ajustes contabilizados (dotación > 0, exceso < 0). */
  ajuste: number;
  omitidos: { projectId: string; codigo: string; motivo: string }[];
}
