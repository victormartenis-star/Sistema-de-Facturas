import { describe, expect, it } from 'vitest';
import {
  ApiError,
  MENSAJE_CONFLICTO_VERSION,
  errorDeRespuesta,
  esConflictoVersion,
  ifMatch,
} from './api-error';

describe('errorDeRespuesta', () => {
  it('expone code y versionActual del cuerpo', () => {
    const e = errorDeRespuesta(409, {
      code: 'VERSION_CONFLICT',
      versionActual: 7,
    });
    expect(e.status).toBe(409);
    expect(e.code).toBe('VERSION_CONFLICT');
    expect(e.versionActual).toBe(7);
    expect(e.message).toBe(MENSAJE_CONFLICTO_VERSION);
  });

  it('une message en array y conserva errores de campo', () => {
    const e = errorDeRespuesta(400, {
      message: ['a', 'b'],
      errors: [{ field: 'x', message: 'mal' }],
    });
    expect(e.message).toBe('a, b');
    expect(e.fieldErrors).toEqual([{ field: 'x', message: 'mal' }]);
    expect(e.code).toBeUndefined();
  });

  it('tolera cuerpo nulo o no JSON', () => {
    expect(errorDeRespuesta(500, null).message).toBe('Error 500');
    expect(errorDeRespuesta(500, 'texto').code).toBeUndefined();
  });
});

describe('esConflictoVersion', () => {
  it('detecta VERSION_CONFLICT', () => {
    expect(
      esConflictoVersion(errorDeRespuesta(409, { code: 'VERSION_CONFLICT' })),
    ).toBe(true);
  });
  it('no confunde un 409 de estado', () => {
    expect(
      esConflictoVersion(
        errorDeRespuesta(409, { message: 'Estado no permitido' }),
      ),
    ).toBe(false);
  });
  it('ignora otros códigos y errores ajenos', () => {
    expect(
      esConflictoVersion(new ApiError('x', 428, [], 'VERSION_CONFLICT')),
    ).toBe(false);
    expect(esConflictoVersion(new Error('x'))).toBe(false);
    expect(MENSAJE_CONFLICTO_VERSION).toContain('Recarga');
  });
});

describe('ifMatch', () => {
  it('entrecomilla la versión', () => {
    expect(ifMatch(3)).toEqual({ 'If-Match': '"3"' });
  });
  it('no envía nada sin versión', () => {
    expect(ifMatch(undefined)).toEqual({});
    expect(ifMatch(null)).toEqual({});
  });
});
