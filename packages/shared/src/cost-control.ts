import { addMonths, round2 } from './calculo';

/**
 * Control de desviaciones y analítica de costes en tiempo real (Fase 10).
 *
 * Terminología de Gestión del Valor Ganado (EVM — Earned Value Management),
 * la técnica estándar para esto, adaptada a los tres números que ya existen
 * en el ERP:
 *   - BAC (Budget at Completion) = presupuesto activo de la obra (o el
 *     importe de contrato si no hay presupuesto importado).
 *   - AC (Actual Cost) = coste real imputado: facturas de compra no
 *     anuladas + partes de personal + partes de maquinaria.
 *   - EV (Earned Value) = producción certificada acumulada (lo que el
 *     cliente reconoce que se ha ejecutado, vía [[Módulo Certificaciones]]).
 *
 * Todo lo de aquí es aritmética pura, sin Drizzle ni Nest: la parte que
 * junta BAC/AC/EV desde la base de datos vive en
 * `apps/api/src/cost-control/cost-control.service.ts`.
 */

export interface CostControlInputs {
  bac: number;
  ac: number;
  ev: number;
}

export interface CostControlResult {
  bac: number;
  ac: number;
  ev: number;
  /** EV − AC: margen bruto ganado hasta la fecha (positivo = beneficio). */
  currentMargin: number;
  /** currentMargin / EV × 100. `null` si EV = 0 (nada certificado todavía). */
  currentMarginPct: number | null;
  /** Cost Performance Index = EV / AC. `null` si AC = 0 (sin coste real todavía). */
  cpi: number | null;
  /** % de avance económico = EV / BAC × 100. `null` si BAC = 0. */
  percentComplete: number | null;
  /**
   * Estimate at Completion: coste total previsto a fin de obra al ritmo de
   * gasto actual. `BAC / CPI` si hay CPI (fórmula EVM estándar); si no hay
   * coste real todavía (CPI nulo), `AC + (BAC − EV)` — asume que lo que
   * falta por ejecutar costará lo presupuestado, la única suposición
   * razonable sin datos de gasto real.
   */
  eac: number;
  /** BAC − EAC: sobrecoste (negativo) o ahorro (positivo) previsto a fin de obra. */
  varianceAtCompletion: number;
}

/** Desglose del Coste Real Imputado por origen. */
export interface CostControlAcBreakdownDto {
  facturasCompra: number;
  partesPersonal: number;
  partesMaquinaria: number;
}

/** Respuesta completa de `GET /projects/:id/cost-control`. */
export interface CostControlDto extends CostControlResult {
  projectId: string;
  acBreakdown: CostControlAcBreakdownDto;
  sobrecostePorPartida: SobrecostePartidaDto[];
  curvaS: CurvaSPuntoDto[];
  /**
   * Partidas con presupuesto pero sin las dos fechas planificadas puestas:
   * cuantas más haya, más incompleta es `curvaS[].plannedCumulative`. `0`
   * (todas las partidas presupuestadas tienen fechas) no implica que la
   * curva cubra toda la obra si alguna partida sin presupuesto también
   * tiene fechas — esas no aportan nada al PV porque no hay importe que
   * repartir.
   */
  curvaPlanificadaPartidasSinFechas: number;
}

export function computeCostControl(
  inputs: CostControlInputs,
): CostControlResult {
  const bac = round2(inputs.bac);
  const ac = round2(inputs.ac);
  const ev = round2(inputs.ev);

  const currentMargin = round2(ev - ac);
  const currentMarginPct = ev > 0 ? round2((currentMargin / ev) * 100) : null;
  const cpi = ac > 0 ? round2(ev / ac) : null;
  const percentComplete = bac > 0 ? round2((ev / bac) * 100) : null;
  const eac =
    cpi !== null && cpi > 0 ? round2(bac / cpi) : round2(ac + (bac - ev));
  const varianceAtCompletion = round2(bac - eac);

  return {
    bac,
    ac,
    ev,
    currentMargin,
    currentMarginPct,
    cpi,
    percentComplete,
    eac,
    varianceAtCompletion,
  };
}

/* ────────────────────── alertas de sobrecoste por partida ────────────────────── */

export interface SobrecostePartidaInput {
  phaseId: string;
  code: string;
  name: string;
  budget: number;
  actual: number;
}

export interface SobrecostePartidaDto {
  phaseId: string;
  code: string;
  name: string;
  budget: number;
  actual: number;
  deviation: number;
  deviationPct: number | null;
  /** `true` si el gasto real supera el presupuesto de la partida. */
  overBudget: boolean;
}

/**
 * Añade la desviación y la marca de sobrecoste a cada partida. No filtra
 * nada: el que decide qué mostrar como "alerta" (p. ej. solo `overBudget`)
 * es quien consuma esta lista, para no fijar aquí un umbral arbitrario.
 */
export function computeSobrecostePorPartida(
  rows: SobrecostePartidaInput[],
): SobrecostePartidaDto[] {
  return rows.map((row) => {
    const deviation = round2(row.actual - row.budget);
    return {
      ...row,
      budget: round2(row.budget),
      actual: round2(row.actual),
      deviation,
      deviationPct:
        row.budget > 0 ? round2((deviation / row.budget) * 100) : null,
      overBudget: deviation > 0,
    };
  });
}

/* ────────────────────── curva S (avance real vs. producción ganada) ────────────────────── */

export interface CurvaSPuntoDto {
  /** Periodo en formato AAAA-MM. */
  period: string;
  /** Coste real acumulado hasta ese periodo (facturas de compra + partes). */
  actualCumulative: number;
  /** Producción certificada acumulada hasta ese periodo. */
  earnedCumulative: number;
  /**
   * Valor Planificado (PV) acumulado hasta ese periodo, o `null` si ninguna
   * partida de la obra tiene cronograma planificado puesto todavía — así el
   * consumidor distingue "sin dato" de "planificado en cero".
   */
  plannedCumulative: number | null;
}

/**
 * Construye la curva S a partir de movimientos con fecha e importe, ya
 * agrupados por periodo (AAAA-MM) en tres series independientes — coste
 * real, valor ganado y valor planificado — y las acumula. Devuelve un punto
 * por cada periodo que aparece en cualquiera de las series, en orden
 * cronológico, con la acumulación arrastrada de un periodo a otro (si un
 * mes no tuvo movimiento de una serie, mantiene el acumulado del mes
 * anterior).
 *
 * `plannedByPeriod` es opcional y viene de `buildPlannedByPeriod()`: hasta
 * que `project_phases` tuvo `plannedStartDate`/`plannedEndDate` (cronograma
 * introducido a mano, no inferido), este ERP no modelaba ningún plan y
 * fabricar una interpolación de la curva real como si fuera el plan habría
 * sido inventar un dato en vez de calcularlo. Ver [[Control de Costes y
 * Partes Diarios]] para el porqué de esa decisión original.
 */
export function buildCurvaS(
  actualByPeriod: Map<string, number>,
  earnedByPeriod: Map<string, number>,
  plannedByPeriod: Map<string, number> = new Map(),
): CurvaSPuntoDto[] {
  const periods = Array.from(
    new Set([
      ...actualByPeriod.keys(),
      ...earnedByPeriod.keys(),
      ...plannedByPeriod.keys(),
    ]),
  ).sort();
  const hasPlanned = plannedByPeriod.size > 0;

  let actualAcc = 0;
  let earnedAcc = 0;
  let plannedAcc = 0;
  return periods.map((period) => {
    actualAcc = round2(actualAcc + (actualByPeriod.get(period) ?? 0));
    earnedAcc = round2(earnedAcc + (earnedByPeriod.get(period) ?? 0));
    plannedAcc = round2(plannedAcc + (plannedByPeriod.get(period) ?? 0));
    return {
      period,
      actualCumulative: actualAcc,
      earnedCumulative: earnedAcc,
      plannedCumulative: hasPlanned ? plannedAcc : null,
    };
  });
}

/* ────────────────────── curva planificada (Valor Planificado / PV) ────────────────────── */

export interface FasePlanificadaInput {
  budgetAmount: number;
  /** `AAAA-MM-DD`. */
  plannedStartDate: string;
  /** `AAAA-MM-DD`; si es anterior a `plannedStartDate` la partida se ignora. */
  plannedEndDate: string;
}

/**
 * Reparte linealmente el presupuesto de cada partida planificada entre los
 * meses naturales de su cronograma (ambos inclusive) y agrega el resultado
 * por periodo (AAAA-MM) — mismo formato de entrada que `actualByPeriod`/
 * `earnedByPeriod` en `buildCurvaS`. Reparto lineal, no una curva S propia
 * por partida: es la simplificación estándar de una línea base PV sin datos
 * de ritmo de ejecución previsto mes a mes: más simple que la realidad, pero
 * calculado a partir de un plan real (fechas puestas a mano), no inventado.
 */
export function buildPlannedByPeriod(
  phases: FasePlanificadaInput[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const phase of phases) {
    if (phase.budgetAmount <= 0) continue;
    if (phase.plannedEndDate < phase.plannedStartDate) continue;

    const months: string[] = [];
    let cursor = phase.plannedStartDate.slice(0, 7);
    const endMonth = phase.plannedEndDate.slice(0, 7);
    while (cursor <= endMonth) {
      months.push(cursor);
      cursor = addMonths(`${cursor}-01`, 1).slice(0, 7);
    }

    const perMonth = phase.budgetAmount / months.length;
    for (const month of months) {
      result.set(month, round2((result.get(month) ?? 0) + perMonth));
    }
  }
  return result;
}
