import { z } from 'zod';
import { round2 } from './calculo';
import { deviationLight, type TrafficLight } from './forecast';

/**
 * Partidas/fases de ejecución de una obra (imputación analítica).
 *
 * Cada partida lleva su presupuesto de coste, y el desvío se mide contra el
 * **coste probable** de la partida, no contra lo gastado hasta hoy. Comparar
 * un presupuesto a fin de obra con el gasto de los meses transcurridos da
 * siempre un ahorro enorme que no existe: a mitad de obra falta por gastar
 * justo lo que falta por ejecutar.
 */

export const phaseCreateSchema = z.object({
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
});

export const phaseUpdateSchema = phaseCreateSchema.partial();

export type PhaseCreateInput = z.input<typeof phaseCreateSchema>;
export type PhaseUpdateInput = z.input<typeof phaseUpdateSchema>;

export interface PhaseDto {
  id: string;
  projectId: string;
  code: string;
  name: string;
  budgetAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Lo que se sabe del coste de una partida, ya agregado desde la base. */
export interface PhaseCostInput {
  phaseId: string | null; // null = coste sin partida asignada
  code: string;
  name: string;
  /** Presupuesto de coste de la partida a fin de obra. */
  budget: number;
  /** Base imponible de las facturas de compra imputadas. */
  invoiced: number;
  /** Albaranes validados que todavía no tienen factura. */
  accrued: number;
  /** Pedido vivo por la parte aún no servida. */
  committed: number;
}

/** Una fila del informe de desvío presupuestario. */
export interface DeviationRowDto extends PhaseCostInput {
  /** Lo que va a costar la partida: facturado + recibido + comprometido. */
  probableCost: number;
  /** Coste probable menos presupuesto. Positivo = sobrecoste. */
  deviation: number;
  deviationPct: number | null; // null si budget = 0
  light: TrafficLight;
  /**
   * ¿Se sabe algo del coste de esta partida? Sin pedidos ni facturas no está
   * ahorrando: está sin contratar, y el desvío no significa nada todavía.
   */
  started: boolean;
}

/** Informe "Presupuesto de coste vs. coste probable" de una obra. */
export interface DeviationReportDto {
  projectId: string;
  contractAmount: number | null;
  budgetTotal: number;
  invoicedTotal: number;
  probableCostTotal: number;
  deviation: number;
  deviationPct: number | null;
  /**
   * Presupuesto de las partidas que todavía no tienen ni un pedido.
   *
   * El coste probable del informe no lo incluye —no hay nada que sumar— así
   * que mientras esto no sea cero el desvío total sale a la baja por fuerza.
   * Es el mismo espejismo que fila a fila, pero en el total, que es la cifra
   * que se lee primero.
   */
  uncommittedBudget: number;
  /** ¿Está contratada toda la obra? Si no, el desvío total es provisional. */
  complete: boolean;
  rows: DeviationRowDto[];
  warnings: string[];
}

/**
 * Monta el informe partida a partida.
 *
 * La partida que todavía no tiene ni un pedido queda marcada como no
 * empezada y sin semáforo: su "ahorro" es el presupuesto entero, y enseñarlo
 * en verde es la manera más rápida de que un capítulo sin contratar parezca
 * un capítulo bajo control.
 */
export function buildDeviationRows(
  inputs: PhaseCostInput[],
): DeviationRowDto[] {
  return inputs.map((p) => {
    const probableCost = round2(p.invoiced + p.accrued + p.committed);
    const started = probableCost > 0;
    const deviation = round2(probableCost - p.budget);
    const deviationPct =
      started && p.budget > 0 ? round2((deviation / p.budget) * 100) : null;
    return {
      ...p,
      probableCost,
      deviation,
      deviationPct,
      light: started ? deviationLight(deviationPct) : 'sin_datos',
      started,
    };
  });
}

/** Lo que hay que leer del informe antes de la reunión. */
export function deviationWarnings(rows: DeviationRowDto[]): string[] {
  const warnings: string[] = [];

  const pasadas = rows.filter((r) => r.light === 'rojo');
  if (pasadas.length > 0) {
    warnings.push(
      `Partidas cuyo coste probable ya supera el presupuesto: ${pasadas
        .map((r) => `${r.code} ${r.name} (${r.deviationPct} %)`)
        .join(
          ', ',
        )}. Lo comprometido no se deshace: la corrección tiene que salir de otra partida o de un modificado.`,
    );
  }

  const sinPresupuesto = rows.filter((r) => r.started && r.budget === 0);
  if (sinPresupuesto.length > 0) {
    warnings.push(
      `Hay coste imputado a partidas sin presupuesto: ${sinPresupuesto
        .map((r) => r.code)
        .join(', ')}. Sin presupuesto no hay desvío que medir.`,
    );
  }

  const sinEmpezar = rows.filter((r) => !r.started && r.budget > 0);
  if (sinEmpezar.length > 0) {
    warnings.push(
      `${sinEmpezar.length} partida(s) sin un solo pedido todavía (${sinEmpezar
        .map((r) => r.code)
        .join(
          ', ',
        )}). No están ahorrando: están sin contratar, y su coste sigue siendo una estimación.`,
    );
  }

  return warnings;
}
