import { jsonCanonico } from './json-canonico';

/**
 * Cadena hash de `audit_log` (Fase 2 enterprise). Este módulo es puro y
 * no depende de Node: solo construye la preimagen canónica. El SHA-256 se
 * calcula en `apps/api` con `node:crypto` (una única implementación del
 * canónico: replicarlo en plpgsql divergería en la serialización de números).
 */

/** `previous_hash` de la primera entrada de cada empresa. */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

/** Versión del algoritmo de hash. Permite evolucionarlo sin invalidar lo sellado. */
export const AUDIT_HASH_VERSION = 1;

export const AUDIT_HASH_REGEX = /^[0-9a-f]{64}$/;

/** Los cuatro campos de datos que entran en el hash, siempre presentes. */
export interface AuditPayloadCanonico {
  correlationId: string | null;
  meta: unknown;
  newData: unknown;
  oldData: unknown;
}

export interface AuditEntradaCadena {
  companyId: string;
  sequenceNumber: number;
  previousHash: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldData?: unknown;
  newData?: unknown;
  meta?: unknown;
  correlationId?: string | null;
  occurredAt: Date | string;
}

function contieneNul(valor: unknown): boolean {
  if (typeof valor === 'string') return valor.includes('\u0000');
  if (Array.isArray(valor)) return valor.some(contieneNul);
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>).some(
      ([k, v]) => k.includes('\u0000') || contieneNul(v),
    );
  }
  return false;
}

/**
 * Normaliza un dato de auditoría al valor JSON que realmente almacenará
 * `jsonb` (y que devolverá el driver al verificar): `JSON.parse(JSON.stringify)`.
 * `undefined` -> `null`. Rechaza `\u0000` (jsonb no lo admite).
 */
export function normalizarDatoAuditoria(valor: unknown): unknown {
  if (valor === undefined || valor === null) return null;
  const texto = JSON.stringify(valor);
  if (texto === undefined) return null;
  const normalizado: unknown = JSON.parse(texto);
  if (contieneNul(normalizado)) {
    throw new Error('El dato de auditoría contiene el carácter \u0000');
  }
  return normalizado;
}

export function normalizarPayloadAuditoria(p: {
  oldData?: unknown;
  newData?: unknown;
  meta?: unknown;
  correlationId?: string | null;
}): AuditPayloadCanonico {
  return {
    correlationId: p.correlationId ?? null,
    meta: normalizarDatoAuditoria(p.meta),
    newData: normalizarDatoAuditoria(p.newData),
    oldData: normalizarDatoAuditoria(p.oldData),
  };
}

export function isoAuditoria(occurredAt: Date | string): string {
  const fecha = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('occurredAt no es una fecha válida');
  }
  return fecha.toISOString();
}

/**
 * Preimagen canónica versión 1: array JSON de 10 posiciones en orden fijo
 * `[1, companyId, seq, previousHash, actorId, action, entityType, entityId,
 * payload, occurredAt]`, serializado con `jsonCanonico`.
 */
export function preimagenAuditoria(e: AuditEntradaCadena): string {
  return jsonCanonico([
    AUDIT_HASH_VERSION,
    e.companyId,
    e.sequenceNumber,
    e.previousHash,
    e.actorId ?? null,
    e.action,
    e.entityType,
    e.entityId,
    normalizarPayloadAuditoria(e),
    isoAuditoria(e.occurredAt),
  ]);
}
