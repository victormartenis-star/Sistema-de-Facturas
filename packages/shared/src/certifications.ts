import { z } from 'zod';
import { formatEuros, round2 } from './calculo';

/**
 * Certificaciones de obra con facturación a origen:
 * cada certificación registra el % ejecutado acumulado (a origen) y el
 * importe del periodo se calcula descontando lo ya certificado antes.
 */

export const CERT_STATUSES = ['borrador', 'facturada'] as const;
export type CertStatus = (typeof CERT_STATUSES)[number];

export const CERT_STATUS_LABELS: Record<CertStatus, string> = {
  borrador: 'Borrador',
  facturada: 'Facturada',
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const certificationCreateSchema = z.object({
  projectId: z.string().uuid('Obra no válida'),
  certDate: isoDate,
  cumulativePct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .gt(0, 'Debe ser mayor que 0')
    .max(100, 'No puede superar el 100 %'),
  retentionPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'Entre 0 y 20')
    .max(20, 'Entre 0 y 20')
    .nullish(), // si no se indica, se usa la retención de la obra
  notes: z.string().trim().max(1000).nullish(),
});

export type CertificationCreateInput = z.input<
  typeof certificationCreateSchema
>;

/** Datos para emitir la factura de venta desde una certificación. */
export const certificationInvoiceSchema = z.object({
  /** Cliente al que se emite la factura. */
  contactId: z.string().uuid('Cliente no válido'),
  invoiceNumber: z
    .string()
    .trim()
    .min(1, 'El número de factura es obligatorio')
    .max(60, 'Máximo 60 caracteres'),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  /** En construcción entre empresas lo habitual es facturar con ISP. */
  isp: z.boolean().default(true),
  retentionReleaseDate: isoDate.nullish(),
});

export type CertificationInvoiceInput = z.input<
  typeof certificationInvoiceSchema
>;

export interface CertificationDto {
  id: string;
  projectId: string;
  seq: number;
  certDate: string;
  /** % ejecutado acumulado a origen. */
  cumulativePct: number;
  /**
   * Presupuesto sobre el que se aplicó el %: contrato más modificados
   * aprobados en la fecha de la certificación. Null en las certificaciones
   * anteriores a que se guardara la base.
   */
  budgetBase: number | null;
  /** ¿La base incluye modificados, o es el contrato inicial a secas? */
  budgetBaseIsUpdated: boolean;
  /** Importe acumulado a origen (presupuesto vigente × %). */
  cumulativeAmount: number;
  /** Lo certificado en periodos anteriores. */
  previousAmount: number;
  /** Importe de este periodo (acumulado - anterior). */
  periodAmount: number;
  retentionPct: number;
  retentionAmount: number;
  status: CertStatus;
  invoiceId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Base de certificación de una obra y lo que hay que saber de ella. */
export interface CertificationBaseDto {
  projectId: string;
  /** Contrato inicial. */
  contractAmount: number | null;
  /** Contrato más modificados aprobados: la base sobre la que se certifica. */
  currentBudget: number | null;
  warnings: string[];
}

/* ─────────────────────────── avisos ─────────────────────────── */

/**
 * Lo que hay que leer de las certificaciones de una obra.
 *
 * El fallo que persiguen: certificar a origen contra el contrato inicial
 * cuando hay modificados aprobados. El % se aplica a una base menor de la
 * real, así que se certifica de menos —y no se nota, porque el porcentaje que
 * se teclea es el correcto—. Lo que falta no aparece en ninguna parte: no hay
 * una fila que diga «te dejaste esto», simplemente se cobra menos.
 */
export function certificationWarnings(
  rows: { seq: number; budgetBase: number | null; status: CertStatus }[],
  currentBase: number,
  contractAmount: number,
): string[] {
  const warnings: string[] = [];
  if (rows.length === 0) return warnings;

  const sinBase = rows.filter((r) => r.budgetBase === null);
  if (sinBase.length > 0 && currentBase !== contractAmount) {
    warnings.push(
      `${sinBase.length} certificación(es) anteriores no guardaron sobre qué presupuesto se hicieron. Con modificados aprobados de por medio, revisa a mano si se certificaron sobre el contrato inicial.`,
    );
  }

  const ultima = [...rows].sort((a, b) => b.seq - a.seq)[0];
  if (ultima.budgetBase !== null && ultima.budgetBase !== currentBase) {
    const diferencia = round2(currentBase - ultima.budgetBase);
    warnings.push(
      `El presupuesto vigente ha cambiado en ${formatEuros(diferencia)} desde la certificación nº ${ultima.seq}: la próxima se calculará sobre ${formatEuros(currentBase)} y el acumulado dará un salto. No es un error, es el modificado entrando a origen.`,
    );
  }

  if (currentBase !== contractAmount) {
    warnings.push(
      `Se certifica sobre el presupuesto actualizado (${formatEuros(currentBase)}), no sobre el contrato inicial (${formatEuros(contractAmount)}). Solo entran los modificados aprobados por la Dirección Facultativa y por la Propiedad.`,
    );
  }

  return warnings;
}
