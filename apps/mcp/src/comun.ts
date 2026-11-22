import { ErrorApi, errorDeDominio, type ErrorDeDominio } from './api';

/**
 * Resultado de herramienta: el objeto serializado como texto (para modelos
 * que solo leen `content`) y, además, en `structuredContent` para que el
 * agente lea campos sin parsear JSON. La especificación MCP exige que
 * `structuredContent` sea un objeto: las listas van en `{ items }` y los
 * escalares en `{ resultado }`.
 */
export function ok(datos: unknown) {
  const estructurado =
    datos === undefined || datos === null
      ? undefined
      : Array.isArray(datos)
        ? { items: datos }
        : typeof datos === 'object'
          ? (datos as Record<string, unknown>)
          : { resultado: datos };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(datos, null, 2) }],
    ...(estructurado ? { structuredContent: estructurado } : {}),
  };
}

/**
 * Resultado de error. isError deja que el modelo reaccione en vez de cortar.
 * `datos` (si lo hay) va en `structuredContent`: el agente ramifica por
 * `errorCode` sin parsear el texto.
 */
export function fallo(mensaje: string, datos?: ErrorDeDominio) {
  return {
    content: [{ type: 'text' as const, text: mensaje }],
    isError: true,
    ...(datos ? { structuredContent: { ...datos } } : {}),
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
      const datos = errorDeDominio(e);
      const codigo = datos.errorCode
        ? `
código: ${datos.errorCode}`
        : '';
      return fallo(
        (e.estado ? `[${e.estado}] ${e.message}` : e.message) + codigo,
        datos,
      );
    }
    return fallo(`Error inesperado: ${String(e)}`);
  }
}
