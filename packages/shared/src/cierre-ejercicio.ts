/**
 * Cierre y apertura del ejercicio contable (PGC), al estilo de SAP FI-GL
 * (traspaso de saldos y bloqueo del ejercicio) y Oracle GL (cierre de año).
 *
 * Un cierre genera, en una sola transacción, la regularización (grupos 6 y 7
 * contra 129), el cierre de las cuentas de balance y la apertura del
 * ejercicio siguiente, y bloquea el ejercicio: ningún asiento más se
 * contabiliza en él (FISCAL_YEAR_CLOSED). Se revierte por contra-asientos
 * solo si es el último ejercicio cerrado. Reglas puras en `calculo.ts`
 * (`asientosCierreEjercicio`).
 */

import { z } from 'zod';
import type { LineaCierre } from './calculo';
import type { Transiciones } from './maquina-estados';

export const ESTADOS_CIERRE_EJERCICIO = ['cerrado', 'revertido'] as const;
export type EstadoCierreEjercicio = (typeof ESTADOS_CIERRE_EJERCICIO)[number];

export const ESTADO_CIERRE_EJERCICIO_LABELS: Record<
  EstadoCierreEjercicio,
  string
> = {
  cerrado: 'Cerrado',
  revertido: 'Revertido',
};

/** Una reversión es definitiva: el ejercicio puede volver a cerrarse. */
export const CIERRE_EJERCICIO_TRANSITIONS: Transiciones<EstadoCierreEjercicio> =
  {
    cerrado: ['revertido'],
    revertido: [],
  };

/** Cuenta de resultado del ejercicio (PGC 129). */
export const CUENTA_RESULTADO_EJERCICIO = '1290';

export const ejercicioParamSchema = z.coerce.number().int().min(2000).max(2100);

export const cierreEjercicioRevertirSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type CierreEjercicioRevertirInput = z.input<
  typeof cierreEjercicioRevertirSchema
>;

export interface AsientoCierrePropuestoDto {
  fecha: string;
  lineas: (LineaCierre & { nombreCuenta: string | null })[];
  total: number;
}

/** Vista previa del cierre de un ejercicio (no contabiliza). */
export interface PropuestaCierreEjercicioDto {
  ejercicio: number;
  /** Último día del ejercicio: fecha de la regularización y el cierre. */
  fechaCierre: string;
  /** Primer día del siguiente: fecha de la apertura. */
  fechaApertura: string;
  ingresos: number;
  gastos: number;
  resultado: number;
  regularizacion: AsientoCierrePropuestoDto;
  cierre: AsientoCierrePropuestoDto;
  apertura: AsientoCierrePropuestoDto;
  /** Motivos que impiden cerrar ahora (vacío: se puede cerrar). */
  impedimentos: { code: string; message: string }[];
  /** Cierre vigente del ejercicio (o null). */
  cierreVigente: CierreEjercicioDto | null;
}

export interface CierreEjercicioDto {
  id: string;
  ejercicio: number;
  estado: EstadoCierreEjercicio;
  resultado: number;
  ingresos: number;
  gastos: number;
  asientoRegularizacionId: string | null;
  asientoCierreId: string | null;
  asientoAperturaId: string | null;
  /** Meses que cerró este cierre (se reabren al revertir). */
  mesesCerrados: number[];
  cerradoEn: string;
  motivoReversion: string | null;
  revertidoEn: string | null;
  version: number;
}
