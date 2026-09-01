/**
 * Cliente HTTP contra la API del ERP.
 *
 * El MCP no habla con la base de datos: pasa por la API para que se apliquen
 * las mismas reglas que en la web (numeracion, validaciones, calculo del IVA,
 * ISP y retencion). Duplicar aqui esa logica seria repetir el error que
 * `packages/shared` vino a corregir.
 */

export const BASE_URL = process.env.ERP_API_URL ?? 'http://localhost:3001';

/** Error de la API con su codigo y el mensaje que devolvio Nest. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly cuerpo: unknown,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

/** Extrae el texto de error de una respuesta de Nest. */
function mensajeDe(cuerpo: unknown, estado: number): string {
  if (cuerpo && typeof cuerpo === 'object' && 'message' in cuerpo) {
    const m = (cuerpo as { message: unknown }).message;
    // Nest devuelve string o string[] segun sea excepcion simple o de validacion.
    if (Array.isArray(m)) return m.join('; ');
    if (typeof m === 'string') return m;
  }
  return `La API respondio ${estado}`;
}

export async function pedir<T>(
  ruta: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${ruta}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (causa) {
    // Sin este mensaje el fallo mas comun (la API parada) aparece como un
    // "fetch failed" que no le dice nada a nadie.
    throw new ErrorApi(
      0,
      null,
      `No se pudo conectar con la API en ${BASE_URL}. ` +
        `Arrancala con "npm run dev:api" o ajusta ERP_API_URL. (${String(causa)})`,
    );
  }

  if (res.status === 204) return undefined as T;

  const texto = await res.text();
  let cuerpo: unknown = null;
  if (texto) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = texto;
    }
  }

  if (!res.ok) {
    throw new ErrorApi(res.status, cuerpo, mensajeDe(cuerpo, res.status));
  }
  return cuerpo as T;
}

/** Construye la query string omitiendo lo vacio. */
export function query(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
