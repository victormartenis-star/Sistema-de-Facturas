/**
 * Cliente HTTP contra la API del ERP.
 *
 * El MCP no habla con la base de datos: pasa por la API para que se apliquen
 * las mismas reglas que en la web (numeracion, validaciones, calculo del IVA,
 * ISP y retencion). Duplicar aqui esa logica seria repetir el error que
 * `packages/shared` vino a corregir.
 */

import { randomUUID } from 'node:crypto';

export const BASE_URL = process.env.ERP_API_URL ?? 'http://localhost:3001';

/**
 * Token de la API, opcional.
 *
 * Hoy la API no exige autenticacion, pero la rama que introduce el modulo
 * `auth` monta un guard que lee `Authorization: Bearer <token>`. Con esto el
 * MCP ya lo manda cuando la variable existe: mientras no se defina, el
 * comportamiento es identico al actual y no se envia ninguna cabecera de mas.
 */
const TOKEN = process.env.ERP_API_TOKEN ?? '';

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
function mensajeDe(
  cuerpo: unknown,
  estado: number,
  requestId?: string,
): string {
  if (cuerpo && typeof cuerpo === 'object') {
    const c = cuerpo as {
      detail?: unknown;
      message?: unknown;
      correlationId?: unknown;
    };
    // El correlationId del cuerpo manda; si no, la cabecera X-Request-Id.
    const id =
      typeof c.correlationId === 'string' ? c.correlationId : requestId;
    const ref = id ? ` (ref: ${id})` : '';
    // RFC 7807: `detail`; `message` se conserva por compatibilidad (string o string[]).
    if (typeof c.detail === 'string') return c.detail + ref;
    if (Array.isArray(c.message)) return c.message.join('; ') + ref;
    if (typeof c.message === 'string') return c.message + ref;
  }
  return `La API respondio ${estado}${requestId ? ` (ref: ${requestId})` : ''}`;
}

/** ` (ref: <correlationId>)` si el cuerpo RFC 7807 lo trae; vacio si no. */
function refDe(cuerpo: unknown): string {
  const id = (cuerpo as { correlationId?: unknown } | null)?.correlationId;
  return typeof id === 'string' ? ` (ref: ${id})` : '';
}

export async function pedir<T>(
  ruta: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  // Una por peticion: la API la devuelve y la guarda en audit_log.
  const requestId = randomUUID();
  try {
    res = await fetch(`${BASE_URL}${ruta}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
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
    let mensaje = mensajeDe(
      cuerpo,
      res.status,
      res.headers.get('x-request-id') ?? requestId,
    );
    // Un 401 sin token configurado es un fallo de instalacion, no de la
    // peticion: sin esta pista el agente reintenta la llamada en bucle.
    if (res.status === 401 && !TOKEN) {
      mensaje +=
        ' — La API exige autenticacion y ERP_API_TOKEN no esta definida.' +
        ' Configurala en el entorno del servidor MCP (.mcp.json).';
    }
    if (res.status === 403) {
      mensaje += ' — El token es valido pero su perfil no tiene ese permiso.';
    }
    throw new ErrorApi(res.status, cuerpo, mensaje);
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

/**
 * PATCH/DELETE de una entidad versionada con control optimista.
 *
 * Lee la version actual con `leerVersion` (GET) y la envia como
 * `If-Match: "<version>"`. Entre ese GET y el PATCH/DELETE hay una ventana de
 * carrera: otro usuario puede modificar la entidad en medio. No hace falta
 * cerrarla aqui, porque la API la cubre: si la version cambio responde 409
 * `VERSION_CONFLICT` y este helper lo traduce a un error claro para el agente,
 * que debe volver a leer la entidad y reintentar con datos frescos.
 */
export async function pedirVersionado<T>(
  ruta: string,
  init: RequestInit,
  leerVersion: () => Promise<number>,
  entidad: string,
): Promise<T> {
  const version = await leerVersion();
  try {
    return await pedir<T>(ruta, {
      ...init,
      headers: { ...(init.headers ?? {}), 'If-Match': `"${version}"` },
    });
  } catch (e) {
    if (
      e instanceof ErrorApi &&
      e.estado === 409 &&
      ((e.cuerpo as { errorCode?: string; code?: string } | null)?.errorCode ===
        'VERSION_CONFLICT' ||
        (e.cuerpo as { code?: string } | null)?.code === 'VERSION_CONFLICT')
    ) {
      throw new ErrorApi(
        409,
        e.cuerpo,
        `versión obsoleta: vuelve a leer el ${entidad} y reintenta ` +
          `(otro usuario lo modificó entre tu lectura y este cambio)` +
          refDe(e.cuerpo),
      );
    }
    throw e;
  }
}
