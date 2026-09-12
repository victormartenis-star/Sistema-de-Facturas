import { z } from 'zod';

export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
