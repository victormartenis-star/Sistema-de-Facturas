import { z } from 'zod';
import { round2 } from './calculo';

/**
 * Coste probable y evolución económica mensual.
 *
 * Es lo que se revisa en la reunión mensual y lo que el Jefe de Grupo tiene
 * que llevar contrastado. Todo lo de este módulo es cálculo puro: entra el
 * dato ya agregado y sale la fotografía económica, sin tocar base de datos.
 */

/* ────────────────────────── coste probable ────────────────────────── */

/**
 * Los cuatro sumandos del coste probable. Están definidos para **no
 * solaparse**: cada euro de coste cae en uno y solo uno de ellos, según lo
 * lejos que esté de estar pagado.
 *
 *   facturado          → ya hay factura de compra registrada
 *   recibido           → hay albarán pero todavía no factura (la provisión)
 *   comprometido       → hay pedido pero el material aún no ha llegado
 *   porContratar       → ni siquiera hay pedido; lo estima el jefe de obra
 *
 * Sumar el importe íntegro de los pedidos al coste ya facturado es el error
 * clásico: cuenta dos veces lo que ya llegó y ha facturado.
 */
export interface ProbableCostInput {
  /** Base imponible de las facturas de compra no anuladas. */
  invoicedCost: number;
  /** Albaranes validados sin factura: la provisión del cierre. */
  accruedCost: number;
  /** Pedidos vivos por la parte todavía no servida. */
  committedCost: number;
  /** Estimación del coste que ni siquiera está pedido. */
  pendingToContract: number;
}

export interface ProbableCost extends ProbableCostInput {
  /** Coste ya devengado: facturado + recibido sin facturar. */
  incurredCost: number;
  /** Coste probable a cierre de obra. */
  total: number;
}

export function computeProbableCost(input: ProbableCostInput): ProbableCost {
  const incurredCost = round2(input.invoicedCost + input.accruedCost);
  return {
    ...input,
    incurredCost,
    total: round2(incurredCost + input.committedCost + input.pendingToContract),
  };
}

export interface MarginAtCompletion {
  salesBudget: number;
  targetCost: number | null;
  probableCost: number;
  /** Margen previsto a cierre en euros. */
  margin: number;
  /** Margen previsto sobre la venta, en porcentaje; null si no hay venta. */
  marginPct: number | null;
  /** Desvío del coste probable frente al objetivo; null si no hay objetivo. */
  costDeviation: number | null;
  costDeviationPct: number | null;
}

/**
 * Previsión a cierre: lo que se va a ganar si nada cambia.
 *
 * El margen se compara contra el **coste objetivo**, no contra el
 * presupuesto de venta: el objetivo es la meta interna y es la que dice si la
 * obra se está desviando, mientras que la venta solo dice cuánto se cobra.
 */
export function computeMarginAtCompletion(
  salesBudget: number,
  targetCost: number | null,
  probableCost: number,
): MarginAtCompletion {
  const margin = round2(salesBudget - probableCost);
  const costDeviation =
    targetCost === null ? null : round2(probableCost - targetCost);
  return {
    salesBudget,
    targetCost,
    probableCost,
    margin,
    marginPct: salesBudget > 0 ? round2((margin / salesBudget) * 100) : null,
    costDeviation,
    costDeviationPct:
      targetCost !== null && targetCost > 0
        ? round2(((probableCost - targetCost) / targetCost) * 100)
        : null,
  };
}

/* ─────────────────────────── semáforo ─────────────────────────── */

export const TRAFFIC_LIGHTS = ['verde', 'ambar', 'rojo'] as const;
export type TrafficLight = (typeof TRAFFIC_LIGHTS)[number];

export const TRAFFIC_LIGHT_LABELS: Record<TrafficLight, string> = {
  verde: 'En objetivo',
  ambar: 'Vigilar',
  rojo: 'Desviado',
};

/** Umbrales de desvío acumulado de coste, en porcentaje. */
export const DEVIATION_THRESHOLDS = { ambar: 2, rojo: 5 };

/**
 * Semáforo de una desviación de coste.
 *
 * Gastar **menos** de lo previsto no es motivo de alarma en el coste, así que
 * el semáforo solo se enciende por exceso. Un ahorro grande sí merece mirarse
 * —suele significar producción no ejecutada—, pero eso lo delata la curva de
 * producción, no la de coste.
 */
export function deviationLight(deviationPct: number | null): TrafficLight {
  if (deviationPct === null) return 'verde';
  if (deviationPct > DEVIATION_THRESHOLDS.rojo) return 'rojo';
  if (deviationPct > DEVIATION_THRESHOLDS.ambar) return 'ambar';
  return 'verde';
}

/* ──────────────────── evolución económica mensual ──────────────────── */

export interface MonthlyInput {
  /** Día 1 del mes, en ISO. */
  month: string;
  plannedProduction: number;
  plannedCost: number;
  realProduction: number;
  realCost: number;
}

export interface MonthlyRow extends MonthlyInput {
  /** Margen del mes: producción real menos coste real. */
  monthMargin: number;
  cumulativePlannedProduction: number;
  cumulativePlannedCost: number;
  cumulativeRealProduction: number;
  cumulativeRealCost: number;
  cumulativeMargin: number;
  /** Desvío acumulado de coste frente al plan, en porcentaje. */
  costDeviationPct: number | null;
  /** Desvío acumulado de producción frente al plan, en porcentaje. */
  productionDeviationPct: number | null;
  light: TrafficLight;
}

export interface MonthlyEvolution {
  rows: MonthlyRow[];
  /**
   * Primer mes en el que el coste real se separa del plan por encima del
   * umbral ámbar. Es el mes en el que hay que buscar la causa: cuando la
   * desviación se ve en el acumulado del último mes, lleva meses ocurriendo.
   */
  firstDivergenceMonth: string | null;
}

/**
 * Construye la evolución mensual acumulando las cuatro series.
 *
 * Los meses se ordenan por fecha antes de acumular: si llegan desordenados,
 * el acumulado saldría mal y nadie lo notaría.
 */
export function buildMonthlyEvolution(
  months: MonthlyInput[],
): MonthlyEvolution {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));

  let cumPlannedProduction = 0;
  let cumPlannedCost = 0;
  let cumRealProduction = 0;
  let cumRealCost = 0;
  let firstDivergenceMonth: string | null = null;

  const rows = sorted.map((m) => {
    cumPlannedProduction = round2(cumPlannedProduction + m.plannedProduction);
    cumPlannedCost = round2(cumPlannedCost + m.plannedCost);
    cumRealProduction = round2(cumRealProduction + m.realProduction);
    cumRealCost = round2(cumRealCost + m.realCost);

    const costDeviationPct =
      cumPlannedCost > 0
        ? round2(((cumRealCost - cumPlannedCost) / cumPlannedCost) * 100)
        : null;
    const productionDeviationPct =
      cumPlannedProduction > 0
        ? round2(
            ((cumRealProduction - cumPlannedProduction) /
              cumPlannedProduction) *
              100,
          )
        : null;

    const light = deviationLight(costDeviationPct);
    if (light !== 'verde' && firstDivergenceMonth === null) {
      firstDivergenceMonth = m.month;
    }

    return {
      ...m,
      monthMargin: round2(m.realProduction - m.realCost),
      cumulativePlannedProduction: cumPlannedProduction,
      cumulativePlannedCost: cumPlannedCost,
      cumulativeRealProduction: cumRealProduction,
      cumulativeRealCost: cumRealCost,
      cumulativeMargin: round2(cumRealProduction - cumRealCost),
      costDeviationPct,
      productionDeviationPct,
      light,
    };
  });

  return { rows, firstDivergenceMonth };
}

/* ───────────────── fiabilidad de la previsión ───────────────── */

/**
 * Contraste de la previsión de un mes contra lo que se supo después.
 *
 * Mide el riesgo de "coste probable complaciente" del mapa de riesgos: si
 * mes tras mes el coste probable que se declaró resultó ser menor que el que
 * acabó siendo, la previsión no es un error puntual, es un sesgo.
 */
export function forecastBias(
  history: { forecastTotal: number; laterTotal: number }[],
): { averageBiasPct: number | null; optimisticMonths: number } {
  const usable = history.filter((h) => h.forecastTotal > 0);
  if (usable.length === 0) {
    return { averageBiasPct: null, optimisticMonths: 0 };
  }
  const sum = usable.reduce(
    (s, h) => s + ((h.laterTotal - h.forecastTotal) / h.forecastTotal) * 100,
    0,
  );
  return {
    averageBiasPct: round2(sum / usable.length),
    optimisticMonths: usable.filter((h) => h.laterTotal > h.forecastTotal)
      .length,
  };
}

/* ────────────────────── esquemas y DTOs ────────────────────── */

const isoMonth = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, 'El mes debe ser el día 1 (AAAA-MM-01)');

const money = z
  .number({ invalid_type_error: 'Debe ser un número' })
  .nonnegative('No puede ser negativo')
  .max(999_999_999_999.99);

export const monthlyPlanRowSchema = z.object({
  month: isoMonth,
  plannedProduction: money.default(0),
  plannedCost: money.default(0),
});

/** El plan se guarda entero de una vez: es un reparto, no filas sueltas. */
export const monthlyPlanSaveSchema = z.object({
  rows: z.array(monthlyPlanRowSchema).max(240, 'Máximo 20 años de plan'),
});

export type MonthlyPlanSaveInput = z.input<typeof monthlyPlanSaveSchema>;

/** Una fila del reparto mensual previsto, tal y como se guarda. */
export interface MonthlyPlanRowDto {
  month: string;
  plannedProduction: number;
  plannedCost: number;
}

export const costForecastSchema = z.object({
  asOfMonth: isoMonth,
  pendingToContract: money,
  notes: z.string().trim().max(2000).nullish(),
  reportedBy: z.string().trim().max(120).nullish(),
});

export type CostForecastInput = z.input<typeof costForecastSchema>;

export interface CostForecastDto {
  id: string;
  asOfMonth: string;
  pendingToContract: number;
  notes: string | null;
  reportedBy: string | null;
  createdAt: string;
}

/** La fotografía económica completa de una obra. */
export interface ProjectEconomicsDto {
  projectId: string;
  projectCode: string;
  projectName: string;
  probableCost: ProbableCost;
  atCompletion: MarginAtCompletion;
  evolution: MonthlyEvolution;
  /** Última estimación de coste pendiente de contratar, si la hay. */
  lastForecast: CostForecastDto | null;
  /** Avisos en lenguaje llano para la reunión mensual. */
  warnings: string[];
}
