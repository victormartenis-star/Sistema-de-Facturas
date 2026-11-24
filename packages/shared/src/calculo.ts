/**
 * Aritmética financiera del ERP.
 *
 * Todas las funciones de este módulo son **puras**: no acceden a la base de
 * datos ni leen la fecha del sistema. Cuando una regla depende de "hoy", la
 * fecha entra como parámetro. Esa disciplina es la que permite comprobar el
 * cálculo del dinero con tests deterministas en lugar de a ojo contra la API.
 *
 * Las reglas implementadas aquí están documentadas en `docs/07-manual-tecnico.md`
 * §4 (dominio financiero del sector).
 */

import {
  applyPct,
  centsToNumeric,
  fromCents,
  mulDivRound,
  repartirCents,
  scaledToNumeric,
  sumCents,
  toCents,
  toScaled,
} from './dinero';
import { tipoCuentaPorCodigo, type TipoCuenta } from './contabilidad';

/* ───────────────────────────── importes ───────────────────────────── */

/**
 * Redondeo a dos decimales en coma flotante.
 *
 * **No usar para dinero**: las reglas de importes de este módulo calculan en
 * céntimos enteros (`dinero.ts`). Se conserva para magnitudes que son
 * coma flotante por naturaleza (VAN/TIR, ratios del control de costes).
 *
 * El dinero se guarda en `numeric` de PostgreSQL, pero el cálculo intermedio
 * ocurre en coma flotante; sin este redondeo aparecen totales como 121.00000000000001.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Suma de importes en céntimos enteros: evita que la coma flotante deje
 * restos (p. ej. 1335.2499999999998 en lugar de 1335.25) en totales visibles.
 */
export function sumarImportes(importes: readonly number[]): number {
  const centimos = importes.reduce((acc, n) => acc + Math.round(n * 100), 0);
  return centimos / 100;
}

/** Tolerancia de cuadre entre importes: un céntimo de redondeo. */
export const MATCHING_TOLERANCE = 0.01;

/** ¿Cuadran dos importes dentro de la tolerancia de redondeo? */
export function amountsMatch(
  a: number,
  b: number,
  tolerance = MATCHING_TOLERANCE,
): boolean {
  return Math.abs(a - b) <= tolerance;
}

export interface InvoiceLineAmount {
  baseAmount: number;
  vatPct: number;
}

export interface InvoiceAmounts {
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  retentionAmount: number;
}

/**
 * Totales de una factura a partir de sus líneas.
 *
 * Dos reglas del sector que conviene no perder de vista:
 *
 * - **ISP (inversión del sujeto pasivo)**: en ejecuciones de obra entre
 *   empresas del sector, el IVA lo autoliquida el destinatario. La factura se
 *   emite con cuota **cero**, no con base exenta ni con tipo 0 %.
 * - **Retención de garantía**: se calcula sobre la **base imponible**, nunca
 *   sobre el total con IVA. Retener el porcentaje sobre el total es el error
 *   más repetido y deja de menos al proveedor.
 */
export function computeInvoiceAmounts(
  lines: InvoiceLineAmount[],
  isp: boolean,
  retentionPct: number,
): InvoiceAmounts {
  const breakdown = computeVatBreakdown(lines, isp);
  return {
    baseAmount: breakdown.baseAmount,
    vatAmount: breakdown.vatAmount,
    totalAmount: breakdown.totalAmount,
    retentionAmount: computeRetention(breakdown.baseAmount, retentionPct),
  };
}

/** Porcentaje de retención de garantía por defecto (el de `projects.retention_pct`). */
export const DEFAULT_RETENTION_PCT = 5;

/**
 * Retención de garantía: siempre sobre la **base imponible**. Única
 * implementación: la usan `computeInvoiceAmounts` y `computeCertification`.
 * Redondeo half-up simétrico en céntimos: 5 % de 20,10 € son 1,01 €.
 */
export function computeRetention(
  baseAmount: number | string,
  retentionPct: number | string,
): number {
  return fromCents(applyPct(toCents(baseAmount), retentionPct));
}

export interface VatGroup {
  vatPct: number;
  baseAmount: number;
  vatAmount: number;
}

export interface VatBreakdown {
  /** Un grupo por tipo de IVA, ordenado de menor a mayor. */
  groups: VatGroup[];
  baseAmount: number;
  /** Suma de cuotas por grupo; 0 con ISP. */
  vatAmount: number;
  totalAmount: number;
  isp: boolean;
  /** Cuota que autoliquida el destinatario con ISP (informativa; 0 sin ISP). */
  selfAssessedVat: number;
}

/**
 * Desglose por tipo de IVA. La cuota se redondea **por grupo** (como exige el
 * libro de IVA), no línea a línea.
 */
export function computeVatBreakdown(
  lines: InvoiceLineAmount[],
  isp: boolean,
): VatBreakdown {
  const byRate = new Map<number, bigint>();
  for (const l of lines) {
    byRate.set(l.vatPct, (byRate.get(l.vatPct) ?? 0n) + toCents(l.baseAmount));
  }
  const groups = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([vatPct, base]) => ({
      vatPct,
      base,
      vat: applyPct(base, vatPct),
    }));
  const base = sumCents(groups.map((g) => g.base));
  const theoreticalVat = sumCents(groups.map((g) => g.vat));
  const vat = isp ? 0n : theoreticalVat;
  return {
    groups: groups.map((g) => ({
      vatPct: g.vatPct,
      baseAmount: fromCents(g.base),
      vatAmount: fromCents(g.vat),
    })),
    baseAmount: fromCents(base),
    vatAmount: fromCents(vat),
    totalAmount: fromCents(base + vat),
    isp,
    selfAssessedVat: isp ? fromCents(theoreticalVat) : 0,
  };
}

/**
 * Reparte un importe entre partes en proporción a sus pesos, en céntimos
 * enteros. Devuelve un importe por peso, en el mismo orden; la suma es
 * exactamente `total`. Regla de resto mayor con desempate por índice más bajo
 * y simetría de signo (ver `repartirCents`).
 */
export function repartirImporte(
  total: number | string,
  pesos: readonly (number | string)[],
): number[] {
  return repartirCents(toCents(total), pesos.map(toCents)).map(fromCents);
}

/** Importe realmente exigible ahora: el total menos lo retenido en garantía. */
export function payableAmount(
  totalAmount: number,
  retentionAmount: number,
): number {
  return fromCents(toCents(totalAmount) - toCents(retentionAmount));
}

/* ─────────────────────────────── fechas ─────────────────────────────── */

/** Fecha de hoy en ISO (`YYYY-MM-DD`), en UTC. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Suma días naturales a una fecha ISO y devuelve otra fecha ISO. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Suma meses naturales a una fecha ISO. */
export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Días naturales entre dos fechas ISO. Positivo si `to` es posterior a `from`,
 * negativo si ya pasó.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    Number(fromIso.slice(0, 4)),
    Number(fromIso.slice(5, 7)) - 1,
    Number(fromIso.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toIso.slice(0, 4)),
    Number(toIso.slice(5, 7)) - 1,
    Number(toIso.slice(8, 10)),
  );
  return Math.round((to - from) / 86_400_000);
}

/** Lunes de la semana a la que pertenece la fecha. */
export function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Día 1 del mes al que pertenece la fecha. */
export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/* ────────────────────────── vencimientos ────────────────────────── */

/** Plazo por defecto de liberación de la retención de garantía (1 año). */
export const RETENTION_DEFAULT_DAYS = 365;

export interface MilestonePlanInput {
  kind: 'compra' | 'venta';
  issueDate: string;
  /** Vencimiento pactado; si falta se calcula con el plazo de pago del contacto. */
  dueDate: string | null;
  totalAmount: number;
  retentionAmount: number;
  retentionReleaseDate: string | null;
  /** Plazo de pago del proveedor o cliente, en días. */
  paymentTermsDays: number;
}

export interface PlannedMilestone {
  direction: 'cobro' | 'pago';
  kind: 'ordinario' | 'retencion';
  dueDate: string;
  amount: number;
}

/**
 * Vencimientos que genera una factura al aprobarse.
 *
 * Una factura con retención de garantía genera **dos** vencimientos, no uno:
 * el ordinario por el importe exigible ahora y otro diferido a la fecha de
 * liberación. Modelarlo como un único vencimiento por el total es lo que hace
 * que las retenciones se olviden y no se reclamen nunca.
 */
export function planMilestones(
  invoice: MilestonePlanInput,
): PlannedMilestone[] {
  const direction = invoice.kind === 'compra' ? 'pago' : 'cobro';
  const ordinary = payableAmount(invoice.totalAmount, invoice.retentionAmount);
  const plan: PlannedMilestone[] = [];

  if (ordinary !== 0) {
    plan.push({
      direction,
      kind: 'ordinario',
      dueDate:
        invoice.dueDate ?? addDays(invoice.issueDate, invoice.paymentTermsDays),
      amount: ordinary,
    });
  }
  if (invoice.retentionAmount > 0) {
    plan.push({
      direction,
      kind: 'retencion',
      dueDate:
        invoice.retentionReleaseDate ??
        addDays(invoice.issueDate, RETENTION_DEFAULT_DAYS),
      amount: invoice.retentionAmount,
    });
  }
  return plan;
}

export interface RectificationMilestoneInput extends MilestonePlanInput {
  rectificationKind: 'total' | 'diferencias';
  /** Solo 'total': lo ya liquidado de la original, por tipo de vencimiento. */
  originalPaid: { ordinario: number; retencion: number };
}

/** Líneas de una rectificativa total: mismas líneas, base con signo cambiado. */
export function buildRectificationLines<T extends { baseAmount: number }>(
  lines: T[],
): T[] {
  return lines.map((l) => ({
    ...l,
    baseAmount: l.baseAmount === 0 ? 0 : -l.baseAmount,
  }));
}

/**
 * Vencimientos de una rectificativa. Importes siempre positivos: lo negativo
 * sale como vencimiento en dirección inversa (abono). En 'total' solo se
 * genera devolución por lo ya liquidado de la original (lo previsto se elimina,
 * no se compensa); en 'diferencias' se reparte el delta como en una factura
 * normal, invirtiendo la dirección de los importes negativos.
 */
export function planRectificationMilestones(
  input: RectificationMilestoneInput,
): PlannedMilestone[] {
  const normal = input.kind === 'compra' ? 'pago' : 'cobro';
  const inversa = normal === 'pago' ? 'cobro' : 'pago';
  const dueOrdinario =
    input.dueDate ?? addDays(input.issueDate, input.paymentTermsDays);
  const dueRetencion =
    input.retentionReleaseDate ??
    addDays(input.issueDate, RETENTION_DEFAULT_DAYS);
  const plan: PlannedMilestone[] = [];

  if (input.rectificationKind === 'total') {
    if (input.originalPaid.ordinario > 0) {
      plan.push({
        direction: inversa,
        kind: 'ordinario',
        dueDate: dueOrdinario,
        amount: input.originalPaid.ordinario,
      });
    }
    if (input.originalPaid.retencion > 0) {
      plan.push({
        direction: inversa,
        kind: 'retencion',
        dueDate: dueOrdinario,
        amount: input.originalPaid.retencion,
      });
    }
    return plan;
  }

  const ordinary = toCents(
    payableAmount(input.totalAmount, input.retentionAmount),
  );
  const retention = toCents(input.retentionAmount);
  if (ordinary !== 0n) {
    plan.push({
      direction: ordinary > 0n ? normal : inversa,
      kind: 'ordinario',
      dueDate: dueOrdinario,
      amount: fromCents(ordinary < 0n ? -ordinary : ordinary),
    });
  }
  if (retention !== 0n) {
    plan.push({
      direction: retention > 0n ? normal : inversa,
      kind: 'retencion',
      dueDate: dueRetencion,
      amount: fromCents(retention < 0n ? -retention : retention),
    });
  }
  return plan;
}

/* ───────────────────────── certificaciones ───────────────────────── */

export interface CertificationAmounts {
  cumulativeAmount: number;
  periodAmount: number;
  retentionAmount: number;
}

/**
 * Certificación **a origen**.
 *
 * En obra no se certifica "lo hecho este mes": se certifica el porcentaje
 * total ejecutado desde el principio, y lo que se cobra en el periodo es la
 * diferencia contra lo ya certificado. Calcularlo por periodos independientes
 * hace imposible corregir una medición anterior sin descuadrar el acumulado.
 */
export function computeCertification(
  contractAmount: number,
  cumulativePct: number,
  previousCumulativeAmount: number,
  retentionPct: number,
): CertificationAmounts {
  const cumulative = applyPct(toCents(contractAmount), cumulativePct);
  const period = cumulative - toCents(previousCumulativeAmount);
  return {
    cumulativeAmount: fromCents(cumulative),
    periodAmount: fromCents(period),
    retentionAmount: computeRetention(fromCents(period), retentionPct),
  };
}

/* ─────────────────── certificaciones de subcontrata ─────────────────── */

export interface CertSubcontrataImportes {
  /** Producción acumulada a origen certificada hasta esta certificación. */
  importeOrigen: number;
  /** A origen de la certificación vigente anterior (0 si es la primera). */
  importeAnterior: number;
  /** `importeOrigen − importeAnterior`. */
  importePeriodo: number;
  /** Retención de garantía sobre el periodo. */
  retencionImporte: number;
  /** Lo que se paga al subcontratista: periodo − retención. */
  importeLiquido: number;
  /** % ejecutado del contrato a origen (2 decimales). */
  pctEjecutado: number;
}

/** Motivo por el que una certificación de subcontrata no cuadra con su contrato. */
export class CertSubcontrataInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertSubcontrataInvalidaError';
  }
}

/**
 * Certificación de subcontrata **a origen** (lo que la constructora debe a
 * su subcontratista). Mismo criterio que `computeCertification`, pero la
 * medición entra en importe, no en %: el jefe de obra mide la producción
 * acumulada del subcontratista contra su contrato.
 *
 * Reglas (lanzan `CertSubcontrataInvalidaError`, la API responde 422):
 * - el a origen no puede bajar del anterior (una corrección a la baja se
 *   hace anulando la última certificación);
 * - el a origen no puede superar el importe del contrato (un exceso exige
 *   antes ampliar el contrato);
 * - un periodo a cero no es una certificación.
 *
 * Todo en céntimos enteros; la retención se redondea half-up.
 */
export function computeCertSubcontrata(
  importeContrato: number,
  importeOrigen: number,
  importeAnterior: number,
  retencionPct: number,
): CertSubcontrataImportes {
  const contrato = toCents(importeContrato);
  const origen = toCents(importeOrigen);
  const anterior = toCents(importeAnterior);
  if (origen < 0n) {
    throw new CertSubcontrataInvalidaError(
      'El importe a origen no puede ser negativo',
    );
  }
  if (origen > contrato) {
    throw new CertSubcontrataInvalidaError(
      `El importe a origen (${fromCents(origen)}) supera el importe del contrato (${fromCents(contrato)}): amplía antes el contrato`,
    );
  }
  if (origen < anterior) {
    throw new CertSubcontrataInvalidaError(
      `El importe a origen (${fromCents(origen)}) es menor que el ya certificado (${fromCents(anterior)}): anula la última certificación para corregirla`,
    );
  }
  const periodo = origen - anterior;
  if (periodo === 0n) {
    throw new CertSubcontrataInvalidaError(
      'El periodo no tiene producción: el importe a origen es igual al ya certificado',
    );
  }
  const retencion = applyPct(periodo, retencionPct);
  return {
    importeOrigen: fromCents(origen),
    importeAnterior: fromCents(anterior),
    importePeriodo: fromCents(periodo),
    retencionImporte: fromCents(retencion),
    importeLiquido: fromCents(periodo - retencion),
    pctEjecutado:
      contrato === 0n ? 0 : Number(mulDivRound(origen, 10000n, contrato)) / 100,
  };
}

export interface ResumenRetencionGarantia {
  /** Retenido por certificaciones aprobadas o pagadas. */
  retenido: number;
  /** Ya devuelto al subcontratista. */
  devuelto: number;
  /** Retenido pendiente de devolver. */
  pendiente: number;
}

/** Saldo de la retención de garantía de un contrato de subcontrata. */
export function resumenRetencionGarantia(
  retenciones: readonly number[],
  devoluciones: readonly number[],
): ResumenRetencionGarantia {
  const retenido = sumCents(retenciones.map((r) => toCents(r)));
  const devuelto = sumCents(devoluciones.map((d) => toCents(d)));
  return {
    retenido: fromCents(retenido),
    devuelto: fromCents(devuelto),
    pendiente: fromCents(retenido - devuelto),
  };
}

/**
 * Valida una devolución de garantía contra el saldo pendiente. Devuelve
 * `null` si es válida o el motivo del rechazo.
 */
export function motivoDevolucionInvalida(
  importe: number,
  pendiente: number,
): string | null {
  const i = toCents(importe);
  if (i <= 0n) return 'El importe a devolver debe ser mayor que 0';
  if (i > toCents(pendiente)) {
    return `El importe a devolver (${fromCents(i)}) supera la retención pendiente (${pendiente})`;
  }
  return null;
}

/* ──────────────────────── inversores: TIR / VAN ──────────────────────── */

export interface CashflowPoint {
  /** Fecha ISO del movimiento. */
  date: string;
  /** Importe con signo: negativo = sale dinero del inversor (aportación), positivo = entra (reparto/venta/valoración). */
  amount: number;
}

/**
 * VAN (valor actual neto) de una serie de flujos con fecha, descontados a
 * `rate` anual y referidos a la fecha del **primer** flujo (no necesariamente
 * hoy: quien llama decide qué punto es "el presente" ordenando la serie).
 * Es la misma función que `computeIrr` busca poner a cero.
 */
export function computeNpv(rate: number, flows: CashflowPoint[]): number {
  if (flows.length === 0) return 0;
  const t0 = flows[0].date;
  return round2(
    flows.reduce((sum, f) => {
      const years = daysBetween(t0, f.date) / 365;
      return sum + f.amount / Math.pow(1 + rate, years);
    }, 0),
  );
}

/**
 * TIR (tasa interna de retorno) anualizada de una serie de flujos con fecha
 * real — método XIRR, no el TIR periódico de Excel que asume periodos
 * regulares (aquí las aportaciones y repartos caen en fechas cualquiera).
 *
 * Newton-Raphson desde `guess`, con bisección como red de seguridad cuando
 * no converge (pasa con series de importes muy desiguales). Devuelve `null`
 * si no se puede calcular: menos de 2 flujos, todos del mismo signo (no hay
 * retorno que buscar), o no converge en el rango [-99 %, 1000 %].
 */
export function computeIrr(flows: CashflowPoint[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  const hasPositive = flows.some((f) => f.amount > 0);
  const hasNegative = flows.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const t0 = flows[0].date;
  const npv = (rate: number) => computeNpv(rate, flows);
  const derivative = (rate: number) =>
    flows.reduce((sum, cf) => {
      const years = daysBetween(t0, cf.date) / 365;
      if (years === 0) return sum;
      return sum - (years * cf.amount) / Math.pow(1 + rate, years + 1);
    }, 0);

  let rate = guess;
  for (let i = 0; i < 50; i++) {
    const value = npv(rate);
    const slope = derivative(rate);
    if (Math.abs(slope) < 1e-9) break;
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < 1e-7) return Math.round(next * 10000) / 10000;
    rate = next;
  }

  // Newton no convergió: bisección en un rango amplio de tasas plausibles.
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) {
    return null;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 0.01) return Math.round(mid * 10000) / 10000;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return Math.round(((lo + hi) / 2) * 10000) / 10000;
}

/* ──────────────── liquidaciones parciales de vencimientos ──────────────── */

/**
 * Estado de liquidación derivado de un vencimiento (partida abierta):
 * `pendiente` sin nada liquidado, `parcial` con parte liquidada y
 * `liquidado` cuando el saldo vivo es cero. El `status` persistido sigue
 * siendo `previsto` (partida abierta) hasta que se liquida del todo.
 */
export const ESTADOS_LIQUIDACION = [
  'pendiente',
  'parcial',
  'liquidado',
] as const;
export type EstadoLiquidacion = (typeof ESTADOS_LIQUIDACION)[number];

export interface ResumenLiquidacion {
  importe: number;
  liquidado: number;
  pendiente: number;
  estado: EstadoLiquidacion;
}

/**
 * Importe, liquidado y pendiente exactos en céntimos. Los vencimientos de
 * rectificativas tienen importe negativo: el liquidado lleva el mismo signo.
 */
export function resumenLiquidacion(
  importe: string | number,
  liquidado: string | number,
): ResumenLiquidacion {
  const total = toCents(importe);
  const hecho = toCents(liquidado);
  const pendiente = total - hecho;
  return {
    importe: fromCents(total),
    liquidado: fromCents(hecho),
    pendiente: fromCents(pendiente),
    estado:
      pendiente === 0n ? 'liquidado' : hecho === 0n ? 'pendiente' : 'parcial',
  };
}

export interface RechazoLiquidacion {
  code:
    | 'SETTLEMENT_AMOUNT_INVALID'
    | 'SETTLEMENT_EXCEEDS_OUTSTANDING'
    | 'SETTLEMENT_DATE_IN_FUTURE'
    | 'DUE_ALREADY_SETTLED';
  message: string;
}

/**
 * Valida una liquidación (cobro o pago, total o parcial) contra el saldo
 * vivo del vencimiento. `cantidad` es la magnitud positiva que se cobra o
 * paga; el signo lo pone el vencimiento (`importeLiquidacionConSigno`).
 * No se admite sobrepago: el exceso es otra operación (anticipo, compensación).
 */
export function motivoLiquidacionInvalida(p: {
  importe: string | number;
  liquidado: string | number;
  cantidad: string | number;
  fecha: string;
  hoy: string;
}): RechazoLiquidacion | null {
  const cantidad = toCents(p.cantidad);
  const pendiente = toCents(p.importe) - toCents(p.liquidado);
  const vivo = pendiente < 0n ? -pendiente : pendiente;
  if (vivo === 0n) {
    return {
      code: 'DUE_ALREADY_SETTLED',
      message: 'El vencimiento ya está liquidado del todo',
    };
  }
  if (cantidad <= 0n) {
    return {
      code: 'SETTLEMENT_AMOUNT_INVALID',
      message: 'El importe de la liquidación debe ser mayor que cero',
    };
  }
  if (cantidad > vivo) {
    return {
      code: 'SETTLEMENT_EXCEEDS_OUTSTANDING',
      message: `El importe (${fromCents(cantidad).toFixed(2)}) supera el saldo pendiente del vencimiento (${fromCents(vivo).toFixed(2)})`,
    };
  }
  if (p.fecha > p.hoy) {
    return {
      code: 'SETTLEMENT_DATE_IN_FUTURE',
      message: 'La fecha de la liquidación no puede ser posterior a hoy',
    };
  }
  return null;
}

/** Importe con el signo del vencimiento (negativo en rectificativas), en céntimos. */
export function importeLiquidacionConSigno(
  importeVencimiento: string | number,
  cantidad: string | number,
): bigint {
  const c = toCents(cantidad);
  return toCents(importeVencimiento) < 0n ? -c : c;
}

/* ───────────────────── amortización de activos fijos ───────────────────── */

export interface CuotaAmortizacion {
  ejercicio: number;
  mes: number;
  cuota: number;
  acumulada: number;
  valorNeto: number;
}

/**
 * Cuadro de amortización lineal mensual (método lineal, PGC): la base
 * amortizable (`coste − residual`) se reparte en `vidaMeses` cuotas desde el
 * mes de puesta en servicio, mes completo. Exacto en céntimos: los céntimos
 * sobrantes van a las primeras cuotas (regla de resto mayor de
 * `repartirCents`), así que la suma de cuotas es exactamente la base.
 */
export function cuadroAmortizacion(p: {
  coste: string | number;
  residual: string | number;
  vidaMeses: number;
  inicio: string;
}): CuotaAmortizacion[] {
  if (!Number.isInteger(p.vidaMeses) || p.vidaMeses <= 0) {
    throw new RangeError('La vida útil debe ser un número entero de meses > 0');
  }
  const coste = toCents(p.coste);
  const base = coste - toCents(p.residual);
  if (base < 0n) throw new RangeError('El valor residual supera el coste');
  const cuotas = repartirCents(
    base,
    Array.from({ length: p.vidaMeses }, () => 1n),
  );
  let [y, m] = p.inicio.split('-').map(Number);
  let acumulada = 0n;
  return cuotas.map((c) => {
    acumulada += c;
    const fila = {
      ejercicio: y,
      mes: m,
      cuota: fromCents(c),
      acumulada: fromCents(acumulada),
      valorNeto: fromCents(coste - acumulada),
    };
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return fila;
  });
}

/** Clave ordenable `AAAA-MM` de un período. */
export function clavePeriodo(ejercicio: number, mes: number): string {
  return `${ejercicio}-${String(mes).padStart(2, '0')}`;
}

/**
 * Resultado de la baja de un activo: valor neto contable y beneficio
 * (positivo) o pérdida (negativo) frente al importe obtenido.
 */
export function resultadoBaja(p: {
  coste: string | number;
  acumulada: string | number;
  importeVenta: string | number;
}): { valorNeto: number; resultado: number } {
  const neto = toCents(p.coste) - toCents(p.acumulada);
  return {
    valorNeto: fromCents(neto),
    resultado: fromCents(toCents(p.importeVenta) - neto),
  };
}

/* ──────────── stock: valoración a precio medio ponderado (PMP) ────────────
 * Modelo de SAP MM (precio medio variable): el saldo de cada artículo en un
 * almacén guarda la CANTIDAD (3 decimales, exacta en milésimas) y el VALOR
 * (céntimos); el PMP es su cociente. Guardar el valor —y no el PMP— hace que
 * la valoración no derive nunca: una salida se valora a `valor × q / cantidad`
 * redondeado al céntimo y, si vacía el saldo, se lleva el valor restante
 * entero. Así cantidad 0 ⇔ valor 0 y la suma de lo que sale es exactamente lo
 * que entró. Todo en BigInt; entra y sale texto `numeric` para Drizzle.
 */

/** Decimales de las cantidades de stock. */
export const ESCALA_CANTIDAD_STOCK = 3;
/** Decimales del precio medio ponderado y de los costes unitarios. */
export const ESCALA_PMP = 4;

export type CodigoErrorStock =
  'INSUFFICIENT_STOCK' | 'STOCK_COST_REQUIRED' | 'STOCK_QUANTITY_INVALID';

/** Rechazo de una regla de stock; la API lo traduce a RFC 7807 con `codigo`. */
export class ErrorStock extends Error {
  constructor(
    readonly codigo: CodigoErrorStock,
    message: string,
    /** Cantidad disponible cuando el rechazo es por falta de stock. */
    readonly disponible?: string,
  ) {
    super(message);
    this.name = 'ErrorStock';
  }
}

/** Saldo valorado de un artículo en un almacén (texto `numeric`). */
export interface SaldoValorado {
  cantidad: string;
  valor: string;
  /** Valor / cantidad con 4 decimales; `null` sin existencias. */
  pmp: string | null;
}

type SaldoEntrada = { cantidad: string | number; valor: string | number };

/** valor(céntimos) × 10^k / cantidad(milésimas) = PMP con 4 decimales. */
const FACTOR_PMP = 10n ** BigInt(ESCALA_PMP - 2 + ESCALA_CANTIDAD_STOCK);
/** cantidad(milésimas) × coste(4 dec) / 10^k = céntimos. */
const FACTOR_VALOR = 10n ** BigInt(ESCALA_CANTIDAD_STOCK + ESCALA_PMP - 2);

const cantidadTexto = (q: bigint) => scaledToNumeric(q, ESCALA_CANTIDAD_STOCK);

function construirSaldo(cantidad: bigint, valor: bigint): SaldoValorado {
  return {
    cantidad: cantidadTexto(cantidad),
    valor: centsToNumeric(valor),
    pmp:
      cantidad === 0n
        ? null
        : scaledToNumeric(mulDivRound(valor, FACTOR_PMP, cantidad), ESCALA_PMP),
  };
}

function leerSaldo(s: SaldoEntrada): { cantidad: bigint; valor: bigint } {
  const cantidad = toScaled(s.cantidad, ESCALA_CANTIDAD_STOCK);
  const valor = toCents(s.valor);
  if (cantidad < 0n || valor < 0n) {
    throw new RangeError('Saldo de stock negativo');
  }
  if (cantidad === 0n && valor !== 0n) {
    throw new RangeError('Saldo incoherente: valor sin cantidad');
  }
  return { cantidad, valor };
}

function cantidadPositiva(v: string | number): bigint {
  const q = toScaled(v, ESCALA_CANTIDAD_STOCK);
  if (q <= 0n) {
    throw new ErrorStock(
      'STOCK_QUANTITY_INVALID',
      'La cantidad debe ser mayor que cero',
    );
  }
  return q;
}

/** PMP de un saldo (4 decimales) o `null` si no hay existencias. */
export function pmpDe(s: SaldoEntrada): string | null {
  const { cantidad, valor } = leerSaldo(s);
  return construirSaldo(cantidad, valor).pmp;
}

/** Valor de una entrada: `cantidad × costeUnitario` (4 decimales) al céntimo. */
export function valorEntradaStock(
  cantidad: string | number,
  costeUnitario: string | number,
): string {
  const q = cantidadPositiva(cantidad);
  const coste = toScaled(costeUnitario, ESCALA_PMP);
  if (coste < 0n) throw new RangeError('Coste unitario negativo');
  return centsToNumeric(mulDivRound(q, coste, FACTOR_VALOR));
}

/**
 * Entrada (compra, devolución, sobrante): suma cantidad y valor y recalcula
 * PMP = (valorAnterior + valorEntrada) / (cantidadAnterior + cantidadEntrada).
 */
export function entradaStock(
  actual: SaldoEntrada,
  entrada: SaldoEntrada,
): SaldoValorado {
  const s = leerSaldo(actual);
  const q = cantidadPositiva(entrada.cantidad);
  const v = toCents(entrada.valor);
  if (v < 0n) throw new RangeError('El valor de la entrada es negativo');
  return construirSaldo(s.cantidad + q, s.valor + v);
}

/**
 * Salida (consumo a obra, merma, origen de traspaso) valorada al PMP vigente
 * sin alterarlo. Rechaza dejar el disponible (cantidad − reservada) negativo.
 * Si la salida agota el saldo se lleva todo el valor restante.
 */
export function salidaStock(
  actual: SaldoEntrada,
  cantidad: string | number,
  reservada: string | number = 0,
): { valor: string; saldo: SaldoValorado } {
  const s = leerSaldo(actual);
  const q = cantidadPositiva(cantidad);
  const disponible = s.cantidad - toScaled(reservada, ESCALA_CANTIDAD_STOCK);
  if (q > disponible) {
    const disp = cantidadTexto(disponible < 0n ? 0n : disponible);
    throw new ErrorStock(
      'INSUFFICIENT_STOCK',
      `Stock insuficiente: disponible ${disp}, solicitado ${cantidadTexto(q)}`,
      disp,
    );
  }
  const valor =
    q === s.cantidad ? s.valor : mulDivRound(s.valor, q, s.cantidad);
  return {
    valor: centsToNumeric(valor),
    saldo: construirSaldo(s.cantidad - q, s.valor - valor),
  };
}

/**
 * Traspaso entre almacenes: sale del origen a su PMP y entra en el destino
 * con ese mismo valor, recalculando el PMP del destino. El valor total de
 * las existencias de la empresa no cambia.
 */
export function traspasoStock(
  origen: SaldoEntrada,
  destino: SaldoEntrada,
  cantidad: string | number,
  reservadaOrigen: string | number = 0,
): { valor: string; origen: SaldoValorado; destino: SaldoValorado } {
  const sal = salidaStock(origen, cantidad, reservadaOrigen);
  return {
    valor: sal.valor,
    origen: sal.saldo,
    destino: entradaStock(destino, { cantidad, valor: sal.valor }),
  };
}

/**
 * Regularización por recuento físico: diferencia = contada − teórica.
 * Faltante: salida valorada al PMP (valor negativo). Sobrante: entrada al
 * `costeUnitario` indicado o, si no, al PMP vigente o al último conocido
 * (`pmpReferencia`); sin ninguno se exige el coste. Diferencia 0 → saldo intacto.
 */
export function regularizacionStock(
  actual: SaldoEntrada,
  cantidadContada: string | number,
  opciones: {
    reservada?: string | number;
    costeUnitario?: string | number | null;
    pmpReferencia?: string | number | null;
  } = {},
): { diferencia: string; valor: string; saldo: SaldoValorado } {
  const s = leerSaldo(actual);
  const contada = toScaled(cantidadContada, ESCALA_CANTIDAD_STOCK);
  if (contada < 0n) {
    throw new ErrorStock(
      'STOCK_QUANTITY_INVALID',
      'La cantidad contada no puede ser negativa',
    );
  }
  const reservada = toScaled(opciones.reservada ?? 0, ESCALA_CANTIDAD_STOCK);
  if (contada < reservada) {
    throw new ErrorStock(
      'INSUFFICIENT_STOCK',
      `La cantidad contada (${cantidadTexto(contada)}) es menor que la reservada (${cantidadTexto(reservada)}): libera antes las reservas`,
      cantidadTexto(contada),
    );
  }
  const dif = contada - s.cantidad;
  if (dif === 0n) {
    return {
      diferencia: cantidadTexto(0n),
      valor: '0.00',
      saldo: construirSaldo(s.cantidad, s.valor),
    };
  }
  if (dif < 0n) {
    const sal = salidaStock(actual, cantidadTexto(-dif));
    return {
      diferencia: cantidadTexto(dif),
      valor: centsToNumeric(-toCents(sal.valor)),
      saldo: sal.saldo,
    };
  }
  const vigente = construirSaldo(s.cantidad, s.valor).pmp;
  const coste =
    opciones.costeUnitario ?? vigente ?? opciones.pmpReferencia ?? null;
  if (coste === null || toScaled(coste, ESCALA_PMP) <= 0n) {
    throw new ErrorStock(
      'STOCK_COST_REQUIRED',
      'Sin precio medio de referencia: indica el coste unitario del sobrante',
    );
  }
  const valor = valorEntradaStock(cantidadTexto(dif), coste);
  return {
    diferencia: cantidadTexto(dif),
    valor,
    saldo: construirSaldo(s.cantidad + dif, s.valor + toCents(valor)),
  };
}

/* ─────────── control presupuestario y cuadro de márgenes por obra ───────────
 * Modelo de SAP PS/CO (control de disponibilidad) y Oracle PPM: el coste
 * consumido del presupuesto es lo REAL (ya imputado) más lo COMPROMETIDO
 * (pedido y aún no facturado). Importes en céntimos BigInt; los porcentajes
 * son ratios (coma flotante, 2 decimales) y no se reutilizan como dinero.
 */

type Importe = string | number;

/** `a / b × 100` con 2 decimales; null si el divisor es 0. */
function pct(a: bigint, b: bigint): number | null {
  if (b === 0n) return null;
  return Number(mulDivRound(a, 10_000n, b)) / 100;
}

/**
 * Comprometido pendiente: por compromiso, `importe − ejecutado` sin bajar de
 * cero (lo ya facturado o certificado está en el coste real; contarlo aquí
 * sería contarlo dos veces). Un compromiso sobreejecutado no resta de otros.
 */
export function comprometidoPendiente(
  compromisos: readonly { importe: Importe; ejecutado: Importe }[],
): number {
  return fromCents(
    sumCents(
      compromisos.map((c) => {
        const p = toCents(c.importe) - toCents(c.ejecutado);
        return p > 0n ? p : 0n;
      }),
    ),
  );
}

/**
 * Cobrado expresado en base imponible de la obra, para compararlo con lo
 * facturado (que va en base): por factura, `baseObra × liquidado / total de
 * vencimientos` (el total incluye IVA y retención). Exacto al céntimo.
 */
export function cobradoEnBase(
  facturas: readonly {
    baseObra: Importe;
    totalVencimientos: Importe;
    liquidado: Importe;
  }[],
): number {
  return fromCents(
    sumCents(
      facturas.map((f) => {
        const total = toCents(f.totalVencimientos);
        if (total === 0n) return 0n;
        return mulDivRound(toCents(f.baseObra), toCents(f.liquidado), total);
      }),
    ),
  );
}

export interface EntradaCuadroMargenes {
  /** Importe de contrato (venta); null si no consta. */
  contrato: Importe | null;
  /** Coste presupuestado (presupuesto activo). */
  presupuestado: Importe;
  comprometido: { pedidos: Importe; subcontratas: Importe };
  costeReal: {
    facturasCompra: Importe;
    partesPersonal: Importe;
    partesMaquinaria: Importe;
    almacen: Importe;
    amortizacion: Importe;
  };
  certificado: Importe;
  facturado: Importe;
  /** Cobrado en base imponible (ver `cobradoEnBase`). */
  cobrado: Importe;
}

export interface CuadroMargenesCalculo {
  contrato: number | null;
  presupuestado: number;
  comprometido: number;
  comprometidoDesglose: { pedidos: number; subcontratas: number };
  costeReal: number;
  costeRealDesglose: {
    facturasCompra: number;
    partesPersonal: number;
    partesMaquinaria: number;
    almacen: number;
    amortizacion: number;
  };
  /** Real + comprometido: lo que ya está gastado o atado. */
  consumido: number;
  /** Consumido / presupuestado. */
  consumoPct: number | null;
  /** Presupuestado − consumido (negativo = sobrecoste). */
  desviacion: number;
  desviacionPct: number | null;
  /** Coste estimado al cierre: el mayor de presupuestado y consumido. */
  costeEstimadoCierre: number;
  /** Contrato − presupuestado. */
  margenPrevisto: number | null;
  margenPrevistoPct: number | null;
  /** Contrato − coste estimado al cierre. */
  margenProyectado: number | null;
  margenProyectadoPct: number | null;
  certificado: number;
  facturado: number;
  cobrado: number;
  /** Certificado − coste real. */
  margenReal: number;
  margenRealPct: number | null;
  pendienteCertificar: number | null;
  pendienteFacturar: number;
  pendienteCobro: number;
}

/** Suma campo a campo varias entradas (totales de una cartera de obras). */
export function sumarEntradasCuadro(
  entradas: readonly EntradaCuadroMargenes[],
): EntradaCuadroMargenes {
  const s = (f: (e: EntradaCuadroMargenes) => Importe) =>
    centsToNumeric(sumCents(entradas.map((e) => toCents(f(e)))));
  const conContrato = entradas.filter((e) => e.contrato !== null);
  return {
    contrato:
      conContrato.length === 0
        ? null
        : centsToNumeric(
            sumCents(conContrato.map((e) => toCents(e.contrato as Importe))),
          ),
    presupuestado: s((e) => e.presupuestado),
    comprometido: {
      pedidos: s((e) => e.comprometido.pedidos),
      subcontratas: s((e) => e.comprometido.subcontratas),
    },
    costeReal: {
      facturasCompra: s((e) => e.costeReal.facturasCompra),
      partesPersonal: s((e) => e.costeReal.partesPersonal),
      partesMaquinaria: s((e) => e.costeReal.partesMaquinaria),
      almacen: s((e) => e.costeReal.almacen),
      amortizacion: s((e) => e.costeReal.amortizacion),
    },
    certificado: s((e) => e.certificado),
    facturado: s((e) => e.facturado),
    cobrado: s((e) => e.cobrado),
  };
}

/** Cuadro de márgenes y desviaciones de una obra (o de una cartera sumada). */
export function cuadroMargenesObra(
  e: EntradaCuadroMargenes,
): CuadroMargenesCalculo {
  const contrato = e.contrato === null ? null : toCents(e.contrato);
  const presupuestado = toCents(e.presupuestado);
  const pedidos = toCents(e.comprometido.pedidos);
  const subcontratas = toCents(e.comprometido.subcontratas);
  const comprometido = pedidos + subcontratas;
  const r = {
    facturasCompra: toCents(e.costeReal.facturasCompra),
    partesPersonal: toCents(e.costeReal.partesPersonal),
    partesMaquinaria: toCents(e.costeReal.partesMaquinaria),
    almacen: toCents(e.costeReal.almacen),
    amortizacion: toCents(e.costeReal.amortizacion),
  };
  const costeReal = sumCents(Object.values(r));
  const consumido = costeReal + comprometido;
  const desviacion = presupuestado - consumido;
  const cierre = consumido > presupuestado ? consumido : presupuestado;
  const certificado = toCents(e.certificado);
  const facturado = toCents(e.facturado);
  const cobrado = toCents(e.cobrado);
  const margenReal = certificado - costeReal;
  return {
    contrato: contrato === null ? null : fromCents(contrato),
    presupuestado: fromCents(presupuestado),
    comprometido: fromCents(comprometido),
    comprometidoDesglose: {
      pedidos: fromCents(pedidos),
      subcontratas: fromCents(subcontratas),
    },
    costeReal: fromCents(costeReal),
    costeRealDesglose: {
      facturasCompra: fromCents(r.facturasCompra),
      partesPersonal: fromCents(r.partesPersonal),
      partesMaquinaria: fromCents(r.partesMaquinaria),
      almacen: fromCents(r.almacen),
      amortizacion: fromCents(r.amortizacion),
    },
    consumido: fromCents(consumido),
    consumoPct: pct(consumido, presupuestado),
    desviacion: fromCents(desviacion),
    desviacionPct: pct(desviacion, presupuestado),
    costeEstimadoCierre: fromCents(cierre),
    margenPrevisto:
      contrato === null ? null : fromCents(contrato - presupuestado),
    margenPrevistoPct:
      contrato === null ? null : pct(contrato - presupuestado, contrato),
    margenProyectado: contrato === null ? null : fromCents(contrato - cierre),
    margenProyectadoPct:
      contrato === null ? null : pct(contrato - cierre, contrato),
    certificado: fromCents(certificado),
    facturado: fromCents(facturado),
    cobrado: fromCents(cobrado),
    margenReal: fromCents(margenReal),
    margenRealPct: pct(margenReal, certificado),
    pendienteCertificar:
      contrato === null ? null : fromCents(contrato - certificado),
    pendienteFacturar: fromCents(certificado - facturado),
    pendienteCobro: fromCents(facturado - cobrado),
  };
}

export interface FilaPartidaEntrada {
  phaseId: string | null;
  codigo: string;
  nombre: string;
  /** Capítulo al que pertenece (lo resuelve el llamador) o null. */
  capitulo: string | null;
  presupuestado: Importe;
  comprometido: Importe;
  costeReal: Importe;
}

interface MagnitudesPartida {
  presupuestado: number;
  comprometido: number;
  costeReal: number;
  consumido: number;
  desviacion: number;
  consumoPct: number | null;
}

function magnitudes(p: bigint, c: bigint, r: bigint): MagnitudesPartida {
  const consumido = c + r;
  return {
    presupuestado: fromCents(p),
    comprometido: fromCents(c),
    costeReal: fromCents(r),
    consumido: fromCents(consumido),
    desviacion: fromCents(p - consumido),
    consumoPct: pct(consumido, p),
  };
}

/**
 * Presupuestado / comprometido / real por partida y su agregado por capítulo
 * (exacto: los capítulos suman céntimos, no números redondeados). Una partida
 * o capítulo está excedido si lo consumido supera lo presupuestado.
 */
export function margenPorPartida(filas: readonly FilaPartidaEntrada[]): {
  partidas: (FilaPartidaEntrada & MagnitudesPartida & { excedida: boolean })[];
  capitulos: (MagnitudesPartida & { capitulo: string; excedido: boolean })[];
} {
  const caps = new Map<string, [bigint, bigint, bigint]>();
  const partidas = filas.map((f) => {
    const p = toCents(f.presupuestado);
    const c = toCents(f.comprometido);
    const r = toCents(f.costeReal);
    if (f.capitulo !== null) {
      const acc = caps.get(f.capitulo) ?? [0n, 0n, 0n];
      caps.set(f.capitulo, [acc[0] + p, acc[1] + c, acc[2] + r]);
    }
    return { ...f, ...magnitudes(p, c, r), excedida: c + r > p };
  });
  const capitulos = [...caps.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
    .map(([capitulo, [p, c, r]]) => ({
      capitulo,
      ...magnitudes(p, c, r),
      excedido: c + r > p,
    }));
  return { partidas, capitulos };
}

export type ModoControlPresupuestario = 'observacion' | 'aviso' | 'bloqueo';
export type EstadoControlPresupuestario =
  'sin_presupuesto' | 'ok' | 'aviso' | 'excedido';

export interface EvaluacionControlPresupuestario {
  estado: EstadoControlPresupuestario;
  presupuestado: number;
  /** Real + comprometido antes de la operación. */
  consumido: number;
  /** Importe que añade la operación evaluada (0 al solo consultar). */
  importe: number;
  consumidoTras: number;
  /** Presupuestado × (1 + tolerancia). */
  limite: number;
  /** Límite − consumido tras la operación (negativo = exceso). */
  disponible: number;
  /** Lo que supera el límite (0 si no lo supera). */
  exceso: number;
  consumoPct: number | null;
  /** La operación debe rechazarse (modo bloqueo y excede). */
  bloquea: boolean;
  /** La operación se permite pero queda avisada (modo aviso y excede). */
  avisa: boolean;
}

/**
 * Control de disponibilidad presupuestaria. Una obra sin presupuesto no se
 * controla (`sin_presupuesto`): bloquearla impediría arrancarla. Solo una
 * operación que AÑADE coste (`importe > 0`) puede bloquear o avisar; una que
 * reduce consumo siempre pasa. Estados: `excedido` si supera el límite
 * (presupuesto + tolerancia), `aviso` si supera el umbral de aviso (% del
 * presupuesto), `ok` en otro caso.
 */
export function evaluarControlPresupuestario(p: {
  modo: ModoControlPresupuestario;
  toleranciaPct: Importe;
  umbralAvisoPct: Importe;
  presupuestado: Importe;
  consumido: Importe;
  importe?: Importe;
}): EvaluacionControlPresupuestario {
  const presupuestado = toCents(p.presupuestado);
  const consumido = toCents(p.consumido);
  const importe = toCents(p.importe ?? 0);
  const tras = consumido + importe;
  const limite = presupuestado + applyPct(presupuestado, p.toleranciaPct);
  const umbral = applyPct(presupuestado, p.umbralAvisoPct);
  const exceso = tras > limite ? tras - limite : 0n;
  const estado: EstadoControlPresupuestario =
    presupuestado <= 0n
      ? 'sin_presupuesto'
      : tras > limite
        ? 'excedido'
        : tras > umbral
          ? 'aviso'
          : 'ok';
  const afecta = estado === 'excedido' && importe > 0n;
  return {
    estado,
    presupuestado: fromCents(presupuestado),
    consumido: fromCents(consumido),
    importe: fromCents(importe),
    consumidoTras: fromCents(tras),
    limite: fromCents(limite),
    disponible: fromCents(limite - tras),
    exceso: fromCents(exceso),
    consumoPct: pct(tras, presupuestado),
    bloquea: afecta && p.modo === 'bloqueo',
    avisa: afecta && p.modo === 'aviso',
  };
}

/* ─────────────── flujos de aprobación por umbral (release strategy) ───────────────
 * Modelo de la estrategia de liberación de SAP / Oracle Approvals: una regla
 * por operación (y opcionalmente por obra) fija desde qué importe hace falta
 * aprobación y qué nivel la da. Importes comparados en céntimos BigInt.
 */

export type OperacionAprobacion =
  'pedido_compra' | 'factura_compra' | 'certificacion_subcontrata';

/** Roles que pueden aprobar, de menor a mayor nivel. */
export type RolAprobador = 'administracion' | 'gerente' | 'admin';

export const NIVEL_ROL_APROBADOR: Readonly<Record<RolAprobador, number>> = {
  administracion: 1,
  gerente: 2,
  admin: 3,
};

export interface ReglaUmbral {
  id: string;
  operacion: OperacionAprobacion;
  /** Importe desde el que aplica (inclusive). */
  importeMinimo: Importe;
  /** Obra concreta o null (todas). */
  projectId: string | null;
  rolRequerido: RolAprobador;
  activa: boolean;
}

/**
 * Regla que gobierna una operación: entre las activas de esa operación que
 * aplican a la obra (las de la obra o las generales) y cuyo umbral alcanza
 * el importe, la de mayor umbral. A igual umbral, la específica de la obra; y
 * a igualdad de todo, la que exige mayor nivel. Null: no requiere aprobación.
 */
export function reglaAplicable<R extends ReglaUmbral>(
  reglas: readonly R[],
  p: {
    operacion: OperacionAprobacion;
    projectId: string | null;
    importe: Importe;
  },
): R | null {
  const importe = toCents(p.importe);
  let mejor: R | null = null;
  for (const r of reglas) {
    if (!r.activa || r.operacion !== p.operacion) continue;
    if (r.projectId !== null && r.projectId !== p.projectId) continue;
    const min = toCents(r.importeMinimo);
    if (importe < min) continue;
    if (!mejor) {
      mejor = r;
      continue;
    }
    const minMejor = toCents(mejor.importeMinimo);
    const gana =
      min > minMejor ||
      (min === minMejor &&
        ((r.projectId !== null && mejor.projectId === null) ||
          ((r.projectId === null) === (mejor.projectId === null) &&
            NIVEL_ROL_APROBADOR[r.rolRequerido] >
              NIVEL_ROL_APROBADOR[mejor.rolRequerido])));
    if (gana) mejor = r;
  }
  return mejor;
}

export type CodigoDecisionAprobacion =
  'SELF_APPROVAL_FORBIDDEN' | 'APPROVAL_ROLE_INSUFFICIENT';

/**
 * ¿Puede este usuario decidir (aprobar o rechazar) la solicitud? Segregación
 * de funciones: quien la pidió no la decide; y el rol debe alcanzar el nivel
 * requerido (un nivel superior también vale). Null = puede.
 */
export function impedimentoAprobador(p: {
  aprobadorId: string;
  solicitanteId: string | null;
  rolAprobador: string;
  rolRequerido: RolAprobador;
}): CodigoDecisionAprobacion | null {
  if (p.solicitanteId !== null && p.aprobadorId === p.solicitanteId) {
    return 'SELF_APPROVAL_FORBIDDEN';
  }
  const nivel = NIVEL_ROL_APROBADOR[p.rolAprobador as RolAprobador] ?? 0;
  if (nivel < NIVEL_ROL_APROBADOR[p.rolRequerido]) {
    return 'APPROVAL_ROLE_INSUFFICIENT';
  }
  return null;
}

export type EstadoSolicitudAprobacion =
  'pendiente' | 'aprobada' | 'rechazada' | 'invalidada' | 'anulada';

export type ResultadoAprobacion =
  'no_requerida' | 'aprobada' | 'pendiente' | 'rechazada' | 'sin_solicitud';

export interface EvaluacionAprobacion {
  requerida: boolean;
  resultado: ResultadoAprobacion;
  /** Código RFC 7807 si la operación debe bloquearse; null si puede seguir. */
  errorCode:
    'APPROVAL_REQUIRED' | 'APPROVAL_PENDING' | 'APPROVAL_REJECTED' | null;
  motivo: string;
}

/**
 * ¿Puede avanzar la operación? Con regla aplicable necesita la última
 * solicitud del documento aprobada, por un importe que cubra el actual y con
 * un nivel al menos igual al que exige hoy la regla (si el importe subió de
 * tramo, la aprobación vieja no basta).
 */
export function evaluarAprobacion(p: {
  regla: Pick<ReglaUmbral, 'rolRequerido' | 'importeMinimo'> | null;
  solicitud: {
    estado: EstadoSolicitudAprobacion;
    importe: Importe;
    rolRequerido: RolAprobador;
  } | null;
  importeActual: Importe;
}): EvaluacionAprobacion {
  if (!p.regla) {
    return {
      requerida: false,
      resultado: 'no_requerida',
      errorCode: null,
      motivo: 'Por debajo de los umbrales de aprobación',
    };
  }
  const s = p.solicitud;
  if (!s || s.estado === 'invalidada' || s.estado === 'anulada') {
    return {
      requerida: true,
      resultado: 'sin_solicitud',
      errorCode: 'APPROVAL_REQUIRED',
      motivo: `Requiere aprobación de ${p.regla.rolRequerido}: solicítala antes de continuar`,
    };
  }
  if (s.estado === 'pendiente') {
    return {
      requerida: true,
      resultado: 'pendiente',
      errorCode: 'APPROVAL_PENDING',
      motivo: 'La aprobación está pendiente de decisión',
    };
  }
  if (s.estado === 'rechazada') {
    return {
      requerida: true,
      resultado: 'rechazada',
      errorCode: 'APPROVAL_REJECTED',
      motivo:
        'La aprobación fue rechazada: corrige el documento y vuelve a solicitarla',
    };
  }
  if (toCents(p.importeActual) > toCents(s.importe)) {
    return {
      requerida: true,
      resultado: 'sin_solicitud',
      errorCode: 'APPROVAL_REQUIRED',
      motivo: `El importe actual supera el aprobado (${centsToNumeric(toCents(s.importe))} €): requiere nueva aprobación`,
    };
  }
  if (
    NIVEL_ROL_APROBADOR[s.rolRequerido] <
    NIVEL_ROL_APROBADOR[p.regla.rolRequerido]
  ) {
    return {
      requerida: true,
      resultado: 'sin_solicitud',
      errorCode: 'APPROVAL_REQUIRED',
      motivo: `El importe exige ahora aprobación de ${p.regla.rolRequerido}`,
    };
  }
  return {
    requerida: true,
    resultado: 'aprobada',
    errorCode: null,
    motivo: 'Aprobada',
  };
}

/**
 * Una edición posterior invalida la aprobación (o la solicitud pendiente) si
 * sube el importe: lo aprobado ya no lo cubre. Bajarlo la mantiene.
 */
export function exigeReaprobacion(
  importeAprobado: Importe,
  importeNuevo: Importe,
): boolean {
  return toCents(importeNuevo) > toCents(importeAprobado);
}

/* ─────────────────── consolidación de grupo (holding) ───────────────────
 * Modelo de SAP Group Reporting / Oracle FCC adaptado a las NOFCAC: saldos del
 * mayor de cada sociedad, integración global (100 % con socios externos) o
 * proporcional (al % de participación), eliminaciones intragrupo como
 * asientos de consolidación cuadrados y descuadres llevados a 5550. Todo en
 * céntimos BigInt; los saldos van como saldo deudor (debe − haber).
 */

export type MetodoConsolidacion = 'global' | 'proporcional';

/** Cuenta puente de las diferencias de conciliación intragrupo (PGC 555). */
export const CUENTA_DESCUADRE_INTRAGRUPO = '5550';
/** Resultados de periodos anteriores no regularizados (remanente). */
export const CUENTA_RESULTADOS_ANTERIORES = '1200';

export interface SaldoCuenta {
  codigo: string;
  /** Saldo deudor: debe − haber. */
  saldoDeudor: Importe;
}

export interface SociedadConsolidable {
  companyId: string;
  nombre: string;
  metodo: MetodoConsolidacion;
  /** Participación del grupo, 0,01–100 con 2 decimales. */
  participacionPct: Importe;
  saldos: SaldoCuenta[];
}

export interface LineaAjusteConsolidacion {
  cuenta: string;
  debe: Importe;
  haber: Importe;
}

export interface AjusteConsolidacion {
  concepto: string;
  origen: 'automatico' | 'manual';
  lineas: LineaAjusteConsolidacion[];
}

export type MasaConsolidacion = TipoCuenta;
const MASAS: readonly MasaConsolidacion[] = [
  'activo',
  'pasivo',
  'patrimonio',
  'ingreso',
  'gasto',
];
const GRUPOS_PGC = ['1', '2', '3', '4', '5', '6', '7'] as const;

/** Saldo natural (positivo en su lado) de una masa a partir del deudor. */
function natural(masa: MasaConsolidacion, deudor: bigint): bigint {
  return masa === 'activo' || masa === 'gasto' ? deudor : -deudor;
}

export interface FilaConsolidacion {
  clave: string;
  porSociedad: Record<string, number>;
  agregado: number;
  eliminaciones: number;
  consolidado: number;
}

export interface EstadosConsolidadosCalculo {
  /** Saldo deudor neto por grupo PGC 1–7. */
  porGrupo: FilaConsolidacion[];
  /** Saldo natural por masa: activo, pasivo, patrimonio, ingreso, gasto. */
  porMasa: FilaConsolidacion[];
  totales: {
    activo: number;
    pasivo: number;
    /** Patrimonio neto total (incluye socios externos). */
    patrimonio: number;
    ingresos: number;
    gastos: number;
    /** Resultado consolidado del periodo (ingresos − gastos). */
    resultado: number;
    /** Activo − (pasivo + patrimonio + resultado): 0 si el balance cuadra. */
    descuadreBalance: number;
  };
  sociosExternos: {
    /** Patrimonio atribuido a socios externos (integración global < 100 %). */
    patrimonio: number;
    resultado: number;
    porSociedad: { companyId: string; patrimonio: number; resultado: number }[];
  };
  resultadoAtribuidoDominante: number;
  /** Céntimos de redondeo de la integración proporcional llevados a patrimonio. */
  redondeoProporcional: number;
}

function acumula(m: Map<string, bigint>, k: string, v: bigint) {
  m.set(k, (m.get(k) ?? 0n) + v);
}

/**
 * Estados consolidados: agrega los saldos de cada sociedad (al 100 % en
 * global; a su % en proporcional, con el redondeo llevado a patrimonio para
 * que siga cuadrando), aplica los ajustes de consolidación (eliminaciones) y
 * calcula socios externos de las integradas globalmente al < 100 %.
 */
export function consolidarEstados(p: {
  sociedades: readonly SociedadConsolidable[];
  ajustes: readonly AjusteConsolidacion[];
}): EstadosConsolidadosCalculo {
  const ids = p.sociedades.map((s) => s.companyId);
  // grupo|masa -> companyId -> saldo deudor (céntimos)
  const porGrupo = new Map<string, Map<string, bigint>>();
  const porMasa = new Map<string, Map<string, bigint>>();
  const minoritarios: {
    companyId: string;
    patrimonio: bigint;
    resultado: bigint;
  }[] = [];
  let redondeo = 0n;

  for (const s of p.sociedades) {
    const pctCent = toScaled(s.participacionPct, 2);
    if (pctCent <= 0n || pctCent > 10_000n) {
      throw new RangeError(`Participación no válida: ${s.participacionPct}`);
    }
    const proporcional = s.metodo === 'proporcional';
    let suma = 0n;
    let patrimonio = 0n;
    let resultado = 0n;
    const filas: { codigo: string; v: bigint }[] = [];
    for (const c of s.saldos) {
      const original = toCents(c.saldoDeudor);
      const v = proporcional
        ? applyPct(original, s.participacionPct)
        : original;
      filas.push({ codigo: c.codigo, v });
      suma += v;
    }
    if (proporcional && suma !== 0n) {
      // El escalado por cuenta puede descuadrar céntimos: a patrimonio.
      filas.push({ codigo: CUENTA_RESULTADOS_ANTERIORES, v: -suma });
      redondeo += -suma;
    }
    for (const { codigo, v } of filas) {
      const grupo = codigo.charAt(0);
      const masa = tipoCuentaPorCodigo(codigo);
      if (!porGrupo.has(grupo)) porGrupo.set(grupo, new Map());
      if (!porMasa.has(masa)) porMasa.set(masa, new Map());
      acumula(porGrupo.get(grupo)!, s.companyId, v);
      acumula(porMasa.get(masa)!, s.companyId, v);
      if (masa === 'patrimonio') patrimonio += -v;
      if (masa === 'ingreso' || masa === 'gasto') resultado += -v;
    }
    if (!proporcional && pctCent < 10_000n) {
      const externos = 10_000n - pctCent;
      minoritarios.push({
        companyId: s.companyId,
        patrimonio: mulDivRound(patrimonio, externos, 10_000n),
        resultado: mulDivRound(resultado, externos, 10_000n),
      });
    }
  }

  // Ajustes de consolidación (eliminaciones), cuadrados por definición.
  const elimGrupo = new Map<string, bigint>();
  const elimMasa = new Map<string, bigint>();
  for (const a of p.ajustes) {
    let cuadre = 0n;
    for (const l of a.lineas) {
      const v = toCents(l.debe) - toCents(l.haber);
      cuadre += v;
      acumula(elimGrupo, l.cuenta.charAt(0), v);
      acumula(elimMasa, tipoCuentaPorCodigo(l.cuenta), v);
    }
    if (cuadre !== 0n) {
      throw new RangeError(
        `Ajuste de consolidación descuadrado: ${a.concepto}`,
      );
    }
  }

  const fila = (
    clave: string,
    datos: Map<string, bigint> | undefined,
    elim: bigint,
    signo: (v: bigint) => bigint,
  ): FilaConsolidacion & { _consolidado: bigint } => {
    const porSociedad: Record<string, number> = {};
    let agregado = 0n;
    for (const id of ids) {
      const v = datos?.get(id) ?? 0n;
      porSociedad[id] = fromCents(signo(v));
      agregado += v;
    }
    const consolidado = agregado + elim;
    return {
      clave,
      porSociedad,
      agregado: fromCents(signo(agregado)),
      eliminaciones: fromCents(signo(elim)),
      consolidado: fromCents(signo(consolidado)),
      _consolidado: signo(consolidado),
    };
  };
  const limpiar = ({
    _consolidado: _c,
    ...f
  }: FilaConsolidacion & { _consolidado: bigint }) => f;

  const filasGrupo = GRUPOS_PGC.map((g) =>
    fila(g, porGrupo.get(g), elimGrupo.get(g) ?? 0n, (v) => v),
  );
  const filasMasa = MASAS.map((m) =>
    fila(m, porMasa.get(m), elimMasa.get(m) ?? 0n, (v) => natural(m, v)),
  );
  const total = (m: MasaConsolidacion) =>
    filasMasa.find((f) => f.clave === m)!._consolidado;
  const activo = total('activo');
  const pasivo = total('pasivo');
  const patrimonio = total('patrimonio');
  const ingresos = total('ingreso');
  const gastos = total('gasto');
  const resultado = ingresos - gastos;
  const extPatrimonio = sumCents(minoritarios.map((m) => m.patrimonio));
  const extResultado = sumCents(minoritarios.map((m) => m.resultado));

  return {
    porGrupo: filasGrupo.map(limpiar),
    porMasa: filasMasa.map(limpiar),
    totales: {
      activo: fromCents(activo),
      pasivo: fromCents(pasivo),
      patrimonio: fromCents(patrimonio),
      ingresos: fromCents(ingresos),
      gastos: fromCents(gastos),
      resultado: fromCents(resultado),
      descuadreBalance: fromCents(activo - (pasivo + patrimonio + resultado)),
    },
    sociosExternos: {
      patrimonio: fromCents(extPatrimonio),
      resultado: fromCents(extResultado),
      porSociedad: minoritarios.map((m) => ({
        companyId: m.companyId,
        patrimonio: fromCents(m.patrimonio),
        resultado: fromCents(m.resultado),
      })),
    },
    resultadoAtribuidoDominante: fromCents(resultado - extResultado),
    redondeoProporcional: fromCents(redondeo),
  };
}

export interface OperacionesIntragrupo {
  /** Sociedad que vende / acreedora. */
  vendedor: string;
  /** Sociedad que compra / deudora. */
  comprador: string;
  /** Base de las ventas registradas por el vendedor al comprador. */
  ventas: Importe;
  /** Base de las compras registradas por el comprador al vendedor. */
  compras: Importe;
  /** Saldo pendiente de cobro en el vendedor. */
  cobrar: Importe;
  /** Saldo pendiente de pago en el comprador. */
  pagar: Importe;
}

export interface ConciliacionIntragrupo {
  vendedor: string;
  comprador: string;
  ventas: number;
  compras: number;
  diferenciaOperaciones: number;
  cobrar: number;
  pagar: number;
  diferenciaSaldos: number;
  descuadre: boolean;
}

/**
 * Conciliación y eliminación intragrupo por pareja vendedor → comprador:
 *  - Operaciones: 7050 (ventas del vendedor) a 6000 (compras del comprador).
 *  - Saldos: 4000 (deuda del comprador) a 4300 (crédito del vendedor).
 * Cada lado se elimina por su propio importe; la diferencia va a 5550 y se
 * marca como descuadre (operación no registrada o mal registrada en un lado).
 * Con integración proporcional las eliminaciones se escalan al menor % de
 * las dos sociedades (la parte que el grupo integra de ambas).
 */
export function eliminacionesIntragrupo(
  operaciones: readonly OperacionesIntragrupo[],
  factorPct: (vendedor: string, comprador: string) => Importe = () => 100,
): { conciliacion: ConciliacionIntragrupo[]; ajustes: AjusteConsolidacion[] } {
  const conciliacion: ConciliacionIntragrupo[] = [];
  const ajustes: AjusteConsolidacion[] = [];
  for (const o of operaciones) {
    const pct = factorPct(o.vendedor, o.comprador);
    const esc = (v: Importe) =>
      toScaled(pct, 2) === 10_000n ? toCents(v) : applyPct(toCents(v), pct);
    const ventas = esc(o.ventas);
    const compras = esc(o.compras);
    const cobrar = esc(o.cobrar);
    const pagar = esc(o.pagar);
    const difOp = ventas - compras;
    const difSal = cobrar - pagar;
    conciliacion.push({
      vendedor: o.vendedor,
      comprador: o.comprador,
      ventas: fromCents(ventas),
      compras: fromCents(compras),
      diferenciaOperaciones: fromCents(difOp),
      cobrar: fromCents(cobrar),
      pagar: fromCents(pagar),
      diferenciaSaldos: fromCents(difSal),
      descuadre: difOp !== 0n || difSal !== 0n,
    });
    const lado = (
      cuenta: string,
      debe: bigint,
      haber: bigint,
    ): LineaAjusteConsolidacion => ({
      cuenta,
      debe: centsToNumeric(debe),
      haber: centsToNumeric(haber),
    });
    const puente = (dif: bigint) =>
      dif > 0n
        ? lado(CUENTA_DESCUADRE_INTRAGRUPO, 0n, dif)
        : lado(CUENTA_DESCUADRE_INTRAGRUPO, -dif, 0n);
    if (ventas !== 0n || compras !== 0n) {
      ajustes.push({
        concepto: `Eliminación de operaciones intragrupo ${o.vendedor} → ${o.comprador}`,
        origen: 'automatico',
        lineas: [
          lado('7050', ventas, 0n),
          lado('6000', 0n, compras),
          ...(difOp !== 0n ? [puente(difOp)] : []),
        ],
      });
    }
    if (cobrar !== 0n || pagar !== 0n) {
      ajustes.push({
        concepto: `Eliminación de saldos intragrupo ${o.vendedor} → ${o.comprador}`,
        origen: 'automatico',
        lineas: [
          lado('4000', pagar, 0n),
          lado('4300', 0n, cobrar),
          ...(difSal !== 0n ? [puente(-difSal)] : []),
        ],
      });
    }
  }
  return { conciliacion, ajustes };
}

export interface TesoreriaSociedadEntrada {
  companyId: string;
  metodo: MetodoConsolidacion;
  participacionPct: Importe;
  /** Saldo de tesorería (cuentas 57x). */
  liquidez: Importe;
  cobrosExternos: Importe;
  cobrosIntragrupo: Importe;
  pagosExternos: Importe;
  pagosIntragrupo: Importe;
}

/**
 * Posición de tesorería del grupo: liquidez y cartera de cobros y pagos
 * pendientes con terceros. Los recíprocos intragrupo se informan pero no
 * cuentan (se eliminan). Proporcional: al % de participación.
 */
export function posicionTesoreriaGrupo(
  sociedades: readonly TesoreriaSociedadEntrada[],
) {
  let liquidez = 0n;
  let cobros = 0n;
  let pagos = 0n;
  let cobrosIg = 0n;
  let pagosIg = 0n;
  const porSociedad = sociedades.map((s) => {
    const esc = (v: Importe) =>
      s.metodo === 'proporcional'
        ? applyPct(toCents(v), s.participacionPct)
        : toCents(v);
    const l = esc(s.liquidez);
    const c = esc(s.cobrosExternos);
    const pg = esc(s.pagosExternos);
    liquidez += l;
    cobros += c;
    pagos += pg;
    cobrosIg += esc(s.cobrosIntragrupo);
    pagosIg += esc(s.pagosIntragrupo);
    return {
      companyId: s.companyId,
      liquidez: fromCents(l),
      cobrosPendientes: fromCents(c),
      pagosPendientes: fromCents(pg),
      posicionNeta: fromCents(l + c - pg),
    };
  });
  return {
    porSociedad,
    liquidez: fromCents(liquidez),
    cobrosPendientes: fromCents(cobros),
    pagosPendientes: fromCents(pagos),
    posicionNeta: fromCents(liquidez + cobros - pagos),
    intragrupoEliminado: {
      cobros: fromCents(cobrosIg),
      pagos: fromCents(pagosIg),
    },
  };
}
