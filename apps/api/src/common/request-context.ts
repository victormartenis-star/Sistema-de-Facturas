import { AsyncLocalStorage } from 'node:async_hooks';
import { UserRole } from '@erp/shared';

/**
 * Identidad de la petición HTTP en curso (rellenada por
 * `RequestContextInterceptor` a partir del JWT verificado por
 * `JwtAuthGuard`). Se propaga automáticamente a través de `await`/promesas
 * gracias a `AsyncLocalStorage`, sin tener que pasar `companyId` a mano por
 * cada capa de servicio.
 */
export interface RequestContext {
  userId: string;
  companyId: string;
  role: UserRole;
}

/**
 * Contenido del almacén: el `correlationId` lo abre el middleware de
 * request-id (antes de los guards); la identidad la rellena el interceptor
 * cuando el usuario ya está autenticado.
 */
export interface CorrelationStore {
  correlationId: string;
  identidad?: RequestContext;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/** Abre un contexto de correlación (middleware HTTP, cron, worker). */
export function runWithCorrelation<T>(
  correlationId: string,
  fn: () => T,
  identidad?: RequestContext,
): T {
  return storage.run({ correlationId, identidad }, fn);
}

/**
 * Publica la identidad. Si ya hay un contexto de correlación abierto, se
 * rellena en él (misma petición); si no, se abre uno nuevo sin correlación.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  const store = storage.getStore();
  if (store) {
    store.identidad = context;
    return fn();
  }
  return storage.run({ correlationId: '', identidad: context }, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()?.identidad;
}

/** `correlationId` de la petición en curso, o `null` fuera de un contexto. */
export function getCorrelationId(): string | null {
  const id = storage.getStore()?.correlationId;
  return id ? id : null;
}
