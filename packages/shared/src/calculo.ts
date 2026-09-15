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

/* ───────────────────────────── importes ───────────────────────────── */

/**
 * Redondeo a dos decimales.
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
  const baseAmount = round2(lines.reduce((s, l) => s + l.baseAmount, 0));
  const vatAmount = isp
    ? 0
    : round2(lines.reduce((s, l) => s + (l.baseAmount * l.vatPct) / 100, 0));
  return {
    baseAmount,
    vatAmount,
    totalAmount: round2(baseAmount + vatAmount),
    retentionAmount: round2((baseAmount * retentionPct) / 100),
  };
}

/** Importe realmente exigible ahora: el total menos lo retenido en garantía. */
export function payableAmount(
  totalAmount: number,
  retentionAmount: number,
): number {
  return round2(totalAmount - retentionAmount);
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
  const cumulativeAmount = round2((contractAmount * cumulativePct) / 100);
  const periodAmount = round2(cumulativeAmount - previousCumulativeAmount);
  return {
    cumulativeAmount,
    periodAmount,
    retentionAmount: round2((periodAmount * retentionPct) / 100),
  };
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
