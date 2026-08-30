import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, lte, SQL } from 'drizzle-orm';
import { NewAuditEntry, auditLog } from '@erp/db';
import type { AuditEntryDto, AuditQuery } from '@erp/shared';
import { DbService } from '../db/db.service';

/**
 * Campos que nunca deben acabar en el registro.
 *
 * La lista es de nombres, no de rutas: si mañana aparece un `password` en
 * otro sitio, queda cubierto sin acordarse de nada. Se comprueba en
 * minúsculas y por coincidencia parcial, para que `passwordHash` o
 * `newPassword` caigan igual.
 */
const CAMPOS_OCULTOS = ['password', 'token', 'secret', 'passwordhash'];

/**
 * Tamaño máximo del cuerpo guardado. La tabla es inmutable, así que un cuerpo
 * enorme —el texto de un documento, una lista larga— se queda ahí para
 * siempre: mejor recortarlo y decir que se ha recortado.
 */
const MAX_PAYLOAD_CHARS = 4000;

/** Deja el cuerpo listo para guardar: sin secretos y sin ocupar de más. */
export function preparePayload(body: unknown): object | null {
  const redacted = redactPayload(body);
  if (redacted === null || typeof redacted !== 'object') return null;

  const serialized = JSON.stringify(redacted);
  if (serialized.length <= MAX_PAYLOAD_CHARS) return redacted as object;
  return {
    '«recortado»': `El cuerpo ocupaba ${serialized.length} caracteres y se ha omitido`,
    claves: Object.keys(redacted as object),
  };
}

export function redactPayload(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(redactPayload);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const oculto = CAMPOS_OCULTOS.some((c) => key.toLowerCase().includes(c));
    out[key] = oculto ? '«oculto»' : redactPayload(value);
  }
  return out;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly dbs: DbService) {}

  /**
   * Guarda una entrada. Nunca propaga el error: si la auditoría falla, se
   * registra en el log del servidor pero no se tumba la operación del
   * usuario, que ya se ha completado.
   */
  async record(entry: NewAuditEntry): Promise<void> {
    try {
      await this.dbs.db.insert(auditLog).values(entry);
    } catch (err) {
      this.logger.error(
        `No se pudo registrar la auditoría de ${entry.action}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async list(query: AuditQuery): Promise<AuditEntryDto[]> {
    const filters: SQL[] = [];
    if (query.entity) filters.push(eq(auditLog.entity, query.entity));
    if (query.entityId) filters.push(eq(auditLog.entityId, query.entityId));
    if (query.userId) filters.push(eq(auditLog.userId, query.userId));
    if (query.from) filters.push(gte(auditLog.createdAt, new Date(query.from)));
    if (query.to) {
      // Fin del día indicado, no el instante cero
      filters.push(lte(auditLog.createdAt, new Date(`${query.to}T23:59:59Z`)));
    }

    const rows = await this.dbs.db
      .select()
      .from(auditLog)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(query.limit ?? 200, 500));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      userEmail: r.userEmail,
      userRole: r.userRole,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      payload: r.payload as Record<string, unknown> | null,
      statusCode: r.statusCode,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
