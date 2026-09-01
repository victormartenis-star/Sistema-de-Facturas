import { z } from 'zod';
import { round2 } from './calculo';
import type { BudgetImpactDto } from './variations';

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
  /**
   * ¿Hay algún coste registrado? Con la obra recién abierta el coste probable
   * es cero, y entonces el margen daría el 100 %: una obra perfecta que en
   * realidad es una obra vacía. Cuando esto es false, el margen se devuelve
   * en null en lugar de un número que invita a no mirar.
   */
  costKnown: boolean;
  /** Margen previsto a cierre; null mientras no haya coste registrado. */
  margin: number | null;
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
  const costKnown = probableCost > 0;
  const margin = costKnown ? round2(salesBudget - probableCost) : null;
  const costDeviation =
    targetCost === null || !costKnown
      ? null
      : round2(probableCost - targetCost);
  return {
    salesBudget,
    targetCost,
    probableCost,
    costKnown,
    margin,
    marginPct:
      margin !== null && salesBudget > 0
        ? round2((margin / salesBudget) * 100)
        : null,
    costDeviation,
    // Sin coste registrado, el desvío daría −100 %: la obra más barata de la
    // historia. No es un ahorro, es que todavía no hay nada anotado.
    costDeviationPct:
      targetCost !== null && targetCost > 0 && costKnown
        ? round2(((probableCost - targetCost) / targetCost) * 100)
        : null,
  };
}

/* ────────────────── cuadre del reparto mensual ────────────────── */

export interface PlanReconciliation {
  plannedProductionTotal: number;
  plannedCostTotal: number;
  salesBudget: number;
  targetCost: number | null;
  /** Reparto menos presupuesto de venta. Negativo = falta por repartir. */
  productionGap: number;
  /** Reparto menos coste objetivo; null si no hay objetivo. */
  costGap: number | null;
  matches: boolean;
}

/** Tolerancia del cuadre: por debajo de esto es redondeo, no descuadre. */
export const PLAN_TOLERANCE_PCT = 1;

/**
 * ¿Suma el reparto mensual lo que dice el presupuesto?
 *
 * Es la comprobación que evita el error más silencioso de todos: repartir por
 * meses una cifra distinta de la presupuestada. La evolución seguiría
 * pintándose igual de bien, pero estaría comparando el coste real contra un
 * plan que no es el plan, y el semáforo diría lo que no es.
 */
export function reconcilePlan(
  rows: { plannedProduction: number; plannedCost: number }[],
  salesBudget: number,
  targetCost: number | null,
): PlanReconciliation {
  const plannedProductionTotal = round2(
    rows.reduce((s, r) => s + r.plannedProduction, 0),
  );
  const plannedCostTotal = round2(rows.reduce((s, r) => s + r.plannedCost, 0));

  const productionGap = round2(plannedProductionTotal - salesBudget);
  const costGap =
    targetCost === null ? null : round2(plannedCostTotal - targetCost);

  const dentroDeTolerancia = (gap: number, total: number) =>
    total === 0 ? gap === 0 : Math.abs(gap / total) * 100 <= PLAN_TOLERANCE_PCT;

  return {
    plannedProductionTotal,
    plannedCostTotal,
    salesBudget,
    targetCost,
    productionGap,
    costGap,
    matches:
      rows.length > 0 &&
      dentroDeTolerancia(productionGap, salesBudget) &&
      (costGap === null || dentroDeTolerancia(costGap, targetCost ?? 0)),
  };
}

/* ─────────────────────────── semáforo ─────────────────────────── */

/**
 * `sin_datos` no es un semáforo apagado por comodidad: es el cuarto estado
 * real. Un mes sin coste anotado no está "en objetivo", está sin cerrar, y
 * pintarlo de verde es exactamente lo que hace que nadie lo cierre.
 */
export const TRAFFIC_LIGHTS = ['sin_datos', 'verde', 'ambar', 'rojo'] as const;
export type TrafficLight = (typeof TRAFFIC_LIGHTS)[number];

export const TRAFFIC_LIGHT_LABELS: Record<TrafficLight, string> = {
  sin_datos: 'Sin datos',
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
 *
 * Sin desvío que mirar (`null`) el semáforo queda en `sin_datos`, no en verde:
 * no saber y estar bien no son lo mismo.
 */
export function deviationLight(deviationPct: number | null): TrafficLight {
  if (deviationPct === null) return 'sin_datos';
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
  /**
   * ¿Hay algo real anotado hasta este mes? Mientras no lo haya, los desvíos
   * se devuelven en null: el acumulado real es cero porque nadie ha cerrado
   * el mes, no porque la obra se esté ejecutando gratis.
   */
  hasRealData: boolean;
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

    // Un mes sin nada anotado da −100 % de desvío de coste, y −100 % es
    // "gastar menos", que el semáforo pinta de verde. Así es como una obra
    // recién abierta aparece entera en objetivo sin que nadie haya cerrado un
    // solo mes. Mientras no haya un euro real, no hay desvío que enseñar.
    const hasRealData = cumRealProduction > 0 || cumRealCost > 0;

    const costDeviationPct =
      hasRealData && cumPlannedCost > 0
        ? round2(((cumRealCost - cumPlannedCost) / cumPlannedCost) * 100)
        : null;
    const productionDeviationPct =
      hasRealData && cumPlannedProduction > 0
        ? round2(
            ((cumRealProduction - cumPlannedProduction) /
              cumPlannedProduction) *
              100,
          )
        : null;

    const light = deviationLight(costDeviationPct);
    if (
      (light === 'ambar' || light === 'rojo') &&
      firstDivergenceMonth === null
    ) {
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
      hasRealData,
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
  /** Cuadro de impacto de las modificaciones sobre el presupuesto. */
  budgetImpact: BudgetImpactDto;
  /** ¿Suma el reparto mensual lo que dice el presupuesto? */
  planReconciliation: PlanReconciliation;
  evolution: MonthlyEvolution;
  /** Última estimación de coste pendiente de contratar, si la hay. */
  lastForecast: CostForecastDto | null;
  /** Avisos en lenguaje llano para la reunión mensual. */
  warnings: string[];
}
