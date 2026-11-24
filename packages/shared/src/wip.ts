/**
 * Obra en curso (WIP) al cierre de periodo: método del grado de avance (NRV 14
 * PGC y adaptación sectorial de empresas constructoras), al estilo del cálculo
 * de resultados de SAP PS / CO-PC y del Project Costing de Oracle.
 *
 * Por obra y mes: WIP a origen = producción ejecutada (última certificación a
 * origen hasta el cierre) − facturado (base de venta emitida hasta el cierre).
 * Se contabiliza la regularización respecto del WIP anterior (4309 / 4389
 * contra 7050 imputado a la obra); un cierre se anula por contra-asiento.
 * Reglas puras en `calculo.ts` (`calcularWip`, `asientoRegularizacionWip`).
 */

import { z } from 'zod';
import type { CalculoWip, EstadoWip } from './calculo';
import type { Transiciones } from './maquina-estados';

export type { EstadoWip } from './calculo';

export const ESTADOS_WIP = [
  'contabilizado',
  'anulado',
] as const satisfies readonly EstadoWip[];

export const ESTADO_WIP_LABELS: Record<EstadoWip, string> = {
  contabilizado: 'Contabilizado',
  anulado: 'Anulado',
};

/** Una anulación es definitiva: se vuelve a cerrar el periodo si procede. */
export const WIP_TRANSITIONS: Transiciones<EstadoWip> = {
  contabilizado: ['anulado'],
  anulado: [],
};

/** Cuentas PGC del cierre de obra en curso. */
export const CUENTAS_WIP = {
  /** Clientes, producción ejecutada pendiente de facturar. */
  pendiente: '4309',
  /** Clientes, producción facturada por anticipado. */
  anticipado: '4389',
  /** Ingreso de la obra (ejecución de obra). */
  ingreso: '7050',
} as const;

const periodo = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM');

export const wipContabilizarSchema = z.object({
  periodo,
  projectId: z.string().uuid(),
});
export type WipContabilizarInput = z.input<typeof wipContabilizarSchema>;

export const wipCierreSchema = z.object({ periodo });
export type WipCierreInput = z.input<typeof wipCierreSchema>;

export const wipAnularSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type WipAnularInput = z.input<typeof wipAnularSchema>;

export const wipQuerySchema = z.object({
  periodo: periodo.optional(),
  projectId: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_WIP).optional(),
});
export type WipQuery = z.infer<typeof wipQuerySchema>;

export const wipPropuestaQuerySchema = z.object({
  periodo,
  projectId: z.string().uuid().optional(),
});
export type WipPropuestaQuery = z.infer<typeof wipPropuestaQuerySchema>;

/* ────────────────────────────── DTOs ────────────────────────────── */

/** Cálculo de un cierre (sin contabilizar). */
export interface PropuestaWipDto extends CalculoWip {
  projectId: string;
  codigo: string;
  nombre: string;
  periodo: string;
  /** Último día del periodo: fecha del asiento. */
  fechaCierre: string;
  /** Ya hay un cierre contabilizado para este periodo. */
  contabilizado: boolean;
  /** Periodo del último cierre contabilizado de la obra (o null). */
  ultimoPeriodo: string | null;
}

export interface WipDto extends CalculoWip {
  id: string;
  projectId: string;
  codigo: string;
  periodo: string;
  fechaCierre: string;
  estado: EstadoWip;
  asientoId: string | null;
  contraAsientoId: string | null;
  motivoAnulacion: string | null;
  version: number;
}

export interface ResultadoCierreWipDto {
  periodo: string;
  contabilizados: number;
  /** Suma de las regularizaciones contabilizadas. */
  regularizacion: number;
  omitidos: { projectId: string; codigo: string; motivo: string }[];
}
