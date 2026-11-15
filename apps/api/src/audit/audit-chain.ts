import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { auditChainHeads, auditLog } from '@erp/db';
import type { AuditLogEntry, Tx } from '@erp/db';
import {
  AUDIT_GENESIS_HASH,
  AUDIT_HASH_VERSION,
  preimagenAuditoria,
} from '@erp/shared';
import type { AuditEntradaCadena } from '@erp/shared';

const LOTE_SELLADO = 1000;

/** SHA-256 hex (minúsculas) de la preimagen canónica de una entrada. */
export function calcularHashAuditoria(entrada: AuditEntradaCadena): string {
  return createHash('sha256')
    .update(preimagenAuditoria(entrada), 'utf8')
    .digest('hex');
}

/** Entrada de la cadena a partir de una fila tal como está guardada. */
export function entradaDeFila(
  fila: AuditLogEntry,
  previousHash: string,
): AuditEntradaCadena {
  return {
    companyId: fila.companyId,
    sequenceNumber: fila.sequenceNumber,
    previousHash,
    actorId: fila.userId ?? null,
    action: fila.action,
    entityType: fila.entityType,
    entityId: fila.entityId,
    oldData: fila.oldData,
    newData: fila.newData,
    meta: fila.meta,
    correlationId: fila.correlationId ?? null,
    occurredAt: fila.occurredAt,
  };
}

/**
 * Sella las filas históricas (sin hash) de una empresa. Idempotente y
 * reanudable: bloquea la cabecera (`FOR UPDATE`), parte de la última fila ya
 * sellada y recorre las pendientes en orden de `sequence_number`, un UPDATE
 * por fila (el trigger de inmutabilidad solo permite ese UPDATE si el hash
 * enlaza con la fila anterior). Al sellar la última fila, el propio trigger
 * deja la cabecera lista. Devuelve cuántas filas selló.
 */
export async function sellarLegado(tx: Tx, companyId: string): Promise<number> {
  const [cabecera] = await tx
    .select()
    .from(auditChainHeads)
    .where(eq(auditChainHeads.companyId, companyId))
    .for('update');
  if (!cabecera || cabecera.lastEntryHash !== null) return 0;

  const [ultimaSellada] = await tx
    .select({
      sequenceNumber: auditLog.sequenceNumber,
      entryHash: auditLog.entryHash,
    })
    .from(auditLog)
    .where(
      and(eq(auditLog.companyId, companyId), isNotNull(auditLog.entryHash)),
    )
    .orderBy(desc(auditLog.sequenceNumber))
    .limit(1);

  let hashPrevio = ultimaSellada?.entryHash ?? AUDIT_GENESIS_HASH;
  let ultimo = ultimaSellada?.sequenceNumber ?? 0;
  let sellados = 0;

  for (;;) {
    const lote = await tx
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, companyId),
          isNull(auditLog.entryHash),
          gt(auditLog.sequenceNumber, ultimo),
        ),
      )
      .orderBy(asc(auditLog.sequenceNumber))
      .limit(LOTE_SELLADO);
    if (lote.length === 0) break;
    for (const fila of lote) {
      const entryHash = calcularHashAuditoria(entradaDeFila(fila, hashPrevio));
      // La clave de partición (`occurred_at`) no se usa en el WHERE: el valor
      // histórico tiene microsegundos que el driver trunca a milisegundos.
      await tx
        .update(auditLog)
        .set({
          previousHash: hashPrevio,
          entryHash,
          hashVersion: AUDIT_HASH_VERSION,
        })
        .where(
          and(eq(auditLog.id, fila.id), eq(auditLog.companyId, companyId)),
        );
      hashPrevio = entryHash;
      ultimo = fila.sequenceNumber;
      sellados++;
    }
  }
  return sellados;
}

/** Empresas con filas históricas pendientes de sellar. */
export async function empresasPendientesDeSellar(tx: {
  select: Tx['select'];
}): Promise<string[]> {
  const filas = await tx
    .select({ companyId: auditChainHeads.companyId })
    .from(auditChainHeads)
    .where(sql`${auditChainHeads.lastEntryHash} IS NULL`);
  return filas.map((f) => f.companyId);
}
