import { z } from 'zod';
import { addDays, daysBetween } from './calculo';

/**
 * Licencias, acometidas y suministros.
 *
 * Es la etapa que marca el plazo de la obra. El control tiene dos partes que
 * conviene no confundir:
 *
 * - **Retraso acumulado**: días transcurridos desde la fecha que el organismo
 *   comprometió. Mide lo que ya ha pasado.
 * - **Riesgo por no solicitar**: si un trámite tarda de seis a ocho meses y
 *   la obra acaba dentro de cuatro, ya llega tarde aunque nadie lo haya
 *   pedido todavía y por tanto no acumule ni un día de retraso. Este es el
 *   aviso temprano de verdad, y llega mucho antes que cualquier desviación
 *   de coste.
 */

export const PERMIT_KINDS = [
  'licencia_obra',
  'licencia_cala',
  'ocupacion_via_publica',
  'acometida_agua_provisional',
  'acometida_agua',
  'acometida_electrica_provisional',
  'acometida_electrica',
  'potencia_definitiva',
  'tasas_avales',
  'licencia_primera_ocupacion',
  'otro',
] as const;

export type PermitKind = (typeof PERMIT_KINDS)[number];

export const PERMIT_KIND_LABELS: Record<PermitKind, string> = {
  licencia_obra: 'Licencia de obra',
  licencia_cala: 'Licencia de cala',
  ocupacion_via_publica: 'Ocupación de vía pública',
  acometida_agua_provisional: 'Acometida de agua provisional',
  acometida_agua: 'Acometida de agua definitiva',
  acometida_electrica_provisional: 'Acometida eléctrica provisional',
  acometida_electrica: 'Acometida eléctrica definitiva',
  potencia_definitiva: 'Potencia definitiva',
  tasas_avales: 'Tasas y avales',
  licencia_primera_ocupacion: 'Licencia de primera ocupación',
  otro: 'Otro trámite',
};

/** Interlocutor habitual de cada trámite, para no teclearlo cada vez. */
export const PERMIT_COUNTERPARTIES: Record<PermitKind, string> = {
  licencia_obra: 'Ayuntamiento',
  licencia_cala: 'Ayuntamiento (vía pública)',
  ocupacion_via_publica: 'Ayuntamiento (vía pública)',
  acometida_agua_provisional: 'Compañía de aguas',
  acometida_agua: 'Compañía de aguas',
  acometida_electrica_provisional: 'Distribuidora eléctrica',
  acometida_electrica: 'Distribuidora eléctrica',
  potencia_definitiva: 'Distribuidora + dirección facultativa',
  tasas_avales: 'Administración',
  licencia_primera_ocupacion: 'Dirección facultativa / Ayuntamiento',
  otro: '',
};

/**
 * Plazo de referencia en días naturales, tomado de la experiencia recogida en
 * el manual: la acometida de agua de seis a ocho meses, la eléctrica
 * definitiva hasta dos años, la licencia de cala de semanas a meses. Se toma
 * el extremo alto de cada horquilla: para avisar con tiempo, el pesimista es
 * el que acierta.
 */
export const REFERENCE_LEAD_DAYS: Record<PermitKind, number> = {
  licencia_obra: 120,
  licencia_cala: 90,
  ocupacion_via_publica: 45,
  acometida_agua_provisional: 45,
  acometida_agua: 240,
  acometida_electrica_provisional: 45,
  acometida_electrica: 730,
  potencia_definitiva: 180,
  tasas_avales: 15,
  licencia_primera_ocupacion: 90,
  otro: 60,
};

/** Trámites sin los cuales no deberían empezar los trabajos. */
export const BLOCKING_PERMIT_KINDS: PermitKind[] = [
  'licencia_obra',
  'ocupacion_via_publica',
  'acometida_agua_provisional',
  'acometida_electrica_provisional',
];

export const PERMIT_STATUSES = [
  'no_solicitado',
  'en_tramite',
  'concedido',
  'no_aplica',
] as const;

export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export const PERMIT_STATUS_LABELS: Record<PermitStatus, string> = {
  no_solicitado: 'No solicitado',
  en_tramite: 'En trámite',
  concedido: 'Concedido',
  no_aplica: 'No aplica',
};

export const PERMIT_LIGHTS = ['verde', 'ambar', 'rojo'] as const;
export type PermitLight = (typeof PERMIT_LIGHTS)[number];

/* ─────────────────────────── cálculo ─────────────────────────── */

export interface PermitState {
  kind: PermitKind;
  /** Fecha en que se presentó el expediente. */
  requestedAt: string | null;
  /** Fecha que comprometió el organismo. */
  committedAt: string | null;
  grantedAt: string | null;
  notApplicable: boolean;
}

export function permitStatus(permit: PermitState): PermitStatus {
  if (permit.notApplicable) return 'no_aplica';
  if (permit.grantedAt) return 'concedido';
  if (permit.requestedAt) return 'en_tramite';
  return 'no_solicitado';
}

/**
 * Días de retraso sobre la fecha comprometida. Cero si aún no ha vencido, si
 * no hay compromiso o si ya está concedido: un trámite resuelto deja de
 * acumular retraso aunque llegara tarde.
 */
export function permitDaysLate(permit: PermitState, today: string): number {
  if (permit.grantedAt || permit.notApplicable || !permit.committedAt) return 0;
  return Math.max(0, daysBetween(permit.committedAt, today));
}

/**
 * Fecha límite para presentar el expediente y que llegue a tiempo, dado el
 * plazo de referencia del trámite y la fecha en que hace falta.
 */
export function mustRequestBy(kind: PermitKind, neededBy: string): string {
  return addDays(neededBy, -REFERENCE_LEAD_DAYS[kind]);
}

/**
 * ¿Se empezó la obra sin este trámite resuelto?
 *
 * Solo aplica a los que bloquean el arranque. Un trámite concedido **después**
 * de la fecha de inicio no deja de ser un incumplimiento por haberse
 * concedido al final: durante ese tiempo hubo obra abierta sin él, y el
 * expediente lo va a reflejar. El semáforo, mirando solo el estado de hoy, lo
 * da por bueno y ya no vuelve a mencionarlo.
 */
export function startedWithoutPermit(
  permit: PermitState,
  startDate: string | null,
): boolean {
  if (!startDate || permit.notApplicable) return false;
  if (!BLOCKING_PERMIT_KINDS.includes(permit.kind)) return false;
  return permit.grantedAt === null || permit.grantedAt > startDate;
}

export interface PermitAssessment {
  status: PermitStatus;
  light: PermitLight;
  daysLate: number;
  /** Días que faltan para la fecha comprometida; negativo si ya pasó. */
  daysToCommitted: number | null;
  /** Último día para solicitarlo sin comprometer la fecha en que hace falta. */
  requestDeadline: string | null;
  /** Días de margen para solicitarlo; negativo si ya se ha pasado el punto. */
  requestSlackDays: number | null;
  reasons: string[];
}

/**
 * Semáforo de un trámite.
 *
 * `neededBy` es la fecha en la que el trámite tiene que estar resuelto —el
 * fin previsto de obra para los definitivos, el inicio para los que bloquean
 * el arranque—. Sin ella no se puede juzgar el riesgo de no haberlo pedido,
 * solo el retraso ya acumulado.
 */
export function assessPermit(
  permit: PermitState,
  today: string,
  neededBy: string | null,
): PermitAssessment {
  const status = permitStatus(permit);
  const daysLate = permitDaysLate(permit, today);
  const daysToCommitted =
    permit.committedAt && status === 'en_tramite'
      ? daysBetween(today, permit.committedAt)
      : null;

  const requestDeadline =
    neededBy && status === 'no_solicitado'
      ? mustRequestBy(permit.kind, neededBy)
      : null;
  const requestSlackDays = requestDeadline
    ? daysBetween(today, requestDeadline)
    : null;

  const reasons: string[] = [];
  let light: PermitLight = 'verde';

  if (status === 'concedido' || status === 'no_aplica') {
    return {
      status,
      light,
      daysLate: 0,
      daysToCommitted: null,
      requestDeadline: null,
      requestSlackDays: null,
      reasons,
    };
  }

  if (daysLate > 0) {
    light = 'rojo';
    reasons.push(
      `Lleva ${daysLate} días de retraso sobre la fecha comprometida.`,
    );
  } else if (daysToCommitted !== null && daysToCommitted <= 30) {
    light = 'ambar';
    reasons.push(`Vence en ${daysToCommitted} días.`);
  }

  if (requestSlackDays !== null) {
    if (requestSlackDays < 0) {
      light = 'rojo';
      reasons.push(
        `Sin solicitar y ya fuera de plazo: con ${REFERENCE_LEAD_DAYS[permit.kind]} días de tramitación habitual, debería haberse pedido hace ${-requestSlackDays} días.`,
      );
    } else if (requestSlackDays <= 30) {
      if (light !== 'rojo') light = 'ambar';
      reasons.push(
        `Sin solicitar: quedan ${requestSlackDays} días para pedirlo sin comprometer la fecha.`,
      );
    }
  }

  return {
    status,
    light,
    daysLate,
    daysToCommitted,
    requestDeadline,
    requestSlackDays,
    reasons,
  };
}

/* ────────────────────── esquemas y DTOs ────────────────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

const money = z
  .number({ invalid_type_error: 'Debe ser un número' })
  .nonnegative('No puede ser negativo')
  .max(999_999_999_999.99);

export const permitCreateSchema = z
  .object({
    projectId: z.string().uuid('La obra es obligatoria'),
    kind: z.enum(PERMIT_KINDS),
    counterparty: z.string().trim().max(200).nullish(),
    reference: z.string().trim().max(120).nullish(),
    requestedAt: isoDate.nullish(),
    committedAt: isoDate.nullish(),
    grantedAt: isoDate.nullish(),
    /** Fecha en la que hace falta resuelto; por defecto, el fin de obra. */
    neededBy: isoDate.nullish(),
    cost: money.nullish(),
    notApplicable: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine(
    (p) => !p.grantedAt || !p.requestedAt || p.grantedAt >= p.requestedAt,
    {
      message: 'No puede concederse antes de solicitarse',
      path: ['grantedAt'],
    },
  );

export const permitUpdateSchema = permitCreateSchema
  .innerType()
  .partial()
  .omit({ projectId: true });

export type PermitCreateInput = z.input<typeof permitCreateSchema>;
export type PermitUpdateInput = z.input<typeof permitUpdateSchema>;

export interface PermitDto {
  id: string;
  projectId: string;
  projectCode: string;
  kind: PermitKind;
  counterparty: string | null;
  reference: string | null;
  requestedAt: string | null;
  committedAt: string | null;
  grantedAt: string | null;
  neededBy: string | null;
  cost: number | null;
  notApplicable: boolean;
  blocking: boolean;
  notes: string | null;
  status: PermitStatus;
  light: PermitLight;
  daysLate: number;
  daysToCommitted: number | null;
  requestDeadline: string | null;
  requestSlackDays: number | null;
  reasons: string[];
  createdAt: string;
}

/** El semáforo de una obra, tal y como se lleva a la ficha mensual. */
export interface PermitBoardDto {
  projectId: string;
  projectCode: string;
  projectName: string;
  permits: PermitDto[];
  counts: Record<PermitLight, number>;
  /** Tasas y avales presupuestados: no son un extra imprevisto. */
  totalCost: number;
  /** Trámites bloqueantes sin conceder: no debería haberse empezado. */
  blockingPending: string[];
  warnings: string[];
}
