import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * JWT HS256 mínimo sin dependencias (firma y verificación).
 * Suficiente para tokens de acceso propios; si se delega en Auth0 (RS256 +
 * JWKS) se sustituye esta verificación por la del proveedor.
 */

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const body = base64url(JSON.stringify(payload));
  const data = `${HEADER}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

/** Devuelve el payload si la firma es válida y no ha expirado; si no, `null`. */
export function verifyJwt<T extends { exp?: number }>(
  token: string,
  secret: string,
): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as T;
    if (payload.exp !== undefined && payload.exp <= nowSeconds()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
