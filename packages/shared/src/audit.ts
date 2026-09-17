import { z } from 'zod';

export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Todo `entityType` que algún `AuditService.log()` escribe realmente — ver
 * `entityType: AuditEntityType | string` en `audit.service.ts`: el lado que
 * escribe no está atado a esta lista (nunca bloquea un `log()` por un tipo
 * nuevo), pero `auditQuerySchema.entityType` sí, así que un tipo que falte
 * aquí queda escrito en `audit_log` y es imposible de filtrar desde
 * `GET /audit`. Mantener sincronizado con `grep -rhn "entityType: '"
 * apps/api/src` al añadir un `audit.log()` nuevo.
 */
export const AUDIT_ENTITY_TYPES = [
  'project',
  'budget',
  'certification',
  'certification_line',
  'invoice',
  'purchase_order',
  'delivery_note',
  'contact',
  'document',
  'payment_milestone',
  'user',
  'alert_rule',
  'bank_account',
  'bim_element_link',
  'bim_model',
  'change_order',
  'comparativo',
  'comparativo_oferta',
  'contract_audit',
  'equipo',
  'esg_factor_emision',
  'esg_registro_emision',
  'fichaje',
  'investment_account',
  'investment_cashflow',
  'investment_participation',
  'investor',
  'iot_alerta',
  'iot_lectura_telemetria',
  'mantenimiento_equipo',
  'parte_maquinaria',
  'parte_personal',
  'postventa_incident',
  'prl_checklist',
  'rcd_vale',
  'real_estate_key_handover',
  'real_estate_reservation',
  'real_estate_unit',
  'signature_request',
  'signature_signer',
  'trabajador',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const auditQuerySchema = z.object({
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;

export interface AuditLogDto {
  id: string;
  occurredAt: string;
  userId: string | null;
  companyId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldData: unknown;
  newData: unknown;
  meta: unknown;
}
