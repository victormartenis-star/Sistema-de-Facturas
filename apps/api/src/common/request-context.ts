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

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
