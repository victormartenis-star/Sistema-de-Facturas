import { describe, expect, it } from 'vitest';
import { preparePayload, redactPayload } from './audit.service';

/**
 * La redacción es la única parte del registro donde un fallo tiene
 * consecuencias: una contraseña guardada en claro en una tabla inmutable no
 * se puede borrar después.
 */
describe('redactPayload', () => {
  it('oculta la contraseña de un alta de usuario', () => {
    expect(
      redactPayload({
        email: 'ana@dintel.local',
        fullName: 'Ana',
        password: 'contrasena-secreta',
      }),
    ).toEqual({
      email: 'ana@dintel.local',
      fullName: 'Ana',
      password: '«oculto»',
    });
  });

  it('la coincidencia es parcial y sin distinguir mayúsculas', () => {
    expect(
      redactPayload({
        newPassword: 'x',
        passwordHash: 'y',
        API_TOKEN: 'z',
        clientSecret: 'w',
      }),
    ).toEqual({
      newPassword: '«oculto»',
      passwordHash: '«oculto»',
      API_TOKEN: '«oculto»',
      clientSecret: '«oculto»',
    });
  });

  it('llega a los objetos anidados', () => {
    expect(
      redactPayload({ usuario: { nombre: 'Ana', password: 'x' } }),
    ).toEqual({ usuario: { nombre: 'Ana', password: '«oculto»' } });
  });

  it('llega a los objetos dentro de listas', () => {
    expect(
      redactPayload({ altas: [{ email: 'a@b.c', password: 'x' }] }),
    ).toEqual({ altas: [{ email: 'a@b.c', password: '«oculto»' }] });
  });

  it('no toca los campos que sí hay que poder leer', () => {
    const body = {
      salesVariation: 180000,
      description: 'Incremento de medición de acero',
      executed: true,
      requestedAt: '2026-04-01',
      phaseId: null,
    };
    expect(redactPayload(body)).toEqual(body);
  });

  it('aguanta valores que no son objetos', () => {
    expect(redactPayload(null)).toBeNull();
    expect(redactPayload('texto')).toBe('texto');
    expect(redactPayload(42)).toBe(42);
    expect(redactPayload(undefined)).toBeUndefined();
  });
});

describe('preparePayload', () => {
  it('recorta un cuerpo desproporcionado y deja constancia', () => {
    const enorme = { texto: 'x'.repeat(5000), obra: 'OBR-045' };
    const out = preparePayload(enorme) as Record<string, unknown>;
    expect(out['«recortado»']).toContain('se ha omitido');
    // Se conservan las claves: sirven para saber qué se envió
    expect(out.claves).toEqual(['texto', 'obra']);
  });

  it('un cuerpo normal pasa entero', () => {
    const body = { obra: 'OBR-045', importe: 18500 };
    expect(preparePayload(body)).toEqual(body);
  });

  it('un cuerpo vacío o no objeto se guarda como nulo', () => {
    expect(preparePayload(undefined)).toBeNull();
    expect(preparePayload('texto suelto')).toBeNull();
  });
});
