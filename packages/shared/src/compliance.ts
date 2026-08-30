import { z } from 'zod';
import { daysBetween } from './calculo';

/**
 * Homologación de subcontratas y cumplimiento de PRL.
 *
 * En construcción el contratista principal responde solidariamente de las
 * deudas con la Seguridad Social de sus subcontratas (art. 42 ET y LSS), y
 * debe exigir la documentación preventiva antes de que pisen la obra. Por eso
 * el sistema bloquea aprobar facturas y pagar a quien no esté al día.
 */

export const COMPLIANCE_DOC_TYPES = [
  'plan_seguridad',
  'seguro_rc',
  'certificado_ss',
  'certificado_aeat',
  'rea',
  'itinerario_formativo',
  'reconocimiento_medico',
  'epi',
  'otro',
] as const;

export type ComplianceDocType = (typeof COMPLIANCE_DOC_TYPES)[number];

export const COMPLIANCE_DOC_TYPE_LABELS: Record<ComplianceDocType, string> = {
  plan_seguridad: 'Plan de seguridad y salud / adhesión',
  seguro_rc: 'Seguro de responsabilidad civil',
  certificado_ss: 'Certificado corriente de pago (Seguridad Social)',
  certificado_aeat: 'Certificado corriente de pago (AEAT)',
  rea: 'Registro de Empresas Acreditadas (REA)',
  itinerario_formativo: 'Formación PRL de los trabajadores',
  reconocimiento_medico: 'Reconocimiento médico',
  epi: 'Entrega de EPIs',
  otro: 'Otro documento',
};

/**
 * Tipos cuya ausencia o caducidad bloquea la operativa. El resto son
 * informativos: se controlan y avisan, pero no impiden pagar.
 */
export const BLOCKING_COMPLIANCE_DOC_TYPES: ComplianceDocType[] = [
  'plan_seguridad',
  'seguro_rc',
  'certificado_ss',
  'rea',
];

/** Días antes del vencimiento en los que se avisa sin bloquear todavía. */
export const COMPLIANCE_WARNING_DAYS = 30;

export const COMPLIANCE_DOC_STATUSES = [
  'vigente',
  'proximo_vencimiento',
  'vencido',
  'no_aportado',
  'rechazado',
] as const;

export type ComplianceDocStatus = (typeof COMPLIANCE_DOC_STATUSES)[number];

export const COMPLIANCE_DOC_STATUS_LABELS: Record<ComplianceDocStatus, string> =
  {
    vigente: 'Vigente',
    proximo_vencimiento: 'Vence pronto',
    vencido: 'Vencido',
    no_aportado: 'No aportado',
    rechazado: 'Rechazado',
  };

/** Estado global de un contacto de cara a poder operar con él. */
export const COMPLIANCE_STATUSES = [
  'no_aplica',
  'homologado',
  'con_avisos',
  'bloqueado',
  'bloqueado_manual',
  'exento',
] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  no_aplica: 'No sujeto a homologación',
  homologado: 'Homologado',
  con_avisos: 'Homologado con avisos',
  bloqueado: 'Bloqueado por documentación',
  bloqueado_manual: 'Bloqueado manualmente',
  exento: 'Operando con exención',
};

/**
 * Estado de un documento de homologación en una fecha dada.
 *
 * La fecha de referencia se pasa como parámetro en lugar de leer el reloj:
 * así el estado es reproducible y comprobable, y no cambia según el momento
 * en que se ejecute el cálculo.
 */
export function complianceDocStatus(
  doc: { rejected: boolean; expiresAt: string | null },
  today: string,
): ComplianceDocStatus {
  if (doc.rejected) return 'rechazado';
  // Sin fecha de caducidad el documento se considera permanente
  if (!doc.expiresAt) return 'vigente';
  const days = daysBetween(today, doc.expiresAt);
  if (days < 0) return 'vencido';
  if (days <= COMPLIANCE_WARNING_DAYS) return 'proximo_vencimiento';
  return 'vigente';
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const complianceDocCreateSchema = z
  .object({
    docType: z.enum(COMPLIANCE_DOC_TYPES),
    documentId: z.string().uuid('Documento no válido').nullish(),
    issuedAt: isoDate.nullish(),
    expiresAt: isoDate.nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((d) => !d.issuedAt || !d.expiresAt || d.expiresAt >= d.issuedAt, {
    message: 'La fecha de caducidad no puede ser anterior a la de emisión',
    path: ['expiresAt'],
  });

export const complianceDocUpdateSchema = complianceDocCreateSchema
  .innerType()
  .partial()
  .extend({ rejected: z.boolean().optional() });

export type ComplianceDocCreateInput = z.input<
  typeof complianceDocCreateSchema
>;
export type ComplianceDocUpdateInput = z.input<
  typeof complianceDocUpdateSchema
>;

export const complianceBlockSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'El motivo del bloqueo es obligatorio')
    .max(500),
});

export type ComplianceBlockInput = z.input<typeof complianceBlockSchema>;

export const complianceWaiverSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'La justificación es obligatoria')
    .max(500, 'Máximo 500 caracteres'),
  validUntil: isoDate,
});

export type ComplianceWaiverInput = z.input<typeof complianceWaiverSchema>;

export interface ComplianceDocDto {
  id: string;
  contactId: string;
  docType: ComplianceDocType;
  documentId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  status: ComplianceDocStatus;
  /** Días que faltan para caducar; negativo si ya venció. */
  daysToExpiry: number | null;
  blocking: boolean;
  notes: string | null;
  createdAt: string;
}

export interface ComplianceWaiverDto {
  id: string;
  contactId: string;
  reason: string;
  validUntil: string;
  active: boolean;
  createdAt: string;
}

/** Ficha de homologación de un contacto. */
export interface ComplianceSummaryDto {
  contactId: string;
  legalName: string;
  taxId: string | null;
  requiresCompliance: boolean;
  status: ComplianceStatus;
  /** true ⇒ no se pueden aprobar facturas ni pagar. */
  blocked: boolean;
  /** Motivos legibles del bloqueo o de los avisos. */
  reasons: string[];
  docs: ComplianceDocDto[];
  waiver: ComplianceWaiverDto | null;
}
