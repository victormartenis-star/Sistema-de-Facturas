import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Parámetros scrypt (OWASP): N=2^15, r=8, p=1, 64 bytes de salida
const KEY_LENGTH = 64;
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keyLength, SCRYPT_OPTS, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Devuelve `scrypt$<salt hex>$<hash hex>`; el formato permite rotar el algoritmo. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(
    password,
    Buffer.from(saltHex, 'hex'),
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
