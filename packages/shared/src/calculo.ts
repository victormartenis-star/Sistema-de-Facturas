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
