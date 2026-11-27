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
  | 'INSUFFICIENT_STOCK'
  | 'STOCK_COST_REQUIRED'
  | 'STOCK_QUANTITY_INVALID'
  | 'MATERIAL_REQUEST_OVER_SERVED';

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
    /** Comisiones y ejecuciones de avales contabilizadas a la obra. */
    avales?: Importe;
  };
  certificado: Importe;
  facturado: Importe;
  /** Cobrado en base imponible (ver `cobradoEnBase`). */
  cobrado: Importe;
  /**
   * Estimación al cierre manual vigente (EAC fijada por el jefe de obra o
   * control de gestión); null o ausente = cálculo automático.
   */
  estimacionCierre?: Importe | null;
}

export type OrigenEstimacionCierre = 'manual' | 'automatica';

export interface EstimacionCierreEfectiva {
  /** Automática: el mayor de presupuestado y consumido. */
  automatica: number;
  /** La que se usa en márgenes y en la provisión por pérdidas. */
  efectiva: number;
  origen: OrigenEstimacionCierre;
  /** La manual quedó por debajo del coste real y se eleva a él. */
  ajustadaAlReal: boolean;
}

/**
 * Coste estimado al cierre efectivo (EAC, SAP PS / Oracle PPM): la estimación
 * manual vigente si la hay —nunca por debajo del coste real ya incurrido— o,
 * si no, la automática (el mayor de presupuestado y consumido).
 */
export function costeEstimadoCierreEfectivo(p: {
  presupuestado: Importe;
  consumido: Importe;
  costeReal: Importe;
  manual: Importe | null | undefined;
}): EstimacionCierreEfectiva {
  const pres = toCents(p.presupuestado);
  const cons = toCents(p.consumido);
  const real = toCents(p.costeReal);
  const auto = cons > pres ? cons : pres;
  if (p.manual === null || p.manual === undefined) {
    return {
      automatica: fromCents(auto),
      efectiva: fromCents(auto),
      origen: 'automatica',
      ajustadaAlReal: false,
    };
  }
  const manual = toCents(p.manual);
  const ajustada = manual < real;
  return {
    automatica: fromCents(auto),
    efectiva: fromCents(ajustada ? real : manual),
    origen: 'manual',
    ajustadaAlReal: ajustada,
  };
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
    avales: number;
  };
  /** Real + comprometido: lo que ya está gastado o atado. */
  consumido: number;
  /** Consumido / presupuestado. */
  consumoPct: number | null;
  /** Presupuestado − consumido (negativo = sobrecoste). */
  desviacion: number;
  desviacionPct: number | null;
  /**
   * Coste estimado al cierre efectivo: la estimación manual vigente (nunca
   * por debajo del coste real) o, sin ella, el mayor de presupuestado y
   * consumido.
   */
  costeEstimadoCierre: number;
  /** El automático (mayor de presupuestado y consumido), como referencia. */
  costeEstimadoCierreAutomatico: number;
  origenEstimacion: OrigenEstimacionCierre;
  estimacionAjustadaAlReal: boolean;
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
  // Con alguna estimación manual, el total es la suma de las efectivas de
  // cada obra (no se puede reconstruir desde los totales).
  const conManual = entradas.some(
    (e) => e.estimacionCierre !== null && e.estimacionCierre !== undefined,
  );
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
      avales: s((e) => e.costeReal.avales ?? 0),
    },
    certificado: s((e) => e.certificado),
    facturado: s((e) => e.facturado),
    cobrado: s((e) => e.cobrado),
    estimacionCierre: conManual
      ? centsToNumeric(
          sumCents(
            entradas.map((e) =>
              toCents(cuadroMargenesObra(e).costeEstimadoCierre),
            ),
          ),
        )
      : null,
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
    avales: toCents(e.costeReal.avales ?? 0),
  };
  const costeReal = sumCents(Object.values(r));
  const consumido = costeReal + comprometido;
  const desviacion = presupuestado - consumido;
  const eac = costeEstimadoCierreEfectivo({
    presupuestado: centsToNumeric(presupuestado),
    consumido: centsToNumeric(consumido),
    costeReal: centsToNumeric(costeReal),
    manual: e.estimacionCierre,
  });
  const cierre = toCents(eac.efectiva);
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
      avales: fromCents(r.avales),
    },
    consumido: fromCents(consumido),
    consumoPct: pct(consumido, presupuestado),
    desviacion: fromCents(desviacion),
    desviacionPct: pct(desviacion, presupuestado),
    costeEstimadoCierre: fromCents(cierre),
    costeEstimadoCierreAutomatico: eac.automatica,
    origenEstimacion: eac.origen,
    estimacionAjustadaAlReal: eac.ajustadaAlReal,
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

/**
 * Global y proporcional integran los estados línea a línea; la puesta en
 * equivalencia no integra: sustituye la inversión por la parte del
 * patrimonio neto de la participada (`eliminacionInversionPatrimonio`).
 */
export type MetodoConsolidacion =
  'global' | 'proporcional' | 'puesta_equivalencia';

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
  // La puesta en equivalencia no agrega saldos: entra solo por sus ajustes.
  const integradas = p.sociedades.filter(
    (s) => s.metodo !== 'puesta_equivalencia',
  );
  const ids = integradas.map((s) => s.companyId);
  // grupo|masa -> companyId -> saldo deudor (céntimos)
  const porGrupo = new Map<string, Map<string, bigint>>();
  const porMasa = new Map<string, Map<string, bigint>>();
  const minoritarios: {
    companyId: string;
    patrimonio: bigint;
    resultado: bigint;
  }[] = [];
  let redondeo = 0n;

  for (const s of integradas) {
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

/* ───────── Group Reporting: conversión de moneda e inversión–patrimonio ─────────
 * Modelo de SAP S/4HANA Group Reporting (Currency Translation, Consolidation
 * of Investments) y Oracle FCCS adaptado a las NOFCAC (RD 1159/2010):
 *  - Conversión por el método del tipo de cambio de cierre (art. 61): activo
 *    y pasivo al de cierre, PyG al medio del periodo y patrimonio neto al
 *    histórico; la diferencia va a «Diferencias de conversión» (1350, CTA).
 *  - Eliminación inversión–patrimonio neto (art. 22 a 27): el coste de la
 *    participación contra la parte del PN de la dependiente a la toma de
 *    control; el exceso es fondo de comercio de consolidación (2040) y el
 *    defecto, diferencia negativa (7740 en el ejercicio de adquisición,
 *    reservas después). En integración global, los socios externos reciben
 *    su parte del PN (1160).
 *  - Puesta en equivalencia (art. 52 a 56): la participación se valora por
 *    el coste más la parte de la variación del PN de la participada.
 * Todo en céntimos BigInt y tipos de cambio con 8 decimales: cada ajuste
 * cuadra al céntimo por construcción.
 */

/** Diferencias de conversión (CTA), PGC 135. */
export const CUENTA_DIFERENCIAS_CONVERSION = '1350';
/** Socios externos (participaciones no dominantes), subcuenta de consolidación. */
export const CUENTA_SOCIOS_EXTERNOS = '1160';
/** Reservas en sociedades consolidadas (subcuenta de 113). */
export const CUENTA_RESERVAS_CONSOLIDADAS = '1135';
/** Reservas en sociedades puestas en equivalencia (subcuenta de 113). */
export const CUENTA_RESERVAS_PUESTA_EQUIVALENCIA = '1136';
/** Fondo de comercio de consolidación (PGC 204). */
export const CUENTA_FONDO_COMERCIO_CONSOLIDACION = '2040';
/** Diferencia negativa en combinaciones de negocios (PGC 774). */
export const CUENTA_DIFERENCIA_NEGATIVA = '7740';
/** Participaciones puestas en equivalencia (subcuenta de 240). */
export const CUENTA_PARTICIPACIONES_PUESTA_EQUIVALENCIA = '2400';
/** Participación en resultados de sociedades puestas en equivalencia. */
export const CUENTA_RESULTADO_PUESTA_EQUIVALENCIA = '7609';
/** Cuenta de patrimonio contra la que se elimina el PN de la dependiente. */
export const CUENTA_PATRIMONIO_ELIMINADO = '1000';
/** Cuenta por defecto de las participaciones en empresas del grupo. */
export const CUENTA_INVERSION_GRUPO = '2403';

export type TipoCambioConsolidacion = 'cierre' | 'medio' | 'historico';

/** Los tipos de cambio llevan 8 decimales (`numeric(18, 8)`). */
const ESCALA_TASA = 10n ** 8n;

function tasaEscalada(tasa: Importe): bigint {
  const v = toScaled(tasa, 8);
  if (v <= 0n) throw new RangeError(`Tipo de cambio no válido: ${tasa}`);
  return v;
}

const TIPO_CAMBIO_MASA: Record<MasaConsolidacion, TipoCambioConsolidacion> = {
  activo: 'cierre',
  pasivo: 'cierre',
  patrimonio: 'historico',
  ingreso: 'medio',
  gasto: 'medio',
};

/** Tipo de cambio que corresponde a una cuenta (método del tipo de cierre). */
export function tipoCambioDeCuenta(codigo: string): TipoCambioConsolidacion {
  return TIPO_CAMBIO_MASA[tipoCuentaPorCodigo(codigo)];
}

/** `importe × tasa` redondeado half-up al céntimo (tasa con 8 decimales). */
export function convertirImporte(importe: Importe, tasa: Importe): number {
  return fromCents(
    mulDivRound(toCents(importe), tasaEscalada(tasa), ESCALA_TASA),
  );
}

export interface TiposCambioSociedad {
  /** Unidades de moneda de presentación por 1 de la moneda funcional. */
  cierre: Importe;
  medio: Importe;
  historico: Importe;
}

export interface ConversionMasa {
  masa: MasaConsolidacion;
  tipo: TipoCambioConsolidacion;
  /** Saldo natural en moneda funcional. */
  original: number;
  /** Saldo natural en moneda de presentación. */
  convertido: number;
}

export interface ConversionMonedaCalculo {
  /** Saldos deudores convertidos, con la línea de CTA (1350) si no es cero. */
  saldos: SaldoCuenta[];
  /** CTA del periodo: positivo si aumenta el patrimonio neto (haber). */
  diferenciaConversion: number;
  porMasa: ConversionMasa[];
}

/**
 * Convierte los saldos deudores de una sociedad de su moneda funcional a la
 * de presentación del grupo. Como el balance de partida cuadra (suma de
 * saldos deudores = 0), el descuadre que introduce aplicar tipos distintos
 * es exactamente la diferencia de conversión: se lleva a 1350 y el balance
 * convertido vuelve a sumar cero, sin perder un céntimo.
 */
export function convertirSaldosMoneda(
  saldos: readonly SaldoCuenta[],
  tipos: TiposCambioSociedad,
): ConversionMonedaCalculo {
  const tasas: Record<TipoCambioConsolidacion, bigint> = {
    cierre: tasaEscalada(tipos.cierre),
    medio: tasaEscalada(tipos.medio),
    historico: tasaEscalada(tipos.historico),
  };
  const masas = new Map<
    MasaConsolidacion,
    { original: bigint; convertido: bigint }
  >(MASAS.map((m) => [m, { original: 0n, convertido: 0n }]));
  const out: SaldoCuenta[] = [];
  let suma = 0n;
  for (const s of saldos) {
    const original = toCents(s.saldoDeudor);
    const convertido = mulDivRound(
      original,
      tasas[tipoCambioDeCuenta(s.codigo)],
      ESCALA_TASA,
    );
    suma += convertido;
    const m = masas.get(tipoCuentaPorCodigo(s.codigo))!;
    m.original += original;
    m.convertido += convertido;
    if (convertido !== 0n) {
      out.push({ codigo: s.codigo, saldoDeudor: fromCents(convertido) });
    }
  }
  if (suma !== 0n) {
    out.push({
      codigo: CUENTA_DIFERENCIAS_CONVERSION,
      saldoDeudor: fromCents(-suma),
    });
  }
  return {
    saldos: out,
    diferenciaConversion: fromCents(suma),
    porMasa: MASAS.map((masa) => {
      const v = masas.get(masa)!;
      return {
        masa,
        tipo: TIPO_CAMBIO_MASA[masa],
        original: fromCents(natural(masa, v.original)),
        convertido: fromCents(natural(masa, v.convertido)),
      };
    }),
  };
}

function patrimonioNetoCents(saldos: readonly SaldoCuenta[]) {
  let patrimonio = 0n;
  let resultado = 0n;
  for (const s of saldos) {
    const masa = tipoCuentaPorCodigo(s.codigo);
    const v = toCents(s.saldoDeudor);
    if (masa === 'patrimonio') patrimonio -= v;
    else if (masa === 'ingreso' || masa === 'gasto') resultado -= v;
  }
  return { patrimonio, resultado };
}

/**
 * Patrimonio neto (saldo natural de las cuentas de patrimonio, sin el
 * resultado) y resultado (ingresos − gastos) de unos saldos deudores.
 */
export function patrimonioNetoDeSaldos(saldos: readonly SaldoCuenta[]): {
  patrimonio: number;
  resultado: number;
} {
  const { patrimonio, resultado } = patrimonioNetoCents(saldos);
  return { patrimonio: fromCents(patrimonio), resultado: fromCents(resultado) };
}

export interface TipoCambioRegistro {
  moneda: string;
  tipo: TipoCambioConsolidacion;
  /** AAAA-MM-DD; en cierre e histórico, `desde = hasta`. */
  desde: string;
  hasta: string;
  tasa: Importe;
}

const amplitudPeriodo = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/**
 * Tipo aplicable, determinista:
 *  - cierre / histórico: el último con fecha ≤ `hasta` (la fecha de cierre o
 *    de toma de control);
 *  - medio: el del periodo exacto; si no, el más estrecho que lo cubra.
 * Null si no hay ninguno (`FX_RATE_MISSING`).
 */
export function seleccionarTipoCambio(
  registros: readonly TipoCambioRegistro[],
  c: {
    moneda: string;
    tipo: TipoCambioConsolidacion;
    desde: string;
    hasta: string;
  },
): TipoCambioRegistro | null {
  const candidatos = registros.filter(
    (r) => r.moneda === c.moneda && r.tipo === c.tipo,
  );
  if (c.tipo === 'medio') {
    const exacto = candidatos.find(
      (r) => r.desde === c.desde && r.hasta === c.hasta,
    );
    if (exacto) return exacto;
    const cubren = candidatos
      .filter((r) => r.desde <= c.desde && r.hasta >= c.hasta)
      .sort(
        (a, b) =>
          amplitudPeriodo(a.desde, a.hasta) -
            amplitudPeriodo(b.desde, b.hasta) ||
          (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0),
      );
    return cubren[0] ?? null;
  }
  let mejor: TipoCambioRegistro | null = null;
  for (const r of candidatos) {
    if (r.desde <= c.hasta && (!mejor || r.desde > mejor.desde)) mejor = r;
  }
  return mejor;
}

export interface InversionPatrimonioEntrada {
  companyId: string;
  /** Nombre para los conceptos de los ajustes (por defecto, el id). */
  nombre?: string;
  metodo: MetodoConsolidacion;
  /** Participación de la dominante, 0,01–100 con 2 decimales. */
  participacionPct: Importe;
  /** Coste de la participación en la dominante (moneda de presentación). */
  costeInversion: Importe;
  /** Cuenta 2xx de la dominante donde figura la participación. */
  cuentaInversion: string;
  /** PN (100 %) de la dependiente a la toma de control, en presentación. */
  patrimonioAdquisicion: Importe;
  /** PN (100 %) al cierre sin el resultado del periodo, en presentación. */
  patrimonioCierre: Importe;
  /** Resultado (100 %) del periodo, en presentación. */
  resultadoPeriodo: Importe;
  /** La toma de control cae en el periodo: la diferencia negativa es resultado. */
  adquisicionEnPeriodo: boolean;
}

export interface InversionPatrimonioCalculo {
  companyId: string;
  metodo: MetodoConsolidacion;
  participacionPct: number;
  costeInversion: number;
  patrimonioAdquisicion: number;
  /** Parte del PN a la toma de control que corresponde a la dominante. */
  participacionAdquirida: number;
  fondoComercio: number;
  diferenciaNegativa: number;
  /** Socios externos: su parte del PN a la toma de control (global). */
  sociosExternosAdquisicion: number;
  /** Socios externos: su parte de la variación posterior del PN (global). */
  sociosExternosPosteriores: number;
  /** Puesta en equivalencia: valor de la participación al cierre. */
  valorPuestaEquivalencia: number | null;
  /** Puesta en equivalencia: parte del resultado del periodo. */
  resultadoPuestaEquivalencia: number | null;
  ajustes: AjusteConsolidacion[];
}

/** Línea de ajuste desde un saldo deudor con signo; null si es cero. */
function lineaDeudora(
  cuenta: string,
  deudor: bigint,
): LineaAjusteConsolidacion | null {
  if (deudor === 0n) return null;
  return deudor > 0n
    ? { cuenta, debe: centsToNumeric(deudor), haber: '0.00' }
    : { cuenta, debe: '0.00', haber: centsToNumeric(-deudor) };
}

function ajusteCuadrado(
  concepto: string,
  pares: readonly [string, bigint][],
): AjusteConsolidacion | null {
  const lineas = pares
    .map(([c, v]) => lineaDeudora(c, v))
    .filter((l): l is LineaAjusteConsolidacion => l !== null);
  if (lineas.length === 0) return null;
  const cuadre = sumCents(pares.map(([, v]) => v));
  if (cuadre !== 0n) {
    throw new RangeError(`Ajuste de consolidación descuadrado: ${concepto}`);
  }
  return { concepto, origen: 'automatico', lineas };
}

/**
 * Eliminación inversión–patrimonio neto de una sociedad del perímetro.
 *
 * Global: se elimina el 100 % del PN a la toma de control; la dominante
 * compensa su coste con su parte (`pct × PN`) y el resto es de socios
 * externos, que además reciben su parte de la variación posterior del PN
 * (reclasificada desde reservas). Fondo de comercio = coste − parte de la
 * dominante; si es negativo, diferencia negativa.
 *
 * Proporcional: se elimina solo la parte integrada (`pct × PN`), sin socios
 * externos.
 *
 * Puesta en equivalencia: la participación se reclasifica a 2400 y se ajusta
 * por la parte de la variación del PN desde la toma de control (reservas,
 * 1136) y del resultado del periodo (7609). El fondo de comercio queda
 * implícito en el valor; la diferencia negativa lo aumenta.
 *
 * Los socios externos de la adquisición se calculan por diferencia
 * (`PN − parte dominante`) y los posteriores también
 * (`round((1 − pct) × PN cierre) − externos adquisición`): la suma coincide
 * al céntimo con la de `consolidarEstados`.
 */
export function eliminacionInversionPatrimonio(
  e: InversionPatrimonioEntrada,
): InversionPatrimonioCalculo {
  const pct = toScaled(e.participacionPct, 2);
  if (pct <= 0n || pct > 10_000n) {
    throw new RangeError(`Participación no válida: ${e.participacionPct}`);
  }
  if (!/^2\d{3,9}$/.test(e.cuentaInversion)) {
    throw new RangeError(`Cuenta de inversión no válida: ${e.cuentaInversion}`);
  }
  const coste = toCents(e.costeInversion);
  if (coste < 0n) throw new RangeError('El coste de la inversión es negativo');
  const pnAdq = toCents(e.patrimonioAdquisicion);
  const pnCierre = toCents(e.patrimonioCierre);
  const resultado = toCents(e.resultadoPeriodo);
  const quien = e.nombre ?? e.companyId;
  const cuentaDifNeg = (reservas: string) =>
    e.adquisicionEnPeriodo ? CUENTA_DIFERENCIA_NEGATIVA : reservas;
  const ajustes: AjusteConsolidacion[] = [];
  const push = (a: AjusteConsolidacion | null) => a && ajustes.push(a);

  if (e.metodo === 'puesta_equivalencia') {
    const dominante = mulDivRound(pnAdq, pct, 10_000n);
    const dif = coste - dominante;
    const variacion = mulDivRound(pnCierre, pct, 10_000n) - dominante;
    const resultadoPeq = mulDivRound(resultado, pct, 10_000n);
    const exceso = dif < 0n ? -dif : 0n;
    const valorPeq = coste + variacion + resultadoPeq + exceso;
    push(
      ajusteCuadrado(
        `Puesta en equivalencia de ${quien}: reclasificación de la participación`,
        [
          [CUENTA_PARTICIPACIONES_PUESTA_EQUIVALENCIA, coste],
          [e.cuentaInversion, -coste],
        ],
      ),
    );
    push(
      ajusteCuadrado(
        `Puesta en equivalencia de ${quien}: variación del patrimonio neto`,
        [
          [
            CUENTA_PARTICIPACIONES_PUESTA_EQUIVALENCIA,
            variacion + resultadoPeq + exceso,
          ],
          [CUENTA_RESERVAS_PUESTA_EQUIVALENCIA, -variacion],
          [CUENTA_RESULTADO_PUESTA_EQUIVALENCIA, -resultadoPeq],
          [cuentaDifNeg(CUENTA_RESERVAS_PUESTA_EQUIVALENCIA), -exceso],
        ],
      ),
    );
    return {
      companyId: e.companyId,
      metodo: e.metodo,
      participacionPct: Number(pct) / 100,
      costeInversion: fromCents(coste),
      patrimonioAdquisicion: fromCents(pnAdq),
      participacionAdquirida: fromCents(dominante),
      fondoComercio: fromCents(dif > 0n ? dif : 0n),
      diferenciaNegativa: fromCents(exceso),
      sociosExternosAdquisicion: 0,
      sociosExternosPosteriores: 0,
      valorPuestaEquivalencia: fromCents(valorPeq),
      resultadoPuestaEquivalencia: fromCents(resultadoPeq),
      ajustes,
    };
  }

  let eliminado: bigint;
  let dominante: bigint;
  let extAdq = 0n;
  let extPost = 0n;
  if (e.metodo === 'proporcional') {
    eliminado = applyPct(pnAdq, e.participacionPct);
    dominante = eliminado;
  } else {
    eliminado = pnAdq;
    const externos = 10_000n - pct;
    extAdq = mulDivRound(pnAdq, externos, 10_000n);
    dominante = pnAdq - extAdq;
    extPost = mulDivRound(pnCierre, externos, 10_000n) - extAdq;
  }
  const dif = coste - dominante;
  push(
    ajusteCuadrado(`Eliminación inversión–patrimonio neto de ${quien}`, [
      [CUENTA_PATRIMONIO_ELIMINADO, eliminado],
      [e.cuentaInversion, -coste],
      [CUENTA_SOCIOS_EXTERNOS, -extAdq],
      dif > 0n
        ? [CUENTA_FONDO_COMERCIO_CONSOLIDACION, dif]
        : [cuentaDifNeg(CUENTA_RESERVAS_CONSOLIDADAS), dif],
    ]),
  );
  push(
    ajusteCuadrado(
      `Socios externos en la variación del patrimonio de ${quien}`,
      [
        [CUENTA_RESERVAS_CONSOLIDADAS, extPost],
        [CUENTA_SOCIOS_EXTERNOS, -extPost],
      ],
    ),
  );
  return {
    companyId: e.companyId,
    metodo: e.metodo,
    participacionPct: Number(pct) / 100,
    costeInversion: fromCents(coste),
    patrimonioAdquisicion: fromCents(pnAdq),
    participacionAdquirida: fromCents(dominante),
    fondoComercio: fromCents(dif > 0n ? dif : 0n),
    diferenciaNegativa: fromCents(dif < 0n ? -dif : 0n),
    sociosExternosAdquisicion: fromCents(extAdq),
    sociosExternosPosteriores: fromCents(extPost),
    valorPuestaEquivalencia: null,
    resultadoPuestaEquivalencia: null,
    ajustes,
  };
}

/* ─────────────── solicitudes de material: reserva y servicio ───────────────
 * Modelo de la reserva de SAP MM y la requisición de Oracle: la obra pide
 * material a un almacén; lo disponible se reserva (ya no lo puede consumir
 * otra obra) y el resto queda como faltante para comprar. Servir consume
 * primero lo reservado. Cantidades exactas en milésimas (BigInt).
 */

export type EstadoSolicitudMaterial =
  'abierta' | 'servida_parcial' | 'servida' | 'cancelada';

const mil = (v: string | number) => toScaled(v, ESCALA_CANTIDAD_STOCK);
const milTexto = (q: bigint) => scaledToNumeric(q, ESCALA_CANTIDAD_STOCK);

/**
 * Cuánto reservar de una línea: lo pendiente sin reservar
 * (solicitada − servida − reservada), hasta lo disponible del almacén; lo
 * demás es faltante (a comprar).
 */
export function planificarReserva(p: {
  solicitada: string | number;
  servida: string | number;
  reservada: string | number;
  disponible: string | number;
}): { reservar: string; faltante: string } {
  const pendiente = mil(p.solicitada) - mil(p.servida) - mil(p.reservada);
  if (pendiente < 0n)
    throw new RangeError('Línea sobre-reservada o sobre-servida');
  const disponible = mil(p.disponible) > 0n ? mil(p.disponible) : 0n;
  const reservar = pendiente < disponible ? pendiente : disponible;
  return {
    reservar: milTexto(reservar),
    faltante: milTexto(pendiente - reservar),
  };
}

/**
 * Servir `cantidad` de una línea: no más de lo pendiente
 * (solicitada − servida); se libera primero lo reservado y el resto sale del
 * stock libre (si no lo hay, el consumo lo rechaza con INSUFFICIENT_STOCK).
 */
export function planificarServicio(p: {
  solicitada: string | number;
  servida: string | number;
  reservada: string | number;
  cantidad: string | number;
}): { liberar: string; servidaTras: string; reservadaTras: string } {
  const q = mil(p.cantidad);
  if (q <= 0n) {
    throw new ErrorStock(
      'STOCK_QUANTITY_INVALID',
      'La cantidad debe ser mayor que cero',
    );
  }
  const pendiente = mil(p.solicitada) - mil(p.servida);
  if (q > pendiente) {
    throw new ErrorStock(
      'MATERIAL_REQUEST_OVER_SERVED',
      `Solo quedan ${milTexto(pendiente)} por servir de esta línea`,
      milTexto(pendiente),
    );
  }
  const reservada = mil(p.reservada);
  const liberar = q < reservada ? q : reservada;
  return {
    liberar: milTexto(liberar),
    servidaTras: milTexto(mil(p.servida) + q),
    reservadaTras: milTexto(reservada - liberar),
  };
}

/** Estado de la solicitud derivado de sus líneas (una cancelada no cambia). */
export function estadoSolicitudMaterial(
  actual: EstadoSolicitudMaterial,
  lineas: readonly { solicitada: string | number; servida: string | number }[],
): EstadoSolicitudMaterial {
  if (actual === 'cancelada') return actual;
  const servidas = lineas.map((l) => mil(l.servida));
  if (lineas.every((l, i) => servidas[i] >= mil(l.solicitada)))
    return 'servida';
  if (servidas.some((s) => s > 0n)) return 'servida_parcial';
  return 'abierta';
}

/** Faltante de una línea (lo que no está servido ni reservado). */
export function faltanteLinea(p: {
  solicitada: string | number;
  servida: string | number;
  reservada: string | number;
}): string {
  const f = mil(p.solicitada) - mil(p.servida) - mil(p.reservada);
  return milTexto(f > 0n ? f : 0n);
}

/* ─────────────── obra en curso (WIP) al cierre: grado de avance ───────────────
 * Método del grado de avance (NRV 14 PGC y adaptación sectorial de empresas
 * constructoras): el ingreso de la obra es la producción ejecutada. Los costes
 * ya están en la cuenta de resultados por naturaleza, así que el ajuste de
 * cierre va del lado del ingreso:
 *   WIP a origen = producción ejecutada (certificada a origen) − facturado.
 *   > 0: obra ejecutada pendiente de facturar (4309 a 7050).
 *   < 0: producción facturada por anticipado (7050 a 4389).
 * Cada cierre contabiliza solo la regularización respecto del WIP anterior,
 * así el saldo de 4309/4389 es siempre el WIP vigente y nada se duplica.
 */

export type EstadoWip = 'contabilizado' | 'anulado';

export interface CalculoWip {
  produccion: number;
  facturado: number;
  /** Producción − facturado (a origen). */
  wip: number;
  wipAnterior: number;
  /** Lo que se contabiliza en este cierre: wip − wipAnterior. */
  regularizacion: number;
  costeReal: number;
  /** Producción − coste real: el margen que reconoce el grado de avance. */
  margenReconocido: number;
  margenReconocidoPct: number | null;
}

export function calcularWip(p: {
  produccion: Importe;
  facturado: Importe;
  wipAnterior: Importe;
  costeReal: Importe;
}): CalculoWip {
  const produccion = toCents(p.produccion);
  const facturado = toCents(p.facturado);
  const anterior = toCents(p.wipAnterior);
  const coste = toCents(p.costeReal);
  const wip = produccion - facturado;
  const margen = produccion - coste;
  return {
    produccion: fromCents(produccion),
    facturado: fromCents(facturado),
    wip: fromCents(wip),
    wipAnterior: fromCents(anterior),
    regularizacion: fromCents(wip - anterior),
    costeReal: fromCents(coste),
    margenReconocido: fromCents(margen),
    margenReconocidoPct: pct(margen, produccion),
  };
}

export interface LineaAsientoWip {
  cuenta: string;
  debe: string;
  haber: string;
  /** La línea lleva la obra (analítica): solo la de ingreso. */
  imputaObra: boolean;
}

/**
 * Asiento de regularización del WIP de `anterior` a `nuevo` (céntimos):
 *  - 4309 (pendiente de facturar) recoge la parte positiva del WIP;
 *  - 4389 (facturado por anticipado) recoge la parte negativa;
 *  - 7050 (obra) cuadra con la variación total.
 * Cuadra siempre: Δ4309 − Δ4389 = nuevo − anterior. Sin variación, vacío.
 */
export function asientoRegularizacionWip(
  anterior: Importe,
  nuevo: Importe,
  cuentas: { pendiente: string; anticipado: string; ingreso: string },
): LineaAsientoWip[] {
  const a = toCents(anterior);
  const n = toCents(nuevo);
  const pos = (x: bigint) => (x > 0n ? x : 0n);
  const neg = (x: bigint) => (x < 0n ? -x : 0n);
  const lineas: LineaAsientoWip[] = [];
  const apunte = (cuenta: string, deudor: bigint, imputaObra: boolean) => {
    if (deudor === 0n) return;
    lineas.push({
      cuenta,
      debe: centsToNumeric(deudor > 0n ? deudor : 0n),
      haber: centsToNumeric(deudor < 0n ? -deudor : 0n),
      imputaObra,
    });
  };
  apunte(cuentas.pendiente, pos(n) - pos(a), false);
  // 4389 es de pasivo: crece al haber.
  apunte(cuentas.anticipado, -(neg(n) - neg(a)), false);
  // El ingreso crece al haber.
  apunte(cuentas.ingreso, -(n - a), true);
  return lineas;
}

/* ──────────── provisión por pérdidas previstas (contratos onerosos) ────────────
 * NRV 14 PGC y adaptación sectorial de constructoras: la pérdida esperada de
 * un contrato se reconoce ENTERA en cuanto se prevé. El grado de avance ya
 * lleva a resultados la parte realizada (coste real > producción), así que
 * la provisión cubre solo el resto:
 *   pérdida total   = máx(0, coste estimado al cierre − contrato)
 *   ya reconocida   = máx(0, coste real − producción)
 *   provisión       = máx(0, pérdida total − ya reconocida); 0 con la obra
 *                     terminada (la pérdida ya está realizada).
 * Cada cierre contabiliza el ajuste frente a la provisión vigente: dotación
 * 6954 (obra) a 4994, o exceso 4994 a 7954 (obra).
 */

export interface CalculoProvisionPerdidas {
  contrato: number | null;
  costeEstimadoCierre: number;
  perdidaTotal: number;
  perdidaReconocida: number;
  provisionNecesaria: number;
  provisionAnterior: number;
  /** > 0 dotación; < 0 exceso (reversión). */
  ajuste: number;
}

export function calcularProvisionPerdidas(p: {
  contrato: Importe | null;
  costeEstimadoCierre: Importe;
  produccion: Importe;
  costeReal: Importe;
  provisionAnterior: Importe;
  obraTerminada?: boolean;
}): CalculoProvisionPerdidas {
  const coste = toCents(p.costeEstimadoCierre);
  const anterior = toCents(p.provisionAnterior);
  const contrato = p.contrato === null ? null : toCents(p.contrato);
  const max0 = (x: bigint) => (x > 0n ? x : 0n);
  // Sin contrato no hay ingreso previsto con el que comparar: no se provisiona.
  const perdida = contrato === null ? 0n : max0(coste - contrato);
  const reconocida = max0(toCents(p.costeReal) - toCents(p.produccion));
  const necesaria = p.obraTerminada ? 0n : max0(perdida - reconocida);
  return {
    contrato: contrato === null ? null : fromCents(contrato),
    costeEstimadoCierre: fromCents(coste),
    perdidaTotal: fromCents(perdida),
    perdidaReconocida: fromCents(reconocida),
    provisionNecesaria: fromCents(necesaria),
    provisionAnterior: fromCents(anterior),
    ajuste: fromCents(necesaria - anterior),
  };
}

/** Asiento del ajuste: dotación (6954 obra a 4994) o exceso (4994 a 7954 obra). */
export function asientoProvisionPerdidas(ajuste: Importe): LineaAsientoWip[] {
  const a = toCents(ajuste);
  if (a === 0n) return [];
  const imp = centsToNumeric(a > 0n ? a : -a);
  return a > 0n
    ? [
        { cuenta: '6954', debe: imp, haber: '0.00', imputaObra: true },
        { cuenta: '4994', debe: '0.00', haber: imp, imputaObra: false },
      ]
    : [
        { cuenta: '4994', debe: imp, haber: '0.00', imputaObra: false },
        { cuenta: '7954', debe: '0.00', haber: imp, imputaObra: true },
      ];
}

/* ───────────────────────── avales bancarios y garantías ─────────────────────────
 * Un aval es un riesgo contingente: mientras está vivo no se contabiliza en el
 * balance (se informa en la memoria); solo su coste (comisiones) y, si llega,
 * su ejecución. Por aval:
 *   saldo vivo = nominal − liberado − ejecutado   (siempre 0 ≤ saldo ≤ nominal)
 * Una liberación o ejecución reduce el saldo; al llegar a 0 el aval queda
 * `liberado` (sin ejecuciones) o `ejecutado` (con alguna); el vencimiento
 * libera el resto y lo deja `vencido`. Todo en céntimos `BigInt`.
 */

export type EstadoAval =
  | 'vigente'
  | 'liberado_parcial'
  | 'liberado'
  | 'ejecutado'
  | 'vencido'
  | 'anulado';

export type DireccionAval = 'emitido' | 'recibido';

export interface SaldoAval {
  nominal: number;
  liberado: number;
  ejecutado: number;
  saldoVivo: number;
}

export function saldoAval(p: {
  nominal: Importe;
  liberado: Importe;
  ejecutado: Importe;
}): SaldoAval {
  const n = toCents(p.nominal);
  const l = toCents(p.liberado);
  const e = toCents(p.ejecutado);
  return {
    nominal: fromCents(n),
    liberado: fromCents(l),
    ejecutado: fromCents(e),
    saldoVivo: fromCents(n - l - e),
  };
}

/** Estado que corresponde a unos importes (sin contar vencimiento ni anulación). */
export function estadoPorSaldo(p: {
  nominal: Importe;
  liberado: Importe;
  ejecutado: Importe;
}): Exclude<EstadoAval, 'vencido' | 'anulado'> {
  const n = toCents(p.nominal);
  const l = toCents(p.liberado);
  const e = toCents(p.ejecutado);
  if (n - l - e > 0n) return l + e > 0n ? 'liberado_parcial' : 'vigente';
  return e > 0n ? 'ejecutado' : 'liberado';
}

export type CodigoRechazoAval =
  | 'BANK_GUARANTEE_AMOUNT_INVALID'
  | 'BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE'
  | 'BANK_GUARANTEE_NOT_ACTIVE';

export type ResultadoMovimientoAval =
  | {
      ok: true;
      /** Importe del movimiento (el saldo entero si no se indicó). */
      importe: number;
      liberado: number;
      ejecutado: number;
      saldoVivo: number;
      estado: EstadoAval;
    }
  | { ok: false; codigo: CodigoRechazoAval; mensaje: string };

/**
 * Aplica una liberación, ejecución o vencimiento a un aval vivo. Sin importe,
 * la liberación y la ejecución son totales (todo el saldo vivo). El
 * vencimiento libera siempre el saldo entero.
 */
export function aplicarMovimientoAval(p: {
  estado: EstadoAval;
  nominal: Importe;
  liberado: Importe;
  ejecutado: Importe;
  tipo: 'liberacion' | 'ejecucion' | 'vencimiento';
  importe?: Importe | null;
}): ResultadoMovimientoAval {
  if (p.estado !== 'vigente' && p.estado !== 'liberado_parcial') {
    return {
      ok: false,
      codigo: 'BANK_GUARANTEE_NOT_ACTIVE',
      mensaje: `El aval no está vivo (estado «${p.estado}»)`,
    };
  }
  const n = toCents(p.nominal);
  let l = toCents(p.liberado);
  let e = toCents(p.ejecutado);
  const vivo = n - l - e;
  const imp =
    p.tipo === 'vencimiento' || p.importe === undefined || p.importe === null
      ? vivo
      : toCents(p.importe);
  if (imp <= 0n) {
    return {
      ok: false,
      codigo: 'BANK_GUARANTEE_AMOUNT_INVALID',
      mensaje: 'El importe debe ser mayor que cero',
    };
  }
  if (imp > vivo) {
    return {
      ok: false,
      codigo: 'BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE',
      mensaje: `El importe (${centsToNumeric(imp)}) supera el saldo vivo del aval (${centsToNumeric(vivo)})`,
    };
  }
  if (p.tipo === 'ejecucion') e += imp;
  else l += imp;
  const estado: EstadoAval =
    p.tipo === 'vencimiento'
      ? 'vencido'
      : estadoPorSaldo({
          nominal: centsToNumeric(n),
          liberado: centsToNumeric(l),
          ejecutado: centsToNumeric(e),
        });
  return {
    ok: true,
    importe: fromCents(imp),
    liberado: fromCents(l),
    ejecutado: fromCents(e),
    saldoVivo: fromCents(n - l - e),
    estado,
  };
}

/**
 * Comisión de riesgo de un aval: saldo vivo × tasa anual (%) × meses / 12,
 * half-up al céntimo. Tasa con hasta 4 decimales (p. ej. 0,7500 %).
 */
export function comisionAval(p: {
  saldoVivo: Importe;
  tasaAnualPct: Importe;
  meses: number;
}): number {
  if (!Number.isInteger(p.meses) || p.meses < 1) {
    throw new RangeError(`Meses no válidos: ${p.meses}`);
  }
  const saldo = toCents(p.saldoVivo);
  const tasa = toScaled(p.tasaAnualPct, 4); // % × 10⁴
  // saldo × (tasa / 10⁴) / 100 × meses / 12
  return fromCents(
    mulDivRound(saldo * tasa, BigInt(p.meses), 10_000n * 100n * 12n),
  );
}

/** Días naturales de `hoy` a `vencimiento` (negativo si ya venció); null si es indefinido. */
export function diasHastaVencimiento(
  vencimiento: string | null,
  hoy: string,
): number | null {
  if (!vencimiento) return null;
  const ms =
    Date.parse(`${vencimiento}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export interface ResumenAvalesCalculo {
  emitidos: { numero: number; nominal: number; saldoVivo: number };
  recibidos: { numero: number; nominal: number; saldoVivo: number };
  /** Vivos que vencen entre hoy y `dias` días. */
  proximosVencer: number;
  saldoProximosVencer: number;
  /** Vivos con la fecha de vencimiento ya pasada (pendientes de liberar o vencer). */
  vencidosSinCerrar: number;
  /** Comisiones registradas de todos los avales del conjunto. */
  comisionesAcumuladas: number;
}

/** Exposición viva por dirección y vencimientos próximos (solo avales vivos). */
export function resumenAvales(
  avales: readonly {
    direccion: DireccionAval;
    estado: EstadoAval;
    nominal: Importe;
    saldoVivo: Importe;
    fechaVencimiento: string | null;
    comisiones: Importe;
  }[],
  hoy: string,
  dias: number,
): ResumenAvalesCalculo {
  const acc = {
    emitido: { numero: 0, nominal: 0n, saldo: 0n },
    recibido: { numero: 0, nominal: 0n, saldo: 0n },
  };
  let proximos = 0;
  let saldoProximos = 0n;
  let vencidos = 0;
  let comisiones = 0n;
  for (const a of avales) {
    comisiones += toCents(a.comisiones);
    if (a.estado !== 'vigente' && a.estado !== 'liberado_parcial') continue;
    const d = acc[a.direccion];
    d.numero += 1;
    d.nominal += toCents(a.nominal);
    d.saldo += toCents(a.saldoVivo);
    const faltan = diasHastaVencimiento(a.fechaVencimiento, hoy);
    if (faltan === null) continue;
    if (faltan < 0) vencidos += 1;
    else if (faltan <= dias) {
      proximos += 1;
      saldoProximos += toCents(a.saldoVivo);
    }
  }
  const fmt = (x: { numero: number; nominal: bigint; saldo: bigint }) => ({
    numero: x.numero,
    nominal: fromCents(x.nominal),
    saldoVivo: fromCents(x.saldo),
  });
  return {
    emitidos: fmt(acc.emitido),
    recibidos: fmt(acc.recibido),
    proximosVencer: proximos,
    saldoProximosVencer: fromCents(saldoProximos),
    vencidosSinCerrar: vencidos,
    comisionesAcumuladas: fromCents(comisiones),
  };
}

/** Comisión bancaria del aval: 6260 (obra) a 5720. */
export function asientoComisionAval(importe: Importe): LineaAsientoWip[] {
  const c = toCents(importe);
  if (c <= 0n) return [];
  const imp = centsToNumeric(c);
  return [
    { cuenta: '6260', debe: imp, haber: '0.00', imputaObra: true },
    { cuenta: '5720', debe: '0.00', haber: imp, imputaObra: false },
  ];
}

/**
 * Ejecución del aval. Emitido (el banco paga al beneficiario y nos lo carga):
 * 6780 gasto excepcional (obra) a 5720, o a 5200 (préstamo a corto plazo) si
 * el banco la financia. Recibido (cobramos la garantía del tercero): 5720 a
 * 7780 ingreso excepcional (obra); no admite financiación.
 */
export function asientoEjecucionAval(
  importe: Importe,
  direccion: DireccionAval,
  financiada = false,
): LineaAsientoWip[] {
  const c = toCents(importe);
  if (c <= 0n) return [];
  if (financiada && direccion !== 'emitido') {
    throw new RangeError('Solo la ejecución de un aval emitido se financia');
  }
  const imp = centsToNumeric(c);
  return direccion === 'emitido'
    ? [
        { cuenta: '6780', debe: imp, haber: '0.00', imputaObra: true },
        {
          cuenta: financiada ? '5200' : '5720',
          debe: '0.00',
          haber: imp,
          imputaObra: false,
        },
      ]
    : [
        { cuenta: '5720', debe: imp, haber: '0.00', imputaObra: false },
        { cuenta: '7780', debe: '0.00', haber: imp, imputaObra: true },
      ];
}

/* ───────────────────── líneas de avales por entidad ─────────────────────
 * Límite de riesgo que una entidad nos concede para emitir avales (SAP
 * Treasury: línea de crédito de avales). Dispuesto = saldo vivo de los avales
 * emitidos de esa entidad. Un alta que lo supere se rechaza.
 */

export interface ValidacionLineaAval {
  ok: boolean;
  limite: number;
  dispuesto: number;
  /** Disponible antes del alta. */
  disponible: number;
  /** Dispuesto si se admite el alta. */
  dispuestoTras: number;
}

export function validarLineaAval(p: {
  limite: Importe;
  dispuesto: Importe;
  importe: Importe;
}): ValidacionLineaAval {
  const limite = toCents(p.limite);
  const dispuesto = toCents(p.dispuesto);
  const tras = dispuesto + toCents(p.importe);
  return {
    ok: tras <= limite,
    limite: fromCents(limite),
    dispuesto: fromCents(dispuesto),
    disponible: fromCents(limite - dispuesto),
    dispuestoTras: fromCents(tras),
  };
}

/* ───────────────────── cierre y apertura del ejercicio (PGC) ─────────────────────
 * Al estilo de SAP FI-GL (traspaso de saldos) y Oracle GL (cierre de año):
 *  1. Regularización (31-12): salda las cuentas de gastos (6) e ingresos (7)
 *     contra 129 «Resultado del ejercicio» (beneficio al haber, pérdida al debe).
 *  2. Cierre (31-12): salda todas las cuentas de balance, 129 incluida.
 *  3. Apertura (01-01 del siguiente): el cierre con debe y haber invertidos.
 * Los saldos van por cuenta y obra, así la analítica también queda a cero.
 * Todo en céntimos `BigInt`; cada asiento cuadra al céntimo o se lanza error.
 */

export interface SaldoCuentaCierre {
  cuenta: string;
  projectId: string | null;
  debe: Importe;
  haber: Importe;
}

export interface LineaCierre {
  cuenta: string;
  projectId: string | null;
  debe: string;
  haber: string;
}

export interface AsientosCierreEjercicio {
  regularizacion: LineaCierre[];
  cierre: LineaCierre[];
  apertura: LineaCierre[];
  /** Ingresos − gastos (beneficio > 0, pérdida < 0). */
  resultado: number;
  ingresos: number;
  gastos: number;
  /** Suma del debe (= haber) de cada asiento. */
  totalRegularizacion: number;
  totalCierre: number;
}

/** Grupos 6 y 7 del PGC: cuentas de gestión que se regularizan contra 129. */
export function esCuentaDeResultados(codigo: string): boolean {
  return codigo.startsWith('6') || codigo.startsWith('7');
}

export function asientosCierreEjercicio(
  saldos: readonly SaldoCuentaCierre[],
  cuentaResultado = '1290',
): AsientosCierreEjercicio {
  const clave = (c: string, p: string | null) => `${c}|${p ?? ''}`;
  const netos = new Map<
    string,
    { cuenta: string; projectId: string | null; neto: bigint }
  >();
  const acumular = (cuenta: string, projectId: string | null, neto: bigint) => {
    const k = clave(cuenta, projectId);
    const a = netos.get(k) ?? { cuenta, projectId, neto: 0n };
    a.neto += neto;
    netos.set(k, a);
  };
  for (const s of saldos) {
    acumular(s.cuenta, s.projectId, toCents(s.debe) - toCents(s.haber));
  }
  const orden = (a: LineaCierre, b: LineaCierre) =>
    a.cuenta === b.cuenta
      ? (a.projectId ?? '').localeCompare(b.projectId ?? '')
      : a.cuenta.localeCompare(b.cuenta);
  /** Línea que salda un neto deudor (>0) o acreedor (<0). */
  const saldar = (cuenta: string, projectId: string | null, neto: bigint) => ({
    cuenta,
    projectId,
    debe: centsToNumeric(neto < 0n ? -neto : 0n),
    haber: centsToNumeric(neto > 0n ? neto : 0n),
  });

  let gastos = 0n;
  let ingresos = 0n;
  const regularizacion: LineaCierre[] = [];
  for (const n of netos.values()) {
    if (!esCuentaDeResultados(n.cuenta) || n.neto === 0n) continue;
    if (n.cuenta.startsWith('6')) gastos += n.neto;
    else ingresos -= n.neto;
    regularizacion.push(saldar(n.cuenta, n.projectId, n.neto));
  }
  regularizacion.sort(orden);
  // Neto deudor de los grupos 6 y 7 = gastos − ingresos = −resultado.
  const s = gastos - ingresos;
  if (s !== 0n) {
    // 129 recibe el neto: pérdida al debe, beneficio al haber.
    regularizacion.push({
      cuenta: cuentaResultado,
      projectId: null,
      debe: centsToNumeric(s > 0n ? s : 0n),
      haber: centsToNumeric(s < 0n ? -s : 0n),
    });
    acumular(cuentaResultado, null, s);
  }

  const cierre: LineaCierre[] = [];
  for (const n of netos.values()) {
    if (esCuentaDeResultados(n.cuenta) || n.neto === 0n) continue;
    cierre.push(saldar(n.cuenta, n.projectId, n.neto));
  }
  cierre.sort(orden);
  const suma = (l: LineaCierre[], lado: 'debe' | 'haber') =>
    sumCents(l.map((x) => toCents(x[lado])));
  for (const [nombre, l] of [
    ['regularización', regularizacion],
    ['cierre', cierre],
  ] as const) {
    if (suma(l, 'debe') !== suma(l, 'haber')) {
      throw new RangeError(
        `El asiento de ${nombre} no cuadra: el libro tiene un descuadre`,
      );
    }
  }
  const apertura = cierre.map((l) => ({ ...l, debe: l.haber, haber: l.debe }));
  return {
    regularizacion,
    cierre,
    apertura,
    resultado: fromCents(ingresos - gastos),
    ingresos: fromCents(ingresos),
    gastos: fromCents(gastos),
    totalRegularizacion: fromCents(suma(regularizacion, 'debe')),
    totalCierre: fromCents(suma(cierre, 'debe')),
  };
}

/* ───────────────────── EVM con estimación al cierre manual ─────────────────────
 * La EAC del EVM es BAC / CPI (o AC + BAC − EV sin coste real). Si la obra
 * tiene EAC manual vigente (SAP PS / Oracle PPM), esa manda, nunca por debajo
 * del AC. ETC = EAC − AC; TCPI = (BAC − EV) / (EAC − AC); VAC = BAC − EAC.
 */

export interface EvmConEstimacion {
  eac: number;
  eacCalculada: number;
  origenEac: OrigenEstimacionCierre;
  eacAjustadaAlReal: boolean;
  varianceAtCompletion: number;
  etc: number;
  tcpi: number | null;
}

export function evmConEstimacion(p: {
  bac: Importe;
  ac: Importe;
  ev: Importe;
  eacCalculada: Importe;
  eacManual: Importe | null;
}): EvmConEstimacion {
  const bac = toCents(p.bac);
  const ac = toCents(p.ac);
  const ev = toCents(p.ev);
  const calculada = toCents(p.eacCalculada);
  const manual = p.eacManual === null ? null : toCents(p.eacManual);
  const ajustada = manual !== null && manual < ac;
  const eac = manual === null ? calculada : ajustada ? ac : manual;
  const etc = eac - ac;
  return {
    eac: fromCents(eac),
    eacCalculada: fromCents(calculada),
    origenEac: manual === null ? 'automatica' : 'manual',
    eacAjustadaAlReal: ajustada,
    varianceAtCompletion: fromCents(bac - eac),
    etc: fromCents(etc),
    tcpi: etc === 0n ? null : Number(mulDivRound(bac - ev, 100n, etc)) / 100,
  };
}

/* ───────────────────── aplicación del resultado (cuenta 129) ─────────────────────
 * Al estilo del acuerdo de la junta (LSC arts. 273-274 y PGC):
 *  - Beneficio: 1290 al debe contra reserva legal (1120), voluntarias (1130),
 *    estatutarias (1140), remanente (1200), compensación de resultados
 *    negativos anteriores (1210) y dividendo a pagar (5260).
 *    · Reserva legal mínima: 10 % del beneficio mientras no alcance el 20 %
 *      del capital (art. 274).
 *    · La compensación no supera las pérdidas pendientes (saldo de 1210).
 *    · Con pérdidas anteriores sin compensar no se reparten dividendos.
 *  - Pérdida: 1290 al haber contra resultados negativos (1210) o su
 *    compensación con reservas voluntarias (1130) o remanente (1200), sin
 *    superar el saldo de la reserva.
 * El reparto cuadra al céntimo con el resultado.
 */

export const CUENTAS_APLICACION_BENEFICIO = {
  '1120': 'Reserva legal',
  '1130': 'Reservas voluntarias',
  '1140': 'Reservas estatutarias',
  '1200': 'Remanente',
  '1210': 'Compensación de resultados negativos de ejercicios anteriores',
  '5260': 'Dividendo activo a pagar',
} as const;

export const CUENTAS_APLICACION_PERDIDA = {
  '1210': 'Resultados negativos de ejercicios anteriores',
  '1130': 'Compensación con reservas voluntarias',
  '1200': 'Compensación con remanente',
} as const;

export type CodigoRechazoAplicacion =
  | 'RESULT_APPLICATION_ZERO'
  | 'RESULT_APPLICATION_INVALID_ACCOUNT'
  | 'RESULT_APPLICATION_UNBALANCED'
  | 'RESULT_APPLICATION_LEGAL_RESERVE'
  | 'RESULT_APPLICATION_COMPENSATION_EXCEEDS'
  | 'RESULT_APPLICATION_DIVIDEND_BLOCKED'
  | 'RESULT_APPLICATION_RESERVES_INSUFFICIENT'
  | 'RESULT_APPLICATION_DEADLINE_EXCEEDED'
  | 'RESULT_APPLICATION_EQUITY_BELOW_CAPITAL';

/**
 * Plazo de la junta ordinaria (art. 164 LSC): dentro de los seis primeros
 * meses del ejercicio siguiente. Devuelve la fecha límite (AAAA-MM-DD).
 */
export function fechaLimiteAplicacion(ejercicio: number): string {
  return `${ejercicio + 1}-06-30`;
}

/**
 * Situación patrimonial (arts. 273.2 y 363.1.e LSC): patrimonio neto frente
 * al capital. `bajoCapital`: no se reparten dividendos que lo dejen por
 * debajo; `desequilibrio`: PN inferior a la mitad del capital (causa de
 * disolución salvo que se reequilibre).
 */
export function situacionPatrimonial(p: {
  patrimonioNeto: Importe;
  capital: Importe;
}): { bajoCapital: boolean; desequilibrio: boolean; margen: number } {
  const pn = toCents(p.patrimonioNeto);
  const capital = toCents(p.capital);
  return {
    bajoCapital: pn < capital,
    desequilibrio: capital > 0n && pn * 2n < capital,
    margen: fromCents(pn - capital),
  };
}

export interface SaldosPatrimonioNeto {
  /** Capital social (saldo acreedor de 100x). */
  capital: Importe;
  /** Saldo acreedor de la reserva legal (1120). */
  reservaLegal: Importe;
  /** Saldo acreedor de reservas voluntarias (1130). */
  reservasVoluntarias: Importe;
  /** Saldo acreedor del remanente (1200). */
  remanente: Importe;
  /** Saldo DEUDOR de resultados negativos de ejercicios anteriores (1210). */
  negativosAnteriores: Importe;
  /**
   * Patrimonio neto total antes de aplicar (incluye el resultado en 129).
   * Si se informa, se aplica el art. 273.2 LSC a los dividendos.
   */
  patrimonioNeto?: Importe;
}

export type ResultadoAplicacion =
  | {
      ok: true;
      lineas: { cuenta: string; debe: string; haber: string }[];
      reservaLegalMinima: number;
      total: number;
    }
  | {
      ok: false;
      codigo: CodigoRechazoAplicacion;
      mensaje: string;
      reservaLegalMinima: number;
    };

/** Reserva legal mínima (art. 274 LSC): 10 % del beneficio hasta el 20 % del capital. */
export function reservaLegalMinima(p: {
  beneficio: Importe;
  capital: Importe;
  reservaLegal: Importe;
}): number {
  const b = toCents(p.beneficio);
  if (b <= 0n) return 0;
  const tope =
    mulDivRound(toCents(p.capital), 20n, 100n) - toCents(p.reservaLegal);
  if (tope <= 0n) return 0;
  const diez = mulDivRound(b, 10n, 100n);
  return fromCents(diez < tope ? diez : tope);
}

export function aplicacionResultado(p: {
  resultado: Importe;
  reparto: readonly { cuenta: string; importe: Importe }[];
  saldos: SaldosPatrimonioNeto;
  cuentaResultado?: string;
  /** Si se informa, se valida el plazo de seis meses (art. 164 LSC). */
  plazo?: { ejercicio: number; fecha: string; aceptarFueraDePlazo?: boolean };
}): ResultadoAplicacion {
  const r = toCents(p.resultado);
  const cuentaResultado = p.cuentaResultado ?? '1290';
  const minima = reservaLegalMinima({
    beneficio: p.resultado,
    capital: p.saldos.capital,
    reservaLegal: p.saldos.reservaLegal,
  });
  const fallo = (codigo: CodigoRechazoAplicacion, mensaje: string) =>
    ({ ok: false, codigo, mensaje, reservaLegalMinima: minima }) as const;
  if (r === 0n) {
    return fallo(
      'RESULT_APPLICATION_ZERO',
      'El resultado es cero: no hay nada que aplicar',
    );
  }
  if (
    p.plazo &&
    !p.plazo.aceptarFueraDePlazo &&
    p.plazo.fecha > fechaLimiteAplicacion(p.plazo.ejercicio)
  ) {
    return fallo(
      'RESULT_APPLICATION_DEADLINE_EXCEEDED',
      `La junta ordinaria debió aprobar la aplicación antes del ${fechaLimiteAplicacion(p.plazo.ejercicio)} (art. 164 LSC); confírmalo expresamente para contabilizarla fuera de plazo`,
    );
  }
  const beneficio = r > 0n;
  const permitidas: Record<string, string> = beneficio
    ? CUENTAS_APLICACION_BENEFICIO
    : CUENTAS_APLICACION_PERDIDA;
  const porCuenta = new Map<string, bigint>();
  for (const l of p.reparto) {
    const imp = toCents(l.importe);
    if (!(l.cuenta in permitidas) || imp <= 0n || porCuenta.has(l.cuenta)) {
      return fallo(
        'RESULT_APPLICATION_INVALID_ACCOUNT',
        `Destino no válido para ${beneficio ? 'un beneficio' : 'una pérdida'}: ${l.cuenta} (importe positivo y sin repetir; permitidas ${Object.keys(permitidas).join(', ')})`,
      );
    }
    porCuenta.set(l.cuenta, imp);
  }
  const total = sumCents([...porCuenta.values()]);
  const abs = beneficio ? r : -r;
  if (total !== abs) {
    return fallo(
      'RESULT_APPLICATION_UNBALANCED',
      `El reparto (${centsToNumeric(total)}) no coincide con el resultado a aplicar (${centsToNumeric(abs)})`,
    );
  }
  const de = (c: string) => porCuenta.get(c) ?? 0n;
  if (beneficio) {
    if (de('1120') < toCents(minima)) {
      return fallo(
        'RESULT_APPLICATION_LEGAL_RESERVE',
        `La reserva legal debe recibir al menos ${minima.toFixed(2)} (10 % del beneficio hasta el 20 % del capital)`,
      );
    }
    const negativos = toCents(p.saldos.negativosAnteriores);
    if (de('1210') > (negativos > 0n ? negativos : 0n)) {
      return fallo(
        'RESULT_APPLICATION_COMPENSATION_EXCEEDS',
        `La compensación (${centsToNumeric(de('1210'))}) supera las pérdidas pendientes (${centsToNumeric(negativos > 0n ? negativos : 0n)})`,
      );
    }
    if (de('5260') > 0n && negativos - de('1210') > 0n) {
      return fallo(
        'RESULT_APPLICATION_DIVIDEND_BLOCKED',
        'No se reparten dividendos con pérdidas de ejercicios anteriores sin compensar',
      );
    }
    if (de('5260') > 0n && p.saldos.patrimonioNeto !== undefined) {
      const tras = toCents(p.saldos.patrimonioNeto) - de('5260');
      if (tras < toCents(p.saldos.capital)) {
        return fallo(
          'RESULT_APPLICATION_EQUITY_BELOW_CAPITAL',
          `El dividendo dejaría el patrimonio neto (${centsToNumeric(tras)}) por debajo del capital social (${centsToNumeric(toCents(p.saldos.capital))}) (art. 273.2 LSC)`,
        );
      }
    }
  } else {
    for (const [c, saldo] of [
      ['1130', p.saldos.reservasVoluntarias],
      ['1200', p.saldos.remanente],
    ] as const) {
      if (de(c) > toCents(saldo)) {
        return fallo(
          'RESULT_APPLICATION_RESERVES_INSUFFICIENT',
          `La compensación con ${c} (${centsToNumeric(de(c))}) supera su saldo (${centsToNumeric(toCents(saldo))})`,
        );
      }
    }
  }
  const lineas = [...porCuenta.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cuenta, imp]) => ({
      cuenta,
      debe: beneficio ? '0.00' : centsToNumeric(imp),
      haber: beneficio ? centsToNumeric(imp) : '0.00',
    }));
  lineas.unshift({
    cuenta: cuentaResultado,
    debe: beneficio ? centsToNumeric(abs) : '0.00',
    haber: beneficio ? '0.00' : centsToNumeric(abs),
  });
  return {
    ok: true,
    lineas,
    reservaLegalMinima: minima,
    total: fromCents(abs),
  };
}

/* ───────────────────── cuentas anuales: balance y PyG (PGC) ─────────────────────
 * Balance por masas a partir del tipo de cada cuenta: activo no corriente
 * (grupo 2) y corriente; patrimonio neto (con el resultado del ejercicio de
 * la PyG); pasivo no corriente (grupo 1) y corriente. La PyG agrupa los
 * grupos 6 y 7 en las partidas del modelo abreviado. Cuentas con saldo de
 * signo contrario se dejan en su masa con ese signo (sin reclasificar).
 */

export interface SaldoCuentaAnual {
  cuenta: string;
  nombre: string;
  tipo: TipoCuenta;
  debe: Importe;
  haber: Importe;
}

export interface LineaCuentaAnual {
  cuenta: string;
  nombre: string;
  importe: number;
}

export interface MasaCuentaAnual {
  total: number;
  cuentas: LineaCuentaAnual[];
}

export const PARTIDAS_PYG = [
  ['cifraNegocios', 'Importe neto de la cifra de negocios'],
  ['aprovisionamientos', 'Aprovisionamientos'],
  ['otrosIngresosExplotacion', 'Otros ingresos de explotación'],
  ['gastosPersonal', 'Gastos de personal'],
  ['otrosGastosExplotacion', 'Otros gastos de explotación'],
  ['amortizacion', 'Amortización del inmovilizado'],
  ['excesoProvisiones', 'Excesos de provisiones'],
  [
    'resultadoInmovilizado',
    'Deterioro y resultado por enajenaciones del inmovilizado',
  ],
  ['otrosResultados', 'Otros resultados (excepcionales)'],
  ['ingresosFinancieros', 'Ingresos financieros'],
  ['gastosFinancieros', 'Gastos financieros'],
  ['impuesto', 'Impuesto sobre beneficios'],
] as const;
export type PartidaPyg = (typeof PARTIDAS_PYG)[number][0];

const FINANCIERAS: readonly PartidaPyg[] = [
  'ingresosFinancieros',
  'gastosFinancieros',
];

/** Partida de la PyG de una cuenta de los grupos 6 o 7. */
export function partidaPyg(codigo: string): PartidaPyg {
  const g2 = codigo.slice(0, 2);
  const g3 = codigo.slice(0, 3);
  if (g3 === '630') return 'impuesto';
  if (g3 === '678' || g3 === '778') return 'otrosResultados';
  switch (g2) {
    case '70':
      return 'cifraNegocios';
    case '60':
    case '61':
    case '71':
      return 'aprovisionamientos';
    case '64':
      return 'gastosPersonal';
    case '68':
      return 'amortizacion';
    case '79':
      return 'excesoProvisiones';
    case '67':
    case '77':
      return 'resultadoInmovilizado';
    case '66':
      return 'gastosFinancieros';
    case '76':
      return 'ingresosFinancieros';
    default:
      return codigo.startsWith('7')
        ? 'otrosIngresosExplotacion'
        : 'otrosGastosExplotacion';
  }
}

export interface CuentasAnualesCalculo {
  balance: {
    activoNoCorriente: MasaCuentaAnual;
    activoCorriente: MasaCuentaAnual;
    totalActivo: number;
    patrimonioNeto: MasaCuentaAnual;
    /** Incluido en el patrimonio neto. */
    resultadoEjercicio: number;
    pasivoNoCorriente: MasaCuentaAnual;
    pasivoCorriente: MasaCuentaAnual;
    totalPatrimonioNetoYPasivo: number;
    cuadra: boolean;
  };
  pyg: {
    partidas: { clave: PartidaPyg; etiqueta: string; importe: number }[];
    resultadoExplotacion: number;
    resultadoFinanciero: number;
    resultadoAntesImpuestos: number;
    resultado: number;
  };
}

export function cuentasAnuales(
  saldos: readonly SaldoCuentaAnual[],
): CuentasAnualesCalculo {
  const masa = () => ({ total: 0n, cuentas: [] as LineaCuentaAnual[] });
  const anc = masa();
  const ac = masa();
  const pn = masa();
  const pnc = masa();
  const pc = masa();
  const pyg = new Map<PartidaPyg, bigint>(PARTIDAS_PYG.map(([k]) => [k, 0n]));
  const ordenados = [...saldos].sort((a, b) =>
    a.cuenta.localeCompare(b.cuenta),
  );
  for (const s of ordenados) {
    const deudor = toCents(s.debe) - toCents(s.haber);
    if (deudor === 0n) continue;
    if (esCuentaDeResultados(s.cuenta)) {
      const k = partidaPyg(s.cuenta);
      pyg.set(k, pyg.get(k)! - deudor);
      continue;
    }
    const activo = s.tipo === 'activo';
    const importe = activo ? deudor : -deudor;
    const destino = activo
      ? s.cuenta.startsWith('2')
        ? anc
        : ac
      : s.tipo === 'patrimonio'
        ? pn
        : s.cuenta.startsWith('1')
          ? pnc
          : pc;
    destino.total += importe;
    destino.cuentas.push({
      cuenta: s.cuenta,
      nombre: s.nombre,
      importe: fromCents(importe),
    });
  }
  const total = (k: readonly PartidaPyg[]) =>
    sumCents(k.map((x) => pyg.get(x)!));
  const explotacion = total(
    PARTIDAS_PYG.map(([k]) => k).filter(
      (k) => !FINANCIERAS.includes(k) && k !== 'impuesto',
    ),
  );
  const financiero = total(FINANCIERAS);
  const antes = explotacion + financiero;
  const resultado = antes + pyg.get('impuesto')!;
  pn.total += resultado;
  const fmt = (m: { total: bigint; cuentas: LineaCuentaAnual[] }) => ({
    total: fromCents(m.total),
    cuentas: m.cuentas,
  });
  const totalActivo = anc.total + ac.total;
  const totalPnP = pn.total + pnc.total + pc.total;
  return {
    balance: {
      activoNoCorriente: fmt(anc),
      activoCorriente: fmt(ac),
      totalActivo: fromCents(totalActivo),
      patrimonioNeto: fmt(pn),
      resultadoEjercicio: fromCents(resultado),
      pasivoNoCorriente: fmt(pnc),
      pasivoCorriente: fmt(pc),
      totalPatrimonioNetoYPasivo: fromCents(totalPnP),
      cuadra: totalActivo === totalPnP,
    },
    pyg: {
      partidas: PARTIDAS_PYG.map(([clave, etiqueta]) => ({
        clave,
        etiqueta,
        importe: fromCents(pyg.get(clave)!),
      })),
      resultadoExplotacion: fromCents(explotacion),
      resultadoFinanciero: fromCents(financiero),
      resultadoAntesImpuestos: fromCents(antes),
      resultado: fromCents(resultado),
    },
  };
}

/* ───────────────────── devengo periódico de comisiones de aval ─────────────────────
 * Devengo (SAP Accruals / Oracle Subledger) mes a mes de la comisión de
 * riesgo de un aval emitido: saldo vivo × tasa anual × días del mes en que el
 * aval estuvo vigente / 365, half-up al céntimo. Se contabiliza 6260 (obra)
 * a 4100 (acreedor: el banco); cuando el banco la liquida, la comisión salda
 * primero lo devengado pendiente (4100) y solo el exceso va a gasto, así el
 * coste no se duplica.
 */

/** Días del mes `periodo` (AAAA-MM) dentro de [emisión, vencimiento]; null si ninguno. */
export function tramoDevengoMes(p: {
  periodo: string;
  emision: string;
  vencimiento: string | null;
}): { desde: string; hasta: string; dias: number } | null {
  const [y, m] = p.periodo.split('-').map(Number);
  const inicio = `${p.periodo}-01`;
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const desde = p.emision > inicio ? p.emision : inicio;
  const hasta = p.vencimiento && p.vencimiento < fin ? p.vencimiento : fin;
  if (desde > hasta) return null;
  const dias =
    Math.round(
      (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return { desde, hasta, dias };
}

/** Comisión devengada por `dias` días: saldo × tasa (%) × días / base (365). */
export function devengoComisionAval(p: {
  saldoVivo: Importe;
  tasaAnualPct: Importe;
  dias: number;
  baseDias?: number;
}): number {
  const base = p.baseDias ?? 365;
  if (!Number.isInteger(p.dias) || p.dias < 0 || p.dias > 366) {
    throw new RangeError(`Días no válidos: ${p.dias}`);
  }
  const saldo = toCents(p.saldoVivo);
  const tasa = toScaled(p.tasaAnualPct, 4);
  return fromCents(
    mulDivRound(saldo * tasa, BigInt(p.dias), 10_000n * 100n * BigInt(base)),
  );
}

/**
 * Reparto de una liquidación de comisión: primero salda lo devengado
 * pendiente (4100); el exceso es gasto nuevo (6260). Nunca negativo.
 */
export function liquidacionComisionContraDevengo(p: {
  importe: Importe;
  devengado: Importe;
  liquidadoContraDevengo: Importe;
}): { contraDevengo: number; aGasto: number } {
  const imp = toCents(p.importe);
  const pendienteBruto =
    toCents(p.devengado) - toCents(p.liquidadoContraDevengo);
  const pendiente = pendienteBruto > 0n ? pendienteBruto : 0n;
  const contra = imp < pendiente ? imp : pendiente;
  return { contraDevengo: fromCents(contra), aGasto: fromCents(imp - contra) };
}

/** Asiento de una liquidación de comisión con parte devengada: 4100 / 6260 (obra) a 5720. */
export function asientoLiquidacionComision(p: {
  contraDevengo: Importe;
  aGasto: Importe;
}): LineaAsientoWip[] {
  const contra = toCents(p.contraDevengo);
  const gasto = toCents(p.aGasto);
  const total = contra + gasto;
  if (total <= 0n) return [];
  const lineas: LineaAsientoWip[] = [];
  if (contra > 0n) {
    lineas.push({
      cuenta: '4100',
      debe: centsToNumeric(contra),
      haber: '0.00',
      imputaObra: false,
    });
  }
  if (gasto > 0n) {
    lineas.push({
      cuenta: '6260',
      debe: centsToNumeric(gasto),
      haber: '0.00',
      imputaObra: true,
    });
  }
  lineas.push({
    cuenta: '5720',
    debe: '0.00',
    haber: centsToNumeric(total),
    imputaObra: false,
  });
  return lineas;
}

/** Asiento del devengo mensual: 6260 (obra) a 4100. */
export function asientoDevengoComision(importe: Importe): LineaAsientoWip[] {
  const c = toCents(importe);
  if (c <= 0n) return [];
  const imp = centsToNumeric(c);
  return [
    { cuenta: '6260', debe: imp, haber: '0.00', imputaObra: true },
    { cuenta: '4100', debe: '0.00', haber: imp, imputaObra: false },
  ];
}

/* ───────────────────── devengo prorrateado por tramos de saldo ─────────────────────
 * El mes se parte en tramos en los que el saldo vivo es constante (cada
 * liberación, ejecución o vencimiento abre uno nuevo desde su fecha). El
 * total es Σ saldo × días × tasa / 365 redondeado una sola vez, y se reparte
 * entre tramos por resto mayor: con saldo constante coincide al céntimo con
 * `devengoComisionAval`.
 */

export interface TramoDevengo {
  desde: string;
  hasta: string;
  dias: number;
  saldo: number;
  /** Tasa anual aplicada en el tramo (%). Ausente en devengos anteriores a la 0064. */
  tasaAnualPct?: number;
  importe: number;
}

const masDias = (fecha: string, n: number) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (desde: string, hasta: string) =>
  Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) /
      86_400_000,
  ) + 1;

export function devengoPorTramos(p: {
  periodo: string;
  emision: string;
  vencimiento: string | null;
  /** Tasa única (sin historial) o la de respaldo antes del primer cambio. */
  tasaAnualPct: Importe;
  /** Historial de saldo vivo: el de cada fecha rige desde ese día. */
  saldos: readonly { fecha: string; saldo: Importe }[];
  /**
   * Historial de tasas (opcional): la de cada fecha rige desde ese día; antes
   * del primer cambio, `tasaAnualPct`. Un cambio dentro del mes abre tramo.
   */
  tasas?: readonly { fecha: string; tasaAnualPct: Importe }[];
  baseDias?: number;
}): { tramos: TramoDevengo[]; dias: number; importe: number } {
  const base = p.baseDias ?? 365;
  const mes = tramoDevengoMes({
    periodo: p.periodo,
    emision: p.emision,
    vencimiento: p.vencimiento,
  });
  if (!mes) return { tramos: [], dias: 0, importe: 0 };
  const hist = [...p.saldos]
    .map((s) => ({ fecha: s.fecha, saldo: toCents(s.saldo) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const histTasas = [...(p.tasas ?? [])]
    .map((t) => ({ fecha: t.fecha, tasa: toScaled(t.tasaAnualPct, 4) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const saldoEn = (fecha: string) => {
    let s = 0n;
    for (const h of hist) if (h.fecha <= fecha) s = h.saldo;
    return s;
  };
  const tasaEn = (fecha: string) => {
    let t = toScaled(p.tasaAnualPct, 4);
    for (const h of histTasas) if (h.fecha <= fecha) t = h.tasa;
    return t;
  };
  const cortes = [
    mes.desde,
    ...[...hist, ...histTasas]
      .map((h) => h.fecha)
      .filter((f) => f > mes.desde && f <= mes.hasta)
      .sort(),
  ].filter((f, i, a) => a.indexOf(f) === i);
  const brutos: {
    desde: string;
    hasta: string;
    dias: number;
    saldo: bigint;
    tasa: bigint;
  }[] = [];
  cortes.forEach((desde, i) => {
    const hasta =
      i + 1 < cortes.length ? masDias(cortes[i + 1], -1) : mes.hasta;
    const saldo = saldoEn(desde);
    if (saldo > 0n) {
      brutos.push({
        desde,
        hasta,
        dias: diasEntre(desde, hasta),
        saldo,
        tasa: tasaEn(desde),
      });
    }
  });
  // Σ saldo × días × tasa, redondeado una sola vez y repartido por resto
  // mayor: con saldo y tasa constantes coincide con devengoComisionAval.
  const pesos = brutos.map((t) => t.saldo * BigInt(t.dias) * t.tasa);
  const total = mulDivRound(sumCents(pesos), 1n, 10_000n * 100n * BigInt(base));
  const importes = brutos.length === 0 ? [] : repartirCents(total, pesos);
  return {
    tramos: brutos.map((t, i) => ({
      desde: t.desde,
      hasta: t.hasta,
      dias: t.dias,
      saldo: fromCents(t.saldo),
      tasaAnualPct: Number(t.tasa) / 10_000,
      importe: fromCents(importes[i]),
    })),
    dias: brutos.reduce((s, t) => s + t.dias, 0),
    importe: fromCents(total),
  };
}

/**
 * Un mes está terminado respecto a una fecha de referencia (por defecto la
 * del sistema, que pasa el llamador): solo se devengan meses terminados. Con
 * la referencia explícita el cálculo es determinista (tests, reprocesos).
 */
export function mesTerminado(
  periodo: string,
  fechaReferencia: string,
): boolean {
  return periodo < fechaReferencia.slice(0, 7);
}

/** Mes anterior al de una fecha (AAAA-MM). */
export function mesAnteriorA(fecha: string): string {
  const [y, m] = fecha.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Meses AAAA-MM de `desde` a `hasta` (ambos incluidos). */
export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let [y, m] = desde.split('-').map(Number);
  const [yh, mh] = hasta.split('-').map(Number);
  while (y < yh || (y === yh && m <= mh)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/* ───────────────────── estado de cambios en el patrimonio neto (ECPN) ─────────────────────
 * Columnas por masa de PN y filas por naturaleza del movimiento del ejercicio:
 *   saldo inicial (apertura) · total de ingresos y gastos reconocidos (el
 *   resultado de la PyG) · operaciones con socios (dividendos y variaciones
 *   de capital) · distribución del resultado anterior (traspaso a reservas,
 *   remanente o compensación) · otras variaciones · saldo final.
 * El saldo final cuadra con el patrimonio neto del balance.
 */

export const COLUMNAS_ECPN = [
  'capital',
  'reservas',
  'resultadosAnteriores',
  'resultadoEjercicio',
  'otros',
] as const;
export type ColumnaEcpn = (typeof COLUMNAS_ECPN)[number];

export function columnaEcpn(cuenta: string): ColumnaEcpn {
  if (cuenta.startsWith('10')) return 'capital';
  if (cuenta.startsWith('11')) return 'reservas';
  if (cuenta.startsWith('129')) return 'resultadoEjercicio';
  if (cuenta.startsWith('12')) return 'resultadosAnteriores';
  return 'otros';
}

export type OrigenMovimientoPn = 'apertura' | 'aplicacion' | 'otro';

export interface FilaEcpn {
  clave:
    | 'saldoInicial'
    | 'ingresosGastosReconocidos'
    | 'operacionesSocios'
    | 'distribucionResultado'
    | 'otrasVariaciones'
    | 'saldoFinal';
  etiqueta: string;
  importes: Record<ColumnaEcpn, number>;
  total: number;
}

export function estadoCambiosPatrimonioNeto(p: {
  /** Movimientos de las cuentas de PN del ejercicio, sin regularización ni cierre. */
  movimientos: readonly {
    cuenta: string;
    origen: OrigenMovimientoPn;
    debe: Importe;
    haber: Importe;
  }[];
  /** Resultado del ejercicio (PyG). */
  resultadoEjercicio: Importe;
  /** Dividendos acordados en el ejercicio (a 5260, aplicación del resultado). */
  dividendos: Importe;
}): { filas: FilaEcpn[]; saldoFinal: FilaEcpn } {
  const cero = () =>
    Object.fromEntries(COLUMNAS_ECPN.map((c) => [c, 0n])) as Record<
      ColumnaEcpn,
      bigint
    >;
  const ini = cero();
  const igr = cero();
  const socios = cero();
  const distribucion = cero();
  const otras = cero();
  for (const m of p.movimientos) {
    const col = columnaEcpn(m.cuenta);
    const neto = toCents(m.haber) - toCents(m.debe);
    if (m.origen === 'apertura') ini[col] += neto;
    else if (m.origen === 'aplicacion') distribucion[col] += neto;
    else if (col === 'capital') socios[col] += neto;
    else otras[col] += neto;
  }
  igr.resultadoEjercicio = toCents(p.resultadoEjercicio);
  // Los dividendos salen de la columna del resultado como operación con
  // socios; el resto de la aplicación es distribución entre columnas de PN.
  const div = toCents(p.dividendos);
  socios.resultadoEjercicio -= div;
  distribucion.resultadoEjercicio += div;
  const fin = cero();
  for (const f of [ini, igr, socios, distribucion, otras]) {
    for (const c of COLUMNAS_ECPN) fin[c] += f[c];
  }
  const fila = (
    clave: FilaEcpn['clave'],
    etiqueta: string,
    v: Record<ColumnaEcpn, bigint>,
  ): FilaEcpn => ({
    clave,
    etiqueta,
    importes: Object.fromEntries(
      COLUMNAS_ECPN.map((c) => [c, fromCents(v[c])]),
    ) as Record<ColumnaEcpn, number>,
    total: fromCents(sumCents(COLUMNAS_ECPN.map((c) => v[c]))),
  });
  const saldoFinal = fila('saldoFinal', 'Saldo final del ejercicio', fin);
  return {
    filas: [
      fila('saldoInicial', 'Saldo inicial', ini),
      fila(
        'ingresosGastosReconocidos',
        'Total ingresos y gastos reconocidos',
        igr,
      ),
      fila(
        'operacionesSocios',
        'Operaciones con socios (dividendos y capital)',
        socios,
      ),
      fila(
        'distribucionResultado',
        'Distribución del resultado anterior',
        distribucion,
      ),
      fila('otrasVariaciones', 'Otras variaciones del patrimonio neto', otras),
      saldoFinal,
    ],
    saldoFinal,
  };
}

/* ───────────────────── estado de flujos de efectivo (EFE, indirecto) ─────────────────────
 * Con los movimientos del ejercicio (sin apertura, regularización ni cierre)
 * cada cuenta no de tesorería aporta −(debe − haber) a su actividad:
 *   explotación = resultado (6/7) + ajustes (28x, 29x, 39x, 49x, 14x) +
 *                 cambios en el capital corriente (3x, 4x);
 *   inversión   = inmovilizado (2x salvo 28x y 29x);
 *   financiación = patrimonio y deudas (1x salvo 14x, 5x salvo 57x).
 * Por partida doble, la suma es exactamente la variación de 57x.
 */

export type ActividadEfe =
  | 'resultado'
  | 'ajustes'
  | 'capitalCorriente'
  | 'inversion'
  | 'financiacion'
  | 'efectivo';

export function actividadEfe(cuenta: string): ActividadEfe {
  const g = cuenta.charAt(0);
  const g2 = cuenta.slice(0, 2);
  if (g2 === '57') return 'efectivo';
  if (g === '6' || g === '7') return 'resultado';
  if (['28', '29', '39', '49', '14'].includes(g2)) return 'ajustes';
  if (g === '3' || g === '4') return 'capitalCorriente';
  if (g === '2') return 'inversion';
  if (g === '1' || g === '5') return 'financiacion';
  return 'capitalCorriente';
}

/** Subgrupo del capital corriente en el EFE. */
export type PartidaCapitalCorriente =
  'existencias' | 'clientes' | 'proveedores' | 'administraciones' | 'otros';

export function partidaCapitalCorriente(
  cuenta: string,
): PartidaCapitalCorriente {
  const g2 = cuenta.slice(0, 2);
  if (cuenta.startsWith('3')) return 'existencias';
  if (g2 === '43' || g2 === '44') return 'clientes';
  if (g2 === '40' || g2 === '41') return 'proveedores';
  if (g2 === '47') return 'administraciones';
  return 'otros';
}

export interface EstadoFlujosEfectivo {
  /**
   * Detalle de cobros a clientes y pagos a proveedores según el origen de los
   * apuntes de 57x (lo añade el servicio; suma exactamente la variación).
   */
  cobrosPagos?: {
    cobrosClientes: number;
    pagosProveedores: number;
    otros: number;
    total: number;
    cuadra: boolean;
  };
  explotacion: {
    resultado: number;
    ajustes: number;
    capitalCorriente: number;
    /**
     * Desglose del capital corriente (suma exacta): existencias (3x),
     * clientes y deudores (43x, 44x: lo facturado menos lo cobrado),
     * proveedores y acreedores (40x, 41x), administraciones públicas (47x) y
     * otros (resto del grupo 4).
     */
    capitalCorrienteDesglose: Record<PartidaCapitalCorriente, number>;
    total: number;
  };
  inversion: number;
  financiacion: number;
  /** Explotación + inversión + financiación. */
  flujoNeto: number;
  efectivoInicial: number;
  variacionEfectivo: number;
  efectivoFinal: number;
  /** flujoNeto = variación de 57x (debe cumplirse siempre). */
  cuadra: boolean;
}

export function estadoFlujosEfectivo(p: {
  movimientos: readonly { cuenta: string; debe: Importe; haber: Importe }[];
  efectivoInicial: Importe;
}): EstadoFlujosEfectivo {
  const acc: Record<ActividadEfe, bigint> = {
    resultado: 0n,
    ajustes: 0n,
    capitalCorriente: 0n,
    inversion: 0n,
    financiacion: 0n,
    efectivo: 0n,
  };
  const cc: Record<PartidaCapitalCorriente, bigint> = {
    existencias: 0n,
    clientes: 0n,
    proveedores: 0n,
    administraciones: 0n,
    otros: 0n,
  };
  for (const m of p.movimientos) {
    const deudor = toCents(m.debe) - toCents(m.haber);
    const a = actividadEfe(m.cuenta);
    acc[a] += a === 'efectivo' ? deudor : -deudor;
    if (a === 'capitalCorriente')
      cc[partidaCapitalCorriente(m.cuenta)] -= deudor;
  }
  const explotacion = acc.resultado + acc.ajustes + acc.capitalCorriente;
  const neto = explotacion + acc.inversion + acc.financiacion;
  const inicial = toCents(p.efectivoInicial);
  return {
    explotacion: {
      resultado: fromCents(acc.resultado),
      ajustes: fromCents(acc.ajustes),
      capitalCorriente: fromCents(acc.capitalCorriente),
      capitalCorrienteDesglose: {
        existencias: fromCents(cc.existencias),
        clientes: fromCents(cc.clientes),
        proveedores: fromCents(cc.proveedores),
        administraciones: fromCents(cc.administraciones),
        otros: fromCents(cc.otros),
      },
      total: fromCents(explotacion),
    },
    inversion: fromCents(acc.inversion),
    financiacion: fromCents(acc.financiacion),
    flujoNeto: fromCents(neto),
    efectivoInicial: fromCents(inicial),
    variacionEfectivo: fromCents(acc.efectivo),
    efectivoFinal: fromCents(inicial + acc.efectivo),
    cuadra: neto === acc.efectivo,
  };
}

/* ───────────────────── conciliación auxiliar ↔ mayor (cierre) ─────────────────────
 * Al estilo de SAP Financial Close / Oracle Close Manager: cada partida
 * compara el saldo de un auxiliar (devengos de avales, amortización de
 * activos, obra en curso, provisión por pérdidas) con el de su cuenta del
 * mayor. Una diferencia distinta de cero es un descuadre a investigar.
 */

export interface DetalleConciliacion {
  clave: string;
  concepto: string;
  importe: number;
}

export interface PartidaConciliacion {
  clave: string;
  etiqueta: string;
  cuentas: string;
  auxiliar: number;
  mayor: number;
  diferencia: number;
  cuadra: boolean;
  /** Desglose informativo del auxiliar (p. ej. retención vencida / no vencida). */
  detalle?: DetalleConciliacion[];
}

export function conciliar(
  partidas: readonly {
    clave: string;
    etiqueta: string;
    cuentas: string;
    auxiliar: Importe;
    mayor: Importe;
    detalle?: readonly { clave: string; concepto: string; importe: Importe }[];
  }[],
): { partidas: PartidaConciliacion[]; cuadra: boolean; descuadres: number } {
  const out = partidas.map((x) => {
    const a = toCents(x.auxiliar);
    const m = toCents(x.mayor);
    return {
      clave: x.clave,
      etiqueta: x.etiqueta,
      cuentas: x.cuentas,
      auxiliar: fromCents(a),
      mayor: fromCents(m),
      diferencia: fromCents(m - a),
      cuadra: a === m,
      ...(x.detalle
        ? {
            detalle: x.detalle.map((d) => ({
              clave: d.clave,
              concepto: d.concepto,
              importe: fromCents(toCents(d.importe)),
            })),
          }
        : {}),
    };
  });
  const descuadres = out.filter((x) => !x.cuadra).length;
  return { partidas: out, cuadra: descuadres === 0, descuadres };
}

/** Vencimiento de retención de garantía de un tercero (importe y liquidado a la fecha). */
export interface RetencionPendiente {
  importe: Importe;
  /** Liquidado (vigente) hasta la fecha de corte. */
  liquidado: Importe;
  /** Fecha de liberación prevista (vencimiento del plazo de garantía). */
  vencimiento: string;
}

export interface SaldoTerceroAFecha {
  /** Pendiente ordinario (cuenta 4300 / 4000). */
  ordinario: number;
  /** Retención de garantía pendiente (cuenta 4301 / 4001). */
  retencion: number;
  /** Retención cuyo plazo de garantía venció a la fecha y sigue sin liquidar. */
  retencionVencida: number;
  /** Retención aún dentro del plazo de garantía. */
  retencionNoVencida: number;
  total: number;
}

/**
 * Saldo de clientes o proveedores a una fecha de corte, separando lo
 * ordinario de la retención de garantía (en SAP, operación CME / indicador de
 * mayor especial; en Oracle, «retainage»). La factura lleva al mayor total −
 * retención a 4300/4000 y la retención a 4301/4001, y cada cobro o pago salda
 * la cuenta de su vencimiento (ordinario o retención):
 *  - ordinario = facturado − retenido − liquidado ordinario;
 *  - retención = retenido − liquidado de retención, del que se separa la parte
 *    cuyo plazo venció a la fecha (`vencimiento ≤ fecha`).
 * En céntimos exactos; los saldos de signo contrario (sobrecobro) se respetan.
 */
export function saldoTerceroAFecha(x: {
  fecha: string;
  facturado: Importe;
  retenido: Importe;
  liquidadoOrdinario: Importe;
  liquidadoRetencion: Importe;
  retenciones: readonly RetencionPendiente[];
}): SaldoTerceroAFecha {
  const ordinario =
    toCents(x.facturado) - toCents(x.retenido) - toCents(x.liquidadoOrdinario);
  const retencion = toCents(x.retenido) - toCents(x.liquidadoRetencion);
  const vencida = sumCents(
    x.retenciones
      .filter((r) => r.vencimiento <= x.fecha)
      .map((r) => toCents(r.importe) - toCents(r.liquidado)),
  );
  return {
    ordinario: fromCents(ordinario),
    retencion: fromCents(retencion),
    retencionVencida: fromCents(vencida),
    retencionNoVencida: fromCents(retencion - vencida),
    total: fromCents(ordinario + retencion),
  };
}
