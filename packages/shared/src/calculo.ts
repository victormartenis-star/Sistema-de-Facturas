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
  fromCents,
  mulDivRound,
  repartirCents,
  sumCents,
  toCents,
} from './dinero';

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
