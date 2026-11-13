import {
  addMonths,
  computeVatBreakdown,
  round2,
  type InvoiceLineAmount,
  type VatBreakdown,
  type VatGroup,
} from './calculo';
import { fromCents, repartirCents, sumCents, toCents } from './dinero';

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
 * Envoltorio de `computeDesviacionPorPartida` (única implementación de la
 * regla de desviación).
 */
export function computeSobrecostePorPartida(
  rows: SobrecostePartidaInput[],
): SobrecostePartidaDto[] {
  const result = computeDesviacionPorPartida(
    rows.map((r) => ({
      phaseId: r.phaseId,
      code: r.code,
      name: r.name,
      budget: r.budget,
      facturasCompra: r.actual,
      partesPersonal: 0,
      partesMaquinaria: 0,
    })),
  );
  return result.map((r) => ({
    phaseId: r.phaseId as string,
    code: r.code,
    name: r.name,
    budget: r.budget,
    actual: r.actual,
    deviation: r.deviation,
    deviationPct: r.deviationPct,
    overBudget: r.overBudget,
  }));
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

/* ────────────────────── analítica de obra (Fase 3) ────────────────────── */

/** Porcentaje a 2 decimales; `null` si el divisor es 0. */
function pctOf(parte: bigint, total: bigint): number | null {
  if (total === 0n) return null;
  return round2((Number(parte) / Number(total)) * 100);
}

export interface CosteRealDesglose {
  facturasCompra: number | string;
  partesPersonal: number | string;
  partesMaquinaria: number | string;
}

function costesToDto(c: CosteRealDesglose): CostControlAcBreakdownDto {
  return {
    facturasCompra: fromCents(toCents(c.facturasCompra)),
    partesPersonal: fromCents(toCents(c.partesPersonal)),
    partesMaquinaria: fromCents(toCents(c.partesMaquinaria)),
  };
}

export interface MargenBrutoObraInput {
  /** Producción certificada acumulada (EV). */
  certificado: number | string;
  /** Base de facturas de venta aprobadas/pagadas/rectificadas, rectificativas con su signo. */
  facturadoVenta: number | string;
  costes: CosteRealDesglose;
  /** De las facturas de compra, cuánto está todavía en borrador (informativo). */
  facturasCompraEnBorrador?: number | string;
}

export interface MargenBrutoObraDto {
  certificado: number;
  facturadoVenta: number;
  costeReal: number;
  costes: CostControlAcBreakdownDto;
  facturasCompraEnBorrador: number;
  margenSobreCertificado: number;
  margenSobreCertificadoPct: number | null;
  margenSobreFacturado: number;
  margenSobreFacturadoPct: number | null;
  /** Certificado y no facturado todavía (obra ejecutada pendiente de facturar). */
  pendienteFacturar: number;
}

export function computeMargenBrutoObra(
  input: MargenBrutoObraInput,
): MargenBrutoObraDto {
  const certificado = toCents(input.certificado);
  const facturado = toCents(input.facturadoVenta);
  const coste = sumCents([
    toCents(input.costes.facturasCompra),
    toCents(input.costes.partesPersonal),
    toCents(input.costes.partesMaquinaria),
  ]);
  const sobreCert = certificado - coste;
  const sobreFact = facturado - coste;
  return {
    certificado: fromCents(certificado),
    facturadoVenta: fromCents(facturado),
    costeReal: fromCents(coste),
    costes: costesToDto(input.costes),
    facturasCompraEnBorrador: fromCents(
      toCents(input.facturasCompraEnBorrador ?? 0),
    ),
    margenSobreCertificado: fromCents(sobreCert),
    margenSobreCertificadoPct: pctOf(sobreCert, certificado),
    margenSobreFacturado: fromCents(sobreFact),
    margenSobreFacturadoPct: pctOf(sobreFact, facturado),
    pendienteFacturar: fromCents(certificado - facturado),
  };
}

export interface DesviacionPartidaInput {
  /** `null` = coste/presupuesto sin partida. */
  phaseId: string | null;
  code: string;
  name: string;
  budget: number | string;
  facturasCompra: number | string;
  partesPersonal: number | string;
  partesMaquinaria: number | string;
}

export interface DesviacionPartidaDto {
  phaseId: string | null;
  code: string;
  name: string;
  budget: number;
  actual: number;
  costes: CostControlAcBreakdownDto;
  deviation: number;
  deviationPct: number | null;
  overBudget: boolean;
}

export const SIN_PARTIDA_NOMBRE = 'Sin partida';

/**
 * Una fila por partida más, si procede, la fila "Sin partida" (todo lo que
 * llega con `phaseId` nulo, agregado). La suma de `actual` cuadra con el coste
 * real total.
 */
export function computeDesviacionPorPartida(
  rows: DesviacionPartidaInput[],
): DesviacionPartidaDto[] {
  const build = (r: DesviacionPartidaInput): DesviacionPartidaDto => {
    const budget = toCents(r.budget);
    const fc = toCents(r.facturasCompra);
    const pp = toCents(r.partesPersonal);
    const pm = toCents(r.partesMaquinaria);
    const actual = fc + pp + pm;
    const deviation = actual - budget;
    return {
      phaseId: r.phaseId,
      code: r.code,
      name: r.name,
      budget: fromCents(budget),
      actual: fromCents(actual),
      costes: {
        facturasCompra: fromCents(fc),
        partesPersonal: fromCents(pp),
        partesMaquinaria: fromCents(pm),
      },
      deviation: fromCents(deviation),
      deviationPct: budget > 0n ? pctOf(deviation, budget) : null,
      overBudget: deviation > 0n,
    };
  };

  const conPartida = rows.filter((r) => r.phaseId !== null).map(build);
  const sinPartida = rows.filter((r) => r.phaseId === null);
  if (sinPartida.length === 0) return conPartida;

  const suma = (f: (r: DesviacionPartidaInput) => number | string) =>
    fromCents(sumCents(sinPartida.map((r) => toCents(f(r)))));
  const agregada = build({
    phaseId: null,
    code: '',
    name: SIN_PARTIDA_NOMBRE,
    budget: suma((r) => r.budget),
    facturasCompra: suma((r) => r.facturasCompra),
    partesPersonal: suma((r) => r.partesPersonal),
    partesMaquinaria: suma((r) => r.partesMaquinaria),
  });
  if (agregada.budget === 0 && agregada.actual === 0) return conPartida;
  return [...conPartida, agregada];
}

export interface RetencionMovimiento {
  direction: 'cobro' | 'pago';
  amount: number | string;
  /** `AAAA-MM-DD`. */
  dueDate: string;
  status: 'previsto' | 'pagado';
}

export interface RetencionesLadoDto {
  retenido: number;
  liberado: number;
  pendiente: number;
  /** Pendiente cuya fecha de liberación ya pasó. */
  vencido: number;
  /** Primera fecha de liberación pendiente no vencida; `null` si no hay. */
  proximaLiberacion: string | null;
}

export interface RetencionesObraDto {
  aCobrarDeCliente: RetencionesLadoDto;
  aPagarAProveedores: RetencionesLadoDto;
  /** Pendiente a cobrar − pendiente a pagar. */
  saldo: number;
}

function ladoRetenciones(
  movs: RetencionMovimiento[],
  hoy: string,
): { dto: RetencionesLadoDto; pendiente: bigint } {
  let liberado = 0n;
  let pendiente = 0n;
  let vencido = 0n;
  let proxima: string | null = null;
  for (const m of movs) {
    const amount = toCents(m.amount);
    if (m.status === 'pagado') {
      liberado += amount;
      continue;
    }
    pendiente += amount;
    if (m.dueDate < hoy) vencido += amount;
    else if (proxima === null || m.dueDate < proxima) proxima = m.dueDate;
  }
  return {
    pendiente,
    dto: {
      retenido: fromCents(liberado + pendiente),
      liberado: fromCents(liberado),
      pendiente: fromCents(pendiente),
      vencido: fromCents(vencido),
      proximaLiberacion: proxima,
    },
  };
}

/** Orden estable de obras: `projectId` ascendente, `null` (sin obra) al final. */
function compararObras(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Parte de `total` (céntimos) que corresponde a `projectId` cuando se reparte
 * en proporción a `bases` (céntimos por obra; `null` = sin obra, grupo propio).
 */
function parteDeObra(
  total: bigint,
  bases: Map<string | null, bigint>,
  projectId: string,
): bigint {
  const claves = [...bases.keys()].sort(compararObras);
  const partes = repartirCents(
    total,
    claves.map((k) => bases.get(k) ?? 0n),
  );
  const i = claves.indexOf(projectId);
  return i < 0 ? 0n : partes[i];
}

export interface RetencionMovimientoFactura extends RetencionMovimiento {
  invoiceId: string;
}

export interface BaseFacturaObra {
  invoiceId: string;
  /** Obra de las líneas; `null` = sin obra. */
  projectId: string | null;
  /** Base de las líneas de esa obra en esa factura. */
  baseAmount: number | string;
}

/**
 * La retención es de cabecera (sobre la base total de la factura). Devuelve la
 * parte de cada vencimiento que corresponde a `projectId`, repartida entre las
 * obras de la factura en proporción a su base (resto mayor, desempate por
 * `projectId` ascendente, `null` al final). Las líneas sin obra son un grupo
 * propio y retienen su parte. Las partes de 0 céntimos se descartan.
 */
export function prorratearRetencionesDeObra(
  movs: RetencionMovimientoFactura[],
  bases: BaseFacturaObra[],
  projectId: string,
): RetencionMovimiento[] {
  const porFactura = new Map<string, Map<string | null, bigint>>();
  for (const b of bases) {
    const m = porFactura.get(b.invoiceId) ?? new Map<string | null, bigint>();
    m.set(b.projectId, (m.get(b.projectId) ?? 0n) + toCents(b.baseAmount));
    porFactura.set(b.invoiceId, m);
  }
  const out: RetencionMovimiento[] = [];
  for (const mov of movs) {
    const obras = porFactura.get(mov.invoiceId);
    if (!obras) continue;
    const parte = parteDeObra(toCents(mov.amount), obras, projectId);
    if (parte === 0n) continue;
    out.push({
      direction: mov.direction,
      amount: fromCents(parte),
      dueDate: mov.dueDate,
      status: mov.status,
    });
  }
  return out;
}

/** `hoy` entra como parámetro (esta capa no lee el reloj). */
export function computeRetencionesObra(
  movs: RetencionMovimiento[],
  hoy: string,
): RetencionesObraDto {
  const cobro = ladoRetenciones(
    movs.filter((m) => m.direction === 'cobro'),
    hoy,
  );
  const pago = ladoRetenciones(
    movs.filter((m) => m.direction === 'pago'),
    hoy,
  );
  return {
    aCobrarDeCliente: cobro.dto,
    aPagarAProveedores: pago.dto,
    saldo: fromCents(cobro.pendiente - pago.pendiente),
  };
}

export interface FacturaIvaInput {
  kind: 'compra' | 'venta';
  isp: boolean;
  /** `projectId` solo se usa al pedir el IVA de una obra concreta. */
  lines: (InvoiceLineAmount & { projectId?: string | null })[];
}

export interface IvaObraDto {
  /** Ventas sin ISP. */
  repercutido: VatGroup[];
  /** Compras sin ISP. */
  soportado: VatGroup[];
  /** Ventas con ISP: base sin cuota. */
  ispEmitidas: { baseAmount: number };
  /** Compras con ISP: se autoliquida. */
  ispRecibidas: { baseAmount: number; selfAssessedVat: number };
  totalRepercutido: number;
  totalSoportado: number;
  /** Repercutido − soportado (positivo = a ingresar). */
  saldo: number;
}

type AcumuladoIva = Map<number, { base: bigint; vat: bigint }>;

/** Desglose de la factura reducido a la parte de la obra `obra`. */
function desgloseDeObra(f: FacturaIvaInput, obra: string): VatBreakdown {
  const completo = computeVatBreakdown(f.lines, f.isp);
  // Con ISP la cuota oficial es la autoliquidada (la teórica).
  const groups: VatGroup[] = [];
  for (const g of completo.groups) {
    const bases = new Map<string | null, bigint>();
    for (const l of f.lines) {
      if (l.vatPct !== g.vatPct) continue;
      const k = l.projectId ?? null;
      bases.set(k, (bases.get(k) ?? 0n) + toCents(l.baseAmount));
    }
    if (!bases.has(obra)) continue;
    groups.push({
      vatPct: g.vatPct,
      baseAmount: fromCents(bases.get(obra) ?? 0n),
      vatAmount: fromCents(parteDeObra(toCents(g.vatAmount), bases, obra)),
    });
  }
  const base = sumCents(groups.map((g) => toCents(g.baseAmount)));
  const vat = sumCents(groups.map((g) => toCents(g.vatAmount)));
  return {
    groups,
    baseAmount: fromCents(base),
    vatAmount: f.isp ? 0 : fromCents(vat),
    totalAmount: fromCents(f.isp ? base : base + vat),
    isp: f.isp,
    selfAssessedVat: f.isp ? fromCents(vat) : 0,
  };
}

/**
 * No reimplementa el IVA: llama a `computeVatBreakdown` por factura y agrega.
 *
 * Sin `projectId`: agrega las líneas recibidas tal cual. Con `projectId`,
 * `lines` debe traer TODAS las líneas de cada factura (con su `projectId`):
 * la cuota oficial de cada tipo se reparte entre las obras en proporción a su
 * base (resto mayor), así la suma entre obras cuadra al céntimo con la
 * factura. La base de la obra es exacta (suma de sus líneas); no se prorratea.
 */
export function computeIvaObra(
  facturas: FacturaIvaInput[],
  projectId?: string,
): IvaObraDto {
  const repercutido: AcumuladoIva = new Map();
  const soportado: AcumuladoIva = new Map();
  let ispEmitidas = 0n;
  let ispRecibidasBase = 0n;
  let ispRecibidasVat = 0n;

  const acumula = (mapa: AcumuladoIva, groups: VatGroup[]) => {
    for (const g of groups) {
      const prev = mapa.get(g.vatPct) ?? { base: 0n, vat: 0n };
      mapa.set(g.vatPct, {
        base: prev.base + toCents(g.baseAmount),
        vat: prev.vat + toCents(g.vatAmount),
      });
    }
  };

  for (const f of facturas) {
    if (
      projectId !== undefined &&
      !f.lines.some((l) => l.projectId === projectId)
    ) {
      continue;
    }
    const b =
      projectId === undefined
        ? computeVatBreakdown(f.lines, f.isp)
        : desgloseDeObra(f, projectId);
    if (f.isp) {
      if (f.kind === 'venta') ispEmitidas += toCents(b.baseAmount);
      else {
        ispRecibidasBase += toCents(b.baseAmount);
        ispRecibidasVat += toCents(b.selfAssessedVat);
      }
    } else {
      acumula(f.kind === 'venta' ? repercutido : soportado, b.groups);
    }
  }

  const aGrupos = (mapa: AcumuladoIva): VatGroup[] =>
    [...mapa.entries()]
      .sort(([a], [b]) => a - b)
      .map(([vatPct, v]) => ({
        vatPct,
        baseAmount: fromCents(v.base),
        vatAmount: fromCents(v.vat),
      }));
  const total = (mapa: AcumuladoIva) =>
    sumCents([...mapa.values()].map((v) => v.vat));
  const totalRep = total(repercutido);
  const totalSop = total(soportado);

  return {
    repercutido: aGrupos(repercutido),
    soportado: aGrupos(soportado),
    ispEmitidas: { baseAmount: fromCents(ispEmitidas) },
    ispRecibidas: {
      baseAmount: fromCents(ispRecibidasBase),
      selfAssessedVat: fromCents(ispRecibidasVat),
    },
    totalRepercutido: fromCents(totalRep),
    totalSoportado: fromCents(totalSop),
    saldo: fromCents(totalRep - totalSop),
  };
}

/** Respuesta de `GET /projects/:id/economics`. */
export interface ObraEconomicsDto {
  projectId: string;
  generadoEn: string;
  margen: MargenBrutoObraDto;
  desviaciones: DesviacionPartidaDto[];
  retenciones: RetencionesObraDto;
  iva: IvaObraDto;
}
