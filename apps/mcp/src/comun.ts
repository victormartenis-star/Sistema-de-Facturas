import { ErrorApi } from './api';

/** Resultado de herramienta con el objeto serializado como texto. */
export function ok(datos: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(datos, null, 2) }],
  };
}

/** Resultado de error. isError deja que el modelo reaccione en vez de cortar. */
export function fallo(mensaje: string) {
  return {
    content: [{ type: 'text' as const, text: mensaje }],
    isError: true,
  };
}

/**
 * Envuelve el cuerpo de una herramienta y traduce los errores de la API.
 *
 * Los 4xx del ERP llevan informacion util (por ejemplo el 422 de un albaran sin
 * pedido, o el bloqueo por incumplimiento de PRL), asi que se devuelven tal
 * cual en vez de aplastarlos en un "error interno".
 */
export async function ejecutar<T>(fn: () => Promise<T>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof ErrorApi) {
      return fallo(e.estado ? `[${e.estado}] ${e.message}` : e.message);
    }
    return fallo(`Error inesperado: ${String(e)}`);
  }
}
