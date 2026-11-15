import pino from 'pino';
import { maskSensitiveData } from '@erp/shared';
import { getCorrelationId, getRequestContext } from '../request-context';

const CLAVES = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'certificate',
  'certificatePassword',
  'secret',
  'clientSecret',
  'apiKey',
  'cookie',
];

/**
 * `fast-redact` no tiene comodín recursivo: se listan claves a 0-3 niveles.
 * Los niveles más profundos los cubre `maskSensitiveData` (formatters.log),
 * que es recursivo por fragmento de clave.
 */
export const REDACT_PATHS = [
  ...CLAVES.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `*.*.*.${k}`]),
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.cookie',
  'res.headers["set-cookie"]',
  'err.config.headers.authorization',
];

/**
 * Destino sustituible (los tests capturan las líneas). Por defecto, stdout:
 * JSON por línea para que lo recoja quien orqueste el proceso.
 */
let destino: (linea: string) => void = (linea) => {
  process.stdout.write(linea);
};

export function setLogDestination(fn: ((linea: string) => void) | undefined) {
  destino =
    fn ??
    ((linea) => {
      process.stdout.write(linea);
    });
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: null,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
      log: (obj) => maskSensitiveData(obj) as Record<string, unknown>,
    },
    redact: { paths: REDACT_PATHS, censor: '***REDACTED***' },
    mixin() {
      const ctx = getRequestContext();
      return {
        correlationId: getCorrelationId(),
        companyId: ctx?.companyId ?? null,
        userId: ctx?.userId ?? null,
      };
    },
  },
  { write: (linea: string) => destino(linea) },
);
