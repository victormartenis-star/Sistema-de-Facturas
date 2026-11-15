/**
 * Error de la API y utilidades de control de versión (If-Match / 409).
 *
 * Vive aparte de `api.ts` para poder probarlo sin `fetch` ni `localStorage`.
 */

import { MENSAJE_CONFLICTO_VERSION } from '@erp/shared';

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors: FieldError[] = [],
    /** Código funcional del cuerpo (p. ej. `VERSION_CONFLICT`). */
    public readonly code?: string,
    /** Versión vigente en servidor cuando hay `VERSION_CONFLICT`. */
    public readonly versionActual?: number,
    /** Id de correlación (cabecera X-Request-Id) para citarlo a soporte. */
    public readonly correlationId?: string,
  ) {
    super(message);
  }
}

export { MENSAJE_CONFLICTO_VERSION };

/** UUIDv4 (identificador de petición o clave de idempotencia). */
export function nuevoUuid(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  // Respaldo para contextos sin `crypto.randomUUID` (HTTP sin TLS, tests antiguos).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Cabecera `Idempotency-Key`: se genera UNA vez por intento de envío y se
 * reutiliza en los reintentos de ese mismo intento. Sin clave no se envía nada.
 */
export function idempotencyKey(clave?: string | null): Record<string, string> {
  return clave ? { 'Idempotency-Key': clave } : {};
}

/** 428 `PRECONDITION_REQUIRED`: la mutación exigía `If-Match` y no se envió. */
export function esPrecondicionRequerida(e: unknown): e is ApiError {
  return (
    e instanceof ApiError &&
    e.status === 428 &&
    (e.code === undefined || e.code === 'PRECONDITION_REQUIRED')
  );
}

/** Texto para soporte: `ref: <correlationId>` o cadena vacía. */
export function refSoporte(e: unknown): string {
  return e instanceof ApiError && e.correlationId
    ? `ref: ${e.correlationId}`
    : '';
}

/**
 * Construye el `ApiError` a partir del estado y el cuerpo ya parseado (o nulo).
 * `requestId` es la cabecera `X-Request-Id` de la respuesta: se usa como
 * `correlationId` cuando el cuerpo no lo trae.
 */
export function errorDeRespuesta(
  status: number,
  body: unknown,
  porDefecto = `Error ${status}`,
  requestId?: string | null,
): ApiError {
  let message = porDefecto;
  const conflicto =
    status === 409 &&
    !!body &&
    typeof body === 'object' &&
    ((body as Record<string, unknown>).errorCode === 'VERSION_CONFLICT' ||
      (body as Record<string, unknown>).code === 'VERSION_CONFLICT');
  if (conflicto) message = MENSAJE_CONFLICTO_VERSION;
  let fieldErrors: FieldError[] = [];
  let code: string | undefined;
  let versionActual: number | undefined;
  let correlationId: string | undefined = requestId || undefined;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === 'string') message = b.detail;
    else if (Array.isArray(b.message)) message = b.message.join(', ');
    else if (typeof b.message === 'string') message = b.message;
    if (Array.isArray(b.errors)) fieldErrors = b.errors as FieldError[];
    if (typeof b.errorCode === 'string') code = b.errorCode;
    else if (typeof b.code === 'string') code = b.code;
    if (typeof b.correlationId === 'string') correlationId = b.correlationId;
    if (typeof b.versionActual === 'number') versionActual = b.versionActual;
  }
  return new ApiError(
    message,
    status,
    fieldErrors,
    code,
    versionActual,
    correlationId,
  );
}

/** Solo el 409 con código `VERSION_CONFLICT`; los 409 de estado no cuentan. */
export function esConflictoVersion(e: unknown): e is ApiError {
  return (
    e instanceof ApiError && e.status === 409 && e.code === 'VERSION_CONFLICT'
  );
}

/** Cabecera `If-Match: "<version>"`; sin versión no se envía nada (no se inventa). */
export function ifMatch(version?: number | null): Record<string, string> {
  return version === undefined || version === null
    ? {}
    : { 'If-Match': `"${version}"` };
}
