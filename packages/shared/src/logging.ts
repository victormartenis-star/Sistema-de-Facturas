/**
 * Utilidades puras para el logging estructurado de la API (ver
 * `apps/api/src/common/interceptors/logging.interceptor.ts`) y para el
 * healthcheck (`apps/api/src/health`). Sin dependencias de Node ni de
 * NestJS: se pueden probar con datos de mentira, sin arrancar nada.
 */

/**
 * Fragmentos de nombre de clave que, si aparecen en cualquier parte de una
 * clave (insensible a mayúsculas, guiones y guiones bajos), hacen que su
 * valor se enmascare en los logs. Cubre contraseñas, tokens/JWT y datos
 * bancarios — los tres tipos de dato que pide no filtrar nunca.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'contraseña',
  'contrasena',
  'passwordhash',
  'token',
  'authorization',
  'jwt',
  'secret',
  'iban',
  'cardnumber',
  'cvv',
  'cvc',
];

const REDACTED = '***REDACTED***';
/** Evita recorrer estructuras absurdamente anidadas o con ciclos. */
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

/**
 * Enmascara recursivamente los valores de claves sensibles (contraseñas,
 * tokens JWT, IBAN…) antes de mandar un objeto a los logs. No muta el
 * valor de entrada. Los arrays se recorren elemento a elemento; los
 * valores primitivos (incluidas las claves no sensibles) se devuelven tal
 * cual.
 */
export function maskSensitiveData(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveData(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key)
        ? REDACTED
        : maskSensitiveData(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Línea de log estructurada de una petición HTTP completada. */
export interface RequestLogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  /** `null` en rutas públicas o si el usuario no llegó a autenticarse. */
  userId: string | null;
}

// ─── Healthcheck ──────────────────────────────────────────────────────────

/** Resultado crudo, ya medido, de intentar hablar con la base de datos. */
export interface DbPingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export type HealthStatus = 'up' | 'down';

export interface DbHealthStatus {
  status: HealthStatus;
  latencyMs: number;
  message?: string;
}

/**
 * Traduce el resultado crudo de un ping a la base de datos en el estado que
 * expone `GET /health`. Separado de la llamada real a Postgres (que vive en
 * `DrizzleHealthIndicator`, con `node:` y drizzle) para poder probarlo sin
 * levantar ninguna base de datos.
 */
export function buildDbHealthStatus(ping: DbPingResult): DbHealthStatus {
  if (ping.ok) {
    return { status: 'up', latencyMs: ping.latencyMs };
  }
  return {
    status: 'down',
    latencyMs: ping.latencyMs,
    message: ping.error ?? 'La base de datos no responde',
  };
}
