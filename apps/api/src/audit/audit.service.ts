import { Injectable } from '@nestjs/common';
import { and, desc, eq, SQL } from 'drizzle-orm';
import { AuditLogEntry, auditLog } from '@erp/db';
import {
  AuditAction,
  AuditEntityType,
  AuditLogDto,
  AuditQuery,
  auditQuerySchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';

function toDto(row: AuditLogEntry): AuditLogDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    userId: row.userId ?? null,
    companyId: row.companyId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action as AuditAction,
    oldData: row.oldData ?? null,
    newData: row.newData ?? null,
    meta: row.meta ?? null,
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  /**
   * Registra un evento de auditoría. Diseñado para llamarse desde otros servicios.
   * No lanza errores: falla silenciosamente para no interrumpir el flujo principal.
   */
  async log(params: {
    entityType: AuditEntityType | string;
    entityId: string;
    action: AuditAction;
    oldData?: unknown;
    newData?: unknown;
    meta?: unknown;
  }): Promise<void> {
    try {
      const ctx = this.dbs.getContext();
      await this.db.insert(auditLog).values({
        userId: ctx.userId,
        companyId: ctx.companyId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        oldData: (params.oldData as Record<string, unknown>) ?? null,
        newData: (params.newData as Record<string, unknown>) ?? null,
        meta: (params.meta as Record<string, unknown>) ?? null,
      });
    } catch {
      // Auditoría no debe interrumpir el flujo principal
    }
  }

  async list(rawQuery: AuditQuery): Promise<AuditLogDto[]> {
    const q = auditQuerySchema.parse(rawQuery);
    const companyId = this.dbs.getCompanyId();
    const filters: SQL[] = [eq(auditLog.companyId, companyId)];

    if (q.entityType) filters.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) filters.push(eq(auditLog.entityId, q.entityId));
    if (q.userId) filters.push(eq(auditLog.userId, q.userId));
    if (q.action) filters.push(eq(auditLog.action, q.action));

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(...filters))
      .orderBy(desc(auditLog.occurredAt))
      .limit(q.limit)
      .offset(q.offset);

    return rows.map(toDto);
  }
}
