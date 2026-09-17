import { z } from 'zod';
import { daysBetween } from './calculo';

/**
 * Conciliación bancaria (Fase 14): importar un extracto (CSV genérico o
 * Norma 43/AEB43) y sugerir, sin automatizarlo, qué `payment_milestones`
 * cuadra cada movimiento — el Roadmap lo pide "asistida", no automática.
 */

export const BANK_STATEMENT_FORMATS = ['csv', 'norma43'] as const;
export type BankStatementFormat = (typeof BANK_STATEMENT_FORMATS)[number];

export interface ParsedBankTransaction {
  /** ISO `AAAA-MM-DD`. */
  transactionDate: string;
  /** Con signo: positivo cobro, negativo pago — igual que lo trae el extracto. */
  amount: number;
  concept: string;
  balanceAfter: number | null;
  bankReference: string | null;
}

export interface BankTransactionDto extends ParsedBankTransaction {
  id: string;
  bankAccountId: string;
  reconciledMilestoneId: string | null;
  reconciledAt: string | null;
  createdAt: string;
}

export interface BankImportSummaryDto {
  total: number;
  imported: number;
  duplicates: number;
}

export const reconcileTransactionSchema = z.object({
  milestoneId: z.string().uuid('Vencimiento no válido'),
});
export type ReconcileTransactionInput = z.infer<
  typeof reconcileTransactionSchema
>;

/* ────────────────────── parser: CSV genérico ────────────────────── */

const CSV_HEADER_ALIASES = {
  transactionDate: ['fecha', 'fecha operacion', 'fecha operación', 'date'],
  concept: ['concepto', 'descripcion', 'descripción', 'concept'],
  amount: ['importe', 'amount'],
  balanceAfter: ['saldo', 'balance'],
  bankReference: ['referencia', 'reference'],
} as const;

/** Admite `1.234,56`/`1234,56` (coma decimal española) y `1234.56` (punto). */
function parseSpanishNumber(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const value = Number(normalized);
  if (Number.isNaN(value)) {
    throw new Error(`Importe no reconocido: "${raw}"`);
  }
  return value;
}

function normalizeCsvDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const spanish = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (spanish) return `${spanish[3]}-${spanish[2]}-${spanish[1]}`;
  throw new Error(
    `Fecha no reconocida: "${raw}" (usa AAAA-MM-DD o DD/MM/AAAA)`,
  );
}

/**
 * CSV con cabecera reconocible por nombre de columna (no por posición fija —
 * cada banco exporta las suyas en un orden distinto). Delimitador `;` o `,`,
 * autodetectado por la primera línea.
 */
export function parseBankCsv(text: string): ParsedBankTransaction[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
  const colIndex = (aliases: readonly string[]): number =>
    header.findIndex((h) => (aliases as readonly string[]).includes(h));

  const dateIdx = colIndex(CSV_HEADER_ALIASES.transactionDate);
  const conceptIdx = colIndex(CSV_HEADER_ALIASES.concept);
  const amountIdx = colIndex(CSV_HEADER_ALIASES.amount);
  const balanceIdx = colIndex(CSV_HEADER_ALIASES.balanceAfter);
  const refIdx = colIndex(CSV_HEADER_ALIASES.bankReference);

  if (dateIdx === -1 || conceptIdx === -1 || amountIdx === -1) {
    throw new Error(
      'El CSV debe tener columnas de fecha, concepto e importe reconocibles ' +
        '(cabecera: fecha/concepto/importe, o sus equivalentes en inglés)',
    );
  }

  return lines.slice(1).map((line) => {
    const cols = line.split(delimiter);
    const balanceRaw = balanceIdx >= 0 ? (cols[balanceIdx] ?? '').trim() : '';
    const refRaw = refIdx >= 0 ? (cols[refIdx] ?? '').trim() : '';
    return {
      transactionDate: normalizeCsvDate(cols[dateIdx] ?? ''),
      amount: parseSpanishNumber(cols[amountIdx] ?? '0'),
      concept: (cols[conceptIdx] ?? '').trim(),
      balanceAfter: balanceRaw ? parseSpanishNumber(balanceRaw) : null,
      bankReference: refRaw || null,
    };
  });
}

/* ────────────────────── parser: Norma 43 / AEB43 ────────────────────── */

/**
 * Formato de ancho fijo de la AEB (Cuaderno 43), el que exportan la mayoría
 * de bancos españoles. Implementado contra la disposición de campos
 * publicada del estándar — **no se ha podido validar contra un extracto
 * real emitido por un banco** en esta sesión (sin credenciales bancarias
 * disponibles); los tests usan un fichero de ejemplo construido a mano
 * siguiendo esa misma disposición, no uno real.
 *
 * Registros relevantes (2 primeros caracteres = tipo):
 *   11  Cabecera de cuenta (ignorada — no aporta datos de movimiento)
 *   22  Movimiento: fecha operación [11-16], débito/crédito [28] ('1'
 *       pago, '2' cobro), importe [29-42] (14 dígitos, últimos 2 decimales
 *       implícitos, sin signo), nº documento [43-50], concepto [51-80]
 *   23  Concepto ampliado opcional del movimiento anterior — se anexa
 *   33  Cierre de cuenta (ignorado — solo trae totales)
 */
function norma43Date(aammdd: string): string {
  const yy = aammdd.slice(0, 2);
  const mm = aammdd.slice(2, 4);
  const dd = aammdd.slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

export function parseNorma43(text: string): ParsedBankTransaction[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ParsedBankTransaction[] = [];
  let pending: ParsedBankTransaction | null = null;

  for (const line of lines) {
    const recordType = line.slice(0, 2);
    if (recordType === '22') {
      if (pending) rows.push(pending);
      const fechaOperacion = norma43Date(line.slice(10, 16));
      const debitoCredito = line.slice(27, 28);
      const importeAbs = Number(line.slice(28, 42) || '0') / 100;
      const documento = line.slice(42, 50).trim();
      const conceptoAmpliado = line.slice(50, 80).trim();
      pending = {
        transactionDate: fechaOperacion,
        amount: debitoCredito === '1' ? -importeAbs : importeAbs,
        concept: conceptoAmpliado || `Movimiento ${documento || 'sin ref.'}`,
        balanceAfter: null,
        bankReference: documento || null,
      };
    } else if (recordType === '23' && pending) {
      const extra = line.slice(4).trim();
      if (extra) pending.concept = `${pending.concept} ${extra}`.trim();
    } else if (recordType === '33' && pending) {
      rows.push(pending);
      pending = null;
    }
  }
  if (pending) rows.push(pending);
  return rows;
}

export function parseBankStatement(
  format: BankStatementFormat,
  text: string,
): ParsedBankTransaction[] {
  return format === 'csv' ? parseBankCsv(text) : parseNorma43(text);
}

/* ────────────────────── conciliación asistida ────────────────────── */

export interface MilestoneForMatching {
  id: string;
  amount: number;
  dueDate: string;
  direction: 'cobro' | 'pago';
}

export type MatchConfidence = 'alta' | 'media' | 'baja';

export interface MatchCandidate {
  milestoneId: string;
  confidence: MatchConfidence;
  daysDiff: number;
}

const AMOUNT_TOLERANCE = 0.01;
const CLOSE_WINDOW_DAYS = 7;
const MEDIUM_WINDOW_DAYS = 15;
const MAX_WINDOW_DAYS = 30;
const MAX_CANDIDATES = 5;

/**
 * Candidatos de conciliación para un movimiento: mismo importe (tolerancia
 * de 1 céntimo por redondeo), mismo sentido (positivo→cobro,
 * negativo→pago) y vencimiento dentro de ±30 días — no es un matcher
 * difuso de importes parciales, un movimiento cuadra con un vencimiento
 * completo o no se sugiere.
 */
export function matchCandidates(
  transaction: Pick<ParsedBankTransaction, 'amount' | 'transactionDate'>,
  milestones: MilestoneForMatching[],
): MatchCandidate[] {
  const wantDirection: MilestoneForMatching['direction'] =
    transaction.amount >= 0 ? 'cobro' : 'pago';

  const candidates: MatchCandidate[] = [];
  for (const m of milestones) {
    if (m.direction !== wantDirection) continue;
    const amountDiff = Math.abs(Math.abs(transaction.amount) - m.amount);
    if (amountDiff > AMOUNT_TOLERANCE) continue;
    const daysDiff = Math.abs(
      daysBetween(m.dueDate, transaction.transactionDate),
    );
    if (daysDiff > MAX_WINDOW_DAYS) continue;
    const confidence: MatchConfidence =
      daysDiff <= CLOSE_WINDOW_DAYS
        ? 'alta'
        : daysDiff <= MEDIUM_WINDOW_DAYS
          ? 'media'
          : 'baja';
    candidates.push({ milestoneId: m.id, confidence, daysDiff });
  }

  return candidates
    .sort((a, b) => a.daysDiff - b.daysDiff)
    .slice(0, MAX_CANDIDATES);
}
