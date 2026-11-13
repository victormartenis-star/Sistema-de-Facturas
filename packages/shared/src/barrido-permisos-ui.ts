/**
 * Análisis estático (puro, sin leer ficheros) para el test de barrido de
 * permisos de UI: detecta pantallas que llaman a una mutación de la API sin
 * ningún control de permisos (`<Autorizado>` o `can(`/`puede(`) en el mismo
 * fichero. Es cosmético y deliberadamente conservador: la autoridad sigue
 * siendo `ReadOnlyGuard` en la API. El test que lo usa lee los ficheros.
 *
 * Limitación conocida: el control es a nivel de FICHERO, no de botón. Un
 * fichero con un `<Autorizado>` en un sitio y un botón de mutación sin
 * proteger en otro pasa el barrido; por eso las páginas se revisan además
 * a mano al tocarlas.
 */

const VERBOS_ESCRITURA = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/;
const CUERPO_FORMDATA = /body:\s*form\b/;

/**
 * Extrae del código de `api.ts` los métodos `xxxApi.metodo` que escriben
 * (POST/PUT/PATCH/DELETE o subida con FormData).
 */
export function extraerMutacionesApi(apiSource: string): string[] {
  const resultado: string[] = [];
  let objeto: string | null = null;
  let metodo: string | null = null;
  let cuerpo: string[] = [];

  const cerrar = () => {
    if (objeto && metodo) {
      const texto = cuerpo.join('\n');
      if (VERBOS_ESCRITURA.test(texto) || CUERPO_FORMDATA.test(texto)) {
        resultado.push(`${objeto}.${metodo}`);
      }
    }
    metodo = null;
    cuerpo = [];
  };

  for (const linea of apiSource.split('\n')) {
    const abre = /^export const (\w+Api) = \{/.exec(linea);
    if (abre) {
      cerrar();
      objeto = abre[1]!;
      continue;
    }
    if (objeto && /^\};?\s*$/.test(linea)) {
      cerrar();
      objeto = null;
      continue;
    }
    if (!objeto) continue;
    const m = /^ {2}(\w+)\s*[:(]/.exec(linea);
    if (m) {
      cerrar();
      metodo = m[1]!;
    }
    if (metodo) cuerpo.push(linea);
  }
  cerrar();
  return resultado;
}

/** ¿El fichero contiene algún control de permisos de UI? */
export function tieneControlDePermisos(source: string): boolean {
  return /<Autorizado\b/.test(source) || /\b(can|puede)\(/.test(source);
}

/**
 * Mutaciones llamadas en `source` (como `xxxApi.metodo(` o con un
 * `fetch`/`method:` de escritura directo), ignorando comentarios.
 */
export function mutacionesLlamadas(
  source: string,
  mutacionesApi: readonly string[],
): string[] {
  const sinComentarios = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const halladas = mutacionesApi.filter((m) =>
    sinComentarios.includes(`${m}(`),
  );
  if (VERBOS_ESCRITURA.test(sinComentarios)) {
    halladas.push('<escritura HTTP directa>');
  }
  return halladas;
}

/**
 * Devuelve las mutaciones que `source` llama sin control de permisos en el
 * fichero. Vacío = correcto.
 */
export function mutacionesSinPermiso(
  source: string,
  mutacionesApi: readonly string[],
): string[] {
  const llamadas = mutacionesLlamadas(source, mutacionesApi);
  if (llamadas.length === 0) return [];
  return tieneControlDePermisos(source) ? [] : llamadas;
}
