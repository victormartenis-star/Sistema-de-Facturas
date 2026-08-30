import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Derivación de contraseñas con scrypt.
 *
 * Argon2id sería preferible, pero requiere un módulo nativo; scrypt viene en
 * el propio Node, resiste hardware dedicado y está aceptado por OWASP. El
 * formato almacenado lleva los parámetros dentro, así que subirlos más
 * adelante —o migrar a Argon2— no invalida los hashes existentes.
 */
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  let derived: Buffer;
  try {
    derived = await scrypt(
      password,
      Buffer.from(saltHex, 'hex'),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      },
    );
  } catch {
    return false;
  }
  // Comparación en tiempo constante: no revela cuántos bytes coincidían
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}
