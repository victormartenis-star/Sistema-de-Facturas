import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '@erp/shared';

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  companyId: string;
  exp: number;
}

/** Duración de la sesión: una jornada larga. */
const TTL_SECONDS = 12 * 60 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Emisión y verificación de JWT (HS256) con la criptografía de Node, sin
 * dependencias externas. El formato es el estándar, así que sustituirlo más
 * adelante por una librería o un proveedor externo no obliga a tocar a los
 * clientes.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly secret: string;

  constructor() {
    const fromEnv = process.env.JWT_SECRET;
    if (fromEnv && fromEnv.length >= 32) {
      this.secret = fromEnv;
      return;
    }
    if (process.env.NODE_ENV === 'production') {
      // En producción no se arranca sin clave: una clave temporal invalidaría
      // todas las sesiones en cada reinicio y, peor, pasaría inadvertida.
      throw new Error(
        'JWT_SECRET no definida o de menos de 32 caracteres. Defínela antes de arrancar en producción.',
      );
    }
    this.secret = randomBytes(48).toString('hex');
    this.logger.warn(
      'JWT_SECRET no definida: se usa una clave temporal. Las sesiones no sobreviven a un reinicio.',
    );
  }

  sign(payload: Omit<TokenPayload, 'exp'>): string {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(
      JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      }),
    );
    return `${header}.${body}.${this.signature(`${header}.${body}`)}`;
  }

  verify(token: string): TokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Token con formato incorrecto');
    }
    const [header, body, signature] = parts;

    const expected = Buffer.from(this.signature(`${header}.${body}`));
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Token no válido');
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(
          body.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString(),
      );
    } catch {
      throw new UnauthorizedException('Token ilegible');
    }

    if (payload.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('La sesión ha caducado, vuelve a entrar');
    }
    return payload;
  }

  private signature(data: string): string {
    return createHmac('sha256', this.secret)
      .update(data)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
