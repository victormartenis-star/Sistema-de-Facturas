/**
 * Error de la API y utilidades de control de versión (If-Match / 409).
 *
 * Vive aparte de `api.ts` para poder probarlo sin `fetch` ni `localStorage`.
 */

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
  ) {
    super(message);
  }
}

export const MENSAJE_CONFLICTO_VERSION =
  'Los datos han sido modificados por otro usuario. Recarga para ver la última versión.';

/** Construye el `ApiError` a partir del estado y el cuerpo ya parseado (o nulo). */
export function errorDeRespuesta(
  status: number,
  body: unknown,
  porDefecto = `Error ${status}`,
): ApiError {
  let message = porDefecto;
  const conflicto =
    status === 409 &&
    !!body &&
    typeof body === 'object' &&
    (body as Record<string, unknown>).code === 'VERSION_CONFLICT';
  if (conflicto) message = MENSAJE_CONFLICTO_VERSION;
  let fieldErrors: FieldError[] = [];
  let code: string | undefined;
  let versionActual: number | undefined;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.message)) message = b.message.join(', ');
    else if (typeof b.message === 'string') message = b.message;
    if (Array.isArray(b.errors)) fieldErrors = b.errors as FieldError[];
    if (typeof b.code === 'string') code = b.code;
    if (typeof b.versionActual === 'number') versionActual = b.versionActual;
  }
  return new ApiError(message, status, fieldErrors, code, versionActual);
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
