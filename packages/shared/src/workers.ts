import { z } from 'zod';
import { daysBetween } from './calculo';
import { COMPLIANCE_WARNING_DAYS, complianceDocStatus } from './compliance';

/**
 * Control documental de los trabajadores de subcontrata.
 *
 * La homologación de la empresa no basta: hay que verificar **persona a
 * persona**. Es el riesgo con mayor asimetría de la empresa, porque el ahorro
 * de no comprobar es nulo y el coste de un accidente con un trabajador no
 * dado de alta es de otra magnitud, con responsabilidad solidaria del
 * contratista principal.
 *
 * Y el control tiene que llegar a la valla: la validación documental es de
 * Compras, pero quien decide quién entra es el encargado, y para eso necesita
 * un listado de autorizados en la mano.
 */

export const WORKER_DOC_TYPES = [
  'alta_ss',
  'formacion_prl',
  'aptitud_medica',
  'entrega_epi',
  'informacion_riesgos',
  'otro',
] as const;

export type WorkerDocType = (typeof WORKER_DOC_TYPES)[number];

export const WORKER_DOC_TYPE_LABELS: Record<WorkerDocType, string> = {
  alta_ss: 'Alta en Seguridad Social',
  formacion_prl: 'Formación en prevención (convenio de la construcción)',
  aptitud_medica: 'Aptitud médica',
  entrega_epi: 'Entrega de EPI',
  informacion_riesgos: 'Información de riesgos del puesto',
  otro: 'Otro documento',
};

/**
 * Los cinco del manual son todos exigibles antes del acceso. No hay aquí
 * documentos "informativos": si falta cualquiera de ellos, esa persona no
 * entra.
 */
export const REQUIRED_WORKER_DOCS: WorkerDocType[] = [
  'alta_ss',
  'formacion_prl',
  'aptitud_medica',
  'entrega_epi',
  'informacion_riesgos',
];

export const WORKER_STATUSES = [
  'autorizado',
  'con_avisos',
  'no_autorizado',
  'baja',
] as const;

export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export const WORKER_STATUS_LABELS: Record<WorkerStatus, string> = {
  autorizado: 'Autorizado',
  con_avisos: 'Autorizado con avisos',
  no_autorizado: 'No autorizado',
  baja: 'De baja',
};

/* ─────────────────────────── cálculo ─────────────────────────── */

export interface WorkerDocState {
  docType: WorkerDocType;
  expiresAt: string | null;
  rejected: boolean;
}

export interface WorkerState {
  isActive: boolean;
  docs: WorkerDocState[];
  /**
   * ¿Está homologada la empresa que le contrata? Un trabajador impecable de
   * una subcontrata bloqueada tampoco entra: la responsabilidad es solidaria
   * y el problema no es suyo, es de quien le paga.
   */
  companyBlocked: boolean;
}

export interface WorkerAssessment {
  status: WorkerStatus;
  /** true ⇒ puede pisar la obra. */
  allowed: boolean;
  /** Documentos exigibles que faltan o no valen. */
  missing: WorkerDocType[];
  /** Documentos que caducan dentro de la ventana de preaviso. */
  expiring: WorkerDocType[];
  reasons: string[];
}

/**
 * Estado de un trabajador en una fecha dada.
 *
 * Un documento caducado cuenta como ausente, no como aviso: el día que vence
 * la aptitud médica, esa persona deja de poder entrar. Los avisos son solo
 * para lo que va a vencer.
 */
export function assessWorker(
  worker: WorkerState,
  today: string,
): WorkerAssessment {
  if (!worker.isActive) {
    return {
      status: 'baja',
      allowed: false,
      missing: [],
      expiring: [],
      reasons: ['El trabajador está dado de baja.'],
    };
  }

  const byType = new Map(worker.docs.map((d) => [d.docType, d]));
  const missing: WorkerDocType[] = [];
  const expiring: WorkerDocType[] = [];

  for (const docType of REQUIRED_WORKER_DOCS) {
    const doc = byType.get(docType);
    if (!doc) {
      missing.push(docType);
      continue;
    }
    const status = complianceDocStatus(
      { rejected: doc.rejected, expiresAt: doc.expiresAt },
      today,
    );
    if (status === 'vencido' || status === 'rechazado') missing.push(docType);
    else if (status === 'proximo_vencimiento') expiring.push(docType);
  }

  const reasons: string[] = [];
  if (worker.companyBlocked) {
    reasons.push(
      'Su empresa no está homologada: no puede acceder aunque su documentación esté al día.',
    );
  }
  if (missing.length > 0) {
    reasons.push(
      `Falta o no es válido: ${missing.map((d) => WORKER_DOC_TYPE_LABELS[d]).join(', ')}.`,
    );
  }
  if (expiring.length > 0) {
    reasons.push(
      `Caduca en menos de ${COMPLIANCE_WARNING_DAYS} días: ${expiring
        .map((d) => WORKER_DOC_TYPE_LABELS[d])
        .join(', ')}.`,
    );
  }

  const allowed = !worker.companyBlocked && missing.length === 0;
  return {
    status: !allowed
      ? 'no_autorizado'
      : expiring.length > 0
        ? 'con_avisos'
        : 'autorizado',
    allowed,
    missing,
    expiring,
    reasons,
  };
}

/**
 * Fecha del documento exigible que caduca antes. Es lo que conviene mirar
 * para saber cuándo hay que volver a pedir papeles.
 */
export function nextExpiry(docs: WorkerDocState[]): string | null {
  const fechas = docs
    .filter((d) => REQUIRED_WORKER_DOCS.includes(d.docType) && d.expiresAt)
    .map((d) => d.expiresAt as string)
    .sort();
  return fechas[0] ?? null;
}

/** Días hasta la próxima caducidad; null si no hay ninguna con fecha. */
export function daysToNextExpiry(
  docs: WorkerDocState[],
  today: string,
): number | null {
  const next = nextExpiry(docs);
  return next === null ? null : daysBetween(today, next);
}

/* ────────────────────── esquemas y DTOs ────────────────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const workerCreateSchema = z.object({
  contactId: z.string().uuid('La subcontrata es obligatoria'),
  fullName: z.string().trim().min(1, 'El nombre es obligatorio').max(150),
  /** DNI/NIE. Se guarda para poder identificarlo en la valla. */
  docId: z.string().trim().max(30).nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const workerUpdateSchema = workerCreateSchema
  .partial()
  .omit({ contactId: true })
  .extend({ isActive: z.boolean().optional() });

export type WorkerCreateInput = z.input<typeof workerCreateSchema>;
export type WorkerUpdateInput = z.input<typeof workerUpdateSchema>;

export const workerDocSchema = z
  .object({
    docType: z.enum(WORKER_DOC_TYPES),
    issuedAt: isoDate.nullish(),
    expiresAt: isoDate.nullish(),
    documentId: z.string().uuid('Documento no válido').nullish(),
    rejected: z.boolean().default(false),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((d) => !d.issuedAt || !d.expiresAt || d.expiresAt >= d.issuedAt, {
    message: 'La caducidad no puede ser anterior a la emisión',
    path: ['expiresAt'],
  });

export type WorkerDocInput = z.input<typeof workerDocSchema>;

/** Alta o baja de un trabajador en una obra. */
export const workerAssignmentSchema = z.object({
  projectId: z.string().uuid('Obra no válida'),
  assigned: z.boolean(),
});

export type WorkerAssignmentInput = z.input<typeof workerAssignmentSchema>;

export interface WorkerDocDto {
  id: string;
  docType: WorkerDocType;
  issuedAt: string | null;
  expiresAt: string | null;
  documentId: string | null;
  rejected: boolean;
  notes: string | null;
  status: 'vigente' | 'proximo_vencimiento' | 'vencido' | 'rechazado';
  daysToExpiry: number | null;
}

export interface WorkerDto {
  id: string;
  contactId: string;
  contactName: string;
  fullName: string;
  docId: string | null;
  jobTitle: string | null;
  isActive: boolean;
  notes: string | null;
  docs: WorkerDocDto[];
  /** Obras en las que está dado de alta. */
  projects: { id: string; code: string }[];
  status: WorkerStatus;
  allowed: boolean;
  missing: WorkerDocType[];
  expiring: WorkerDocType[];
  reasons: string[];
  daysToNextExpiry: number | null;
  createdAt: string;
}

/**
 * Listado semanal de trabajadores autorizados de una obra.
 *
 * Es el papel que el encargado tiene en la mano en la valla, así que se
 * imprime entero: los autorizados **y** los que no lo están. Un listado que
 * solo trae a los buenos no sirve para negar el acceso a nadie, porque quien
 * falta puede ser tanto un vetado como alguien a quien nadie dio de alta.
 */
export interface GateListDto {
  projectId: string;
  projectCode: string;
  projectName: string;
  generatedAt: string;
  allowed: WorkerDto[];
  denied: WorkerDto[];
  /** Subcontratas con alguien en la obra y la empresa bloqueada. */
  blockedCompanies: string[];
  warnings: string[];
}
