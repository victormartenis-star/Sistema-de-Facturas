import { describe, expect, it } from 'vitest';
import { buildDbHealthStatus, maskSensitiveData } from './logging';

describe('maskSensitiveData', () => {
  it('enmascara contraseñas, tokens y datos bancarios', () => {
    const masked = maskSensitiveData({
      email: 'a@b.com',
      password: 'Test1234!',
      accessToken: 'eyJhbGciOi...',
      refreshToken: 'abc.def.ghi',
      Authorization: 'Bearer eyJhbGciOi...',
      iban: 'ES9121000418450200051332',
      cvv: '123',
    }) as Record<string, unknown>;

    expect(masked.email).toBe('a@b.com');
    expect(masked.password).toBe('***REDACTED***');
    expect(masked.accessToken).toBe('***REDACTED***');
    expect(masked.refreshToken).toBe('***REDACTED***');
    expect(masked.Authorization).toBe('***REDACTED***');
    expect(masked.iban).toBe('***REDACTED***');
    expect(masked.cvv).toBe('***REDACTED***');
  });

  it('no toca valores primitivos ni objetos sin claves sensibles', () => {
    expect(maskSensitiveData('texto normal')).toBe('texto normal');
    expect(maskSensitiveData(42)).toBe(42);
    expect(maskSensitiveData(null)).toBeNull();
    expect(maskSensitiveData({ method: 'GET', statusCode: 200 })).toEqual({
      method: 'GET',
      statusCode: 200,
    });
  });

  it('enmascara claves sensibles anidadas dentro de objetos y arrays', () => {
    const masked = maskSensitiveData({
      user: { email: 'a@b.com', password: 'secreta' },
      contactos: [{ nombre: 'X', iban: 'ES00...' }],
    }) as Record<string, unknown>;

    expect((masked.user as Record<string, unknown>).password).toBe(
      '***REDACTED***',
    );
    expect((masked.user as Record<string, unknown>).email).toBe('a@b.com');
    const contactos = masked.contactos as Record<string, unknown>[];
    expect(contactos[0].iban).toBe('***REDACTED***');
    expect(contactos[0].nombre).toBe('X');
  });

  it('detecta variantes de mayúsculas y separadores en el nombre de la clave', () => {
    const masked = maskSensitiveData({
      JWT_SECRET: 'x',
      'card-number': '4111111111111111',
      passwordHash: 'x',
    }) as Record<string, unknown>;

    expect(masked.JWT_SECRET).toBe('***REDACTED***');
    expect(masked['card-number']).toBe('***REDACTED***');
    expect(masked.passwordHash).toBe('***REDACTED***');
  });

  it('no se cuelga con estructuras muy anidadas', () => {
    let deep: unknown = { password: 'secreta' };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    expect(() => maskSensitiveData(deep)).not.toThrow();
  });
});

describe('buildDbHealthStatus', () => {
  it('devuelve up con la latencia cuando el ping va bien', () => {
    expect(buildDbHealthStatus({ ok: true, latencyMs: 12 })).toEqual({
      status: 'up',
      latencyMs: 12,
    });
  });

  it('devuelve down con el mensaje de error cuando el ping falla', () => {
    expect(
      buildDbHealthStatus({ ok: false, latencyMs: 5000, error: 'timeout' }),
    ).toEqual({ status: 'down', latencyMs: 5000, message: 'timeout' });
  });

  it('usa un mensaje por defecto si el fallo no trae uno', () => {
    const result = buildDbHealthStatus({ ok: false, latencyMs: 1 });
    expect(result.status).toBe('down');
    expect(result.message).toBe('La base de datos no responde');
  });
});
