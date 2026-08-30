import { z } from 'zod';
import { daysBetween, formatEuros, round2 } from './calculo';

/**
 * Modificados, contradictorios y presupuesto actualizado.
 *
 * El criterio, que es el correcto y no se toca: solo se consideran
 * consolidadas las modificaciones con **aprobación expresa de la Dirección
 * Facultativa y de la Propiedad**, técnica y económica. Las pendientes se
 * recogen de forma diferenciada, no computan como ingreso y tienen carácter
 * informativo y de seguimiento hasta su validación formal.
 */

export const VARIATION_KINDS = [
  'modificado',
  'contradictorio',
  'exceso_medicion',
  'cambio_solucion',
  'variacion_calidades',
  'eliminacion_partida',
] as const;

export type VariationKind = (typeof VARIATION_KINDS)[number];

export const VARIATION_KIND_LABELS: Record<VariationKind, string> = {
  modificado: 'Modificado',
  contradictorio: 'Precio contradictorio',
  exceso_medicion: 'Exceso de medición',
  cambio_solucion: 'Cambio de solución constructiva',
  variacion_calidades: 'Variación de calidades',
  eliminacion_partida: 'Eliminación de partida',
};

export const VARIATION_STATUSES = [
  'pendiente',
  'aprobado',
  'rechazado',
] as const;

export type VariationStatus = (typeof VARIATION_STATUSES)[number];

export const VARIATION_STATUS_LABELS: Record<VariationStatus, string> = {
  pendiente: 'Pendiente de aprobación',
  aprobado: 'Aprobado por DF y Propiedad',
  rechazado: 'Solicitado y no aprobado',
};

/** Días a partir de los cuales un pendiente se escala a la Propiedad. */
export const ESCALATION_DAYS = 60;

/* ─────────────────────────── numeración ─────────────────────────── */

/** OBR-045 + 3 → OBR-045-MOD-0003, con la misma lógica que los pedidos. */
export function buildVariationNumber(projectCode: string, seq: number): string {
  return `${projectCode}-MOD-${String(seq).padStart(4, '0')}`;
}

/* ────────────────────────── estado ────────────────────────── */

export interface ApprovalState {
  dfApprovedAt: string | null;
  ownerApprovedAt: string | null;
  rejectedAt: string | null;
}

/**
 * Estado que corresponde a las aprobaciones registradas.
 *
 * Las dos aprobaciones son independientes y hacen falta **las dos**: con el
 * visto bueno de la Dirección Facultativa pero sin el de la Propiedad el
 * modificado sigue pendiente. Darlo por aprobado con una sola firma es
 * incorporar al presupuesto un ingreso que nadie se ha comprometido a pagar.
 */
export function deriveVariationStatus(a: ApprovalState): VariationStatus {
  if (a.rejectedAt) return 'rechazado';
  if (a.dfApprovedAt && a.ownerApprovedAt) return 'aprobado';
  return 'pendiente';
}

/** Días transcurridos desde que se solicitó, para medir la antigüedad. */
export function variationAge(requestedAt: string, today: string): number {
  return Math.max(0, daysBetween(requestedAt, today));
}

/* ────────────────── impacto sobre el presupuesto ────────────────── */

export interface VariationAmounts {
  status: VariationStatus;
  salesVariation: number;
  costVariation: number;
  executed: boolean;
}

export interface BudgetImpactDto {
  /** Presupuesto contractual inicial. */
  initialBudget: number;
  approvedIncrease: number;
  /** Negativo o cero. */
  approvedDecrease: number;
  /** Inicial + aprobadas al alza + aprobadas a la baja. */
  updatedBudget: number;
  pendingIncrease: number;
  /** Negativo o cero. */
  pendingDecrease: number;
  /** Suma neta de lo pendiente: lo que está en juego. */
  potentialImpact: number;
  /** Presupuesto si se aprobara todo lo pendiente. */
  potentialBudget: number;
  /**
   * Coste de los modificados que ya se están ejecutando sin estar aprobados.
   * Es la cifra que el informe original no recogía y la forma más rápida de
   * perder margen: coste que corre sin ingreso que lo respalde.
   */
  executedNotApprovedCost: number;
  executedNotApprovedCount: number;
}

/**
 * Cuadro de impacto sobre el presupuesto (anexo D del manual).
 *
 * Lo rechazado no aparece en ninguna suma: no computa ni como ingreso ni como
 * potencial. Se conserva el registro para la liquidación, pero fuera del
 * presupuesto.
 */
export function computeBudgetImpact(
  initialBudget: number,
  variations: VariationAmounts[],
): BudgetImpactDto {
  const sum = (
    filter: (v: VariationAmounts) => boolean,
    pick: (v: VariationAmounts) => number = (v) => v.salesVariation,
  ) => round2(variations.filter(filter).reduce((s, v) => s + pick(v), 0));

  const approved = (v: VariationAmounts) => v.status === 'aprobado';
  const pending = (v: VariationAmounts) => v.status === 'pendiente';

  const approvedIncrease = sum((v) => approved(v) && v.salesVariation > 0);
  const approvedDecrease = sum((v) => approved(v) && v.salesVariation < 0);
  const pendingIncrease = sum((v) => pending(v) && v.salesVariation > 0);
  const pendingDecrease = sum((v) => pending(v) && v.salesVariation < 0);

  const updatedBudget = round2(
    initialBudget + approvedIncrease + approvedDecrease,
  );
  const potentialImpact = round2(pendingIncrease + pendingDecrease);

  const executedNotApproved = variations.filter(
    (v) => v.executed && v.status !== 'aprobado',
  );

  return {
    initialBudget,
    approvedIncrease,
    approvedDecrease,
    updatedBudget,
    pendingIncrease,
    pendingDecrease,
    potentialImpact,
    potentialBudget: round2(updatedBudget + potentialImpact),
    executedNotApprovedCost: round2(
      executedNotApproved.reduce((s, v) => s + v.costVariation, 0),
    ),
    executedNotApprovedCount: executedNotApproved.length,
  };
}

/* ─────────────────────────── avisos ─────────────────────────── */

export interface VariationWarningInput {
  variationNumber: string;
  status: VariationStatus;
  executed: boolean;
  clientOrderRef: string | null;
  costVariation: number;
  requestedAt: string;
  dfApprovedAt: string | null;
  ownerApprovedAt: string | null;
}

/**
 * Avisos de un modificado concreto, en el orden en que importan.
 *
 * El primero es el que cuesta dinero de verdad: trabajo ya ejecutado que
 * nadie ha aprobado todavía.
 */
export function variationWarnings(
  v: VariationWarningInput,
  today: string,
): string[] {
  const warnings: string[] = [];

  if (v.executed && v.status === 'pendiente') {
    warnings.push(
      `Se está ejecutando sin aprobación: ${formatEuros(v.costVariation)} de coste corriendo sin ingreso que lo respalde.`,
    );
  }
  if (v.executed && v.status === 'rechazado') {
    warnings.push(
      'Se está ejecutando y la Propiedad lo ha rechazado: ese coste no se va a cobrar.',
    );
  }
  if (v.executed && !v.clientOrderRef) {
    warnings.push(
      'Trabajo fuera de contrato sin orden escrita del cliente registrada.',
    );
  }
  if (v.status === 'pendiente') {
    const age = variationAge(v.requestedAt, today);
    if (age > ESCALATION_DAYS) {
      warnings.push(
        `Lleva ${age} días pendiente (más de ${ESCALATION_DAYS}): toca escalarlo formalmente a la Propiedad.`,
      );
    }
    if (v.dfApprovedAt && !v.ownerApprovedAt) {
      warnings.push(
        'Aprobado por la Dirección Facultativa pero no por la Propiedad: todavía no computa como ingreso.',
      );
    }
    if (!v.dfApprovedAt && v.ownerApprovedAt) {
      warnings.push(
        'Aprobado por la Propiedad pero falta la Dirección Facultativa.',
      );
    }
  }
  return warnings;
}

/* ────────────────────── esquemas de entrada ────────────────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

/** La variación puede ser negativa: eliminar partidas baja el presupuesto. */
const signedMoney = z
  .number({ invalid_type_error: 'Debe ser un número' })
  .min(-999_999_999_999.99)
  .max(999_999_999_999.99);

export const variationCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  kind: z.enum(VARIATION_KINDS).default('modificado'),
  phaseId: z.string().uuid('Partida no válida').nullish(),
  description: z
    .string()
    .trim()
    .min(1, 'Describe la modificación')
    .max(500, 'Máximo 500 caracteres'),
  salesVariation: signedMoney,
  costVariation: signedMoney.default(0),
  requestedAt: isoDate,
  executed: z.boolean().default(false),
  clientOrderRef: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const variationUpdateSchema = variationCreateSchema
  .partial()
  .omit({ projectId: true });

export type VariationCreateInput = z.input<typeof variationCreateSchema>;
export type VariationUpdateInput = z.input<typeof variationUpdateSchema>;

/** Registro de una aprobación: quién la da y con qué fecha. */
export const variationApproveSchema = z.object({
  by: z.enum(['df', 'propiedad'], {
    errorMap: () => ({ message: 'Indica si aprueba la DF o la Propiedad' }),
  }),
  date: isoDate,
});

export type VariationApproveInput = z.input<typeof variationApproveSchema>;

export const variationRejectSchema = z.object({
  date: isoDate,
  reason: z
    .string()
    .trim()
    .min(1, 'El motivo de la negativa es obligatorio')
    .max(500),
});

export type VariationRejectInput = z.input<typeof variationRejectSchema>;

/* ─────────────────────────────── DTOs ─────────────────────────────── */

export interface VariationDto {
  id: string;
  variationNumber: string;
  seq: number;
  projectId: string;
  projectCode: string;
  kind: VariationKind;
  phaseId: string | null;
  phaseCode: string | null;
  description: string;
  salesVariation: number;
  costVariation: number;
  /** Margen de la propia modificación: lo que se cobra menos lo que cuesta. */
  variationMargin: number;
  requestedAt: string;
  /** Días desde la solicitud; 0 una vez resuelto. */
  ageDays: number;
  dfApprovedAt: string | null;
  ownerApprovedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  status: VariationStatus;
  executed: boolean;
  clientOrderRef: string | null;
  notes: string | null;
  warnings: string[];
  createdAt: string;
}

/** Informe de modificaciones de una obra (anexo D). */
export interface VariationReportDto {
  projectId: string;
  projectCode: string;
  projectName: string;
  impact: BudgetImpactDto;
  approved: VariationDto[];
  pending: VariationDto[];
  rejected: VariationDto[];
  /** Avisos agregados de toda la obra. */
  warnings: string[];
}
