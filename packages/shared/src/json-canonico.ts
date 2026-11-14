/**
 * JSON canónico: serialización determinista con las claves de los objetos
 * ordenadas recursivamente (los arrays conservan su orden, que es
 * significativo). Dos objetos equivalentes con las claves en otro orden dan
 * la misma cadena; sirve para hashear cuerpos de petición (idempotencia).
 * Semántica de `JSON.stringify`: `undefined` en objetos se omite; en la raíz
 * o dentro de arrays se serializa como `null`.
 */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor)) ?? 'null';
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor !== null && typeof valor === 'object') {
    const v = valor as { toJSON?: () => unknown };
    if (typeof v.toJSON === 'function') return ordenar(v.toJSON());
    const origen = valor as Record<string, unknown>;
    const salida: Record<string, unknown> = {};
    for (const clave of Object.keys(origen).sort()) {
      salida[clave] = ordenar(origen[clave]);
    }
    return salida;
  }
  return valor;
}
