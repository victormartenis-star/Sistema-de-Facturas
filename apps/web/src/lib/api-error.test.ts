import { describe, expect, it } from 'vitest';
import {
  ApiError,
  MENSAJE_CONFLICTO_VERSION,
  errorDeRespuesta,
  esConflictoVersion,
  esPrecondicionRequerida,
  idempotencyKey,
  ifMatch,
  nuevoUuid,
  refSoporte,
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

describe('RFC 7807 (problem+json)', () => {
  const problema = {
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    detail: 'La factura ya está aprobada',
    message: 'texto antiguo',
    errorCode: 'INVOICE_LOCKED',
    correlationId: 'req-12345678',
    errors: [{ field: 'motivo', message: 'Obligatorio' }],
  };

  it('prefiere detail como mensaje de negocio y extrae errorCode y errores', () => {
    const e = errorDeRespuesta(400, problema);
    expect(e.message).toBe('La factura ya está aprobada');
    expect(e.code).toBe('INVOICE_LOCKED');
    expect(e.fieldErrors).toEqual([
      { field: 'motivo', message: 'Obligatorio' },
    ]);
  });

  it('expone el correlationId del cuerpo para soporte', () => {
    const e = errorDeRespuesta(400, problema);
    expect(e.correlationId).toBe('req-12345678');
    expect(refSoporte(e)).toBe('ref: req-12345678');
  });

  it('usa la cabecera X-Request-Id si el cuerpo no trae correlationId', () => {
    const e = errorDeRespuesta(500, { message: 'fallo' }, undefined, 'hdr-1');
    expect(e.correlationId).toBe('hdr-1');
    expect(refSoporte(new Error('x'))).toBe('');
  });

  it('reconoce 409 VERSION_CONFLICT en formato problem+json', () => {
    const e = errorDeRespuesta(409, {
      status: 409,
      errorCode: 'VERSION_CONFLICT',
      versionActual: 4,
      correlationId: 'c-1',
    });
    expect(esConflictoVersion(e)).toBe(true);
    expect(e.versionActual).toBe(4);
    expect(e.message).toBe(MENSAJE_CONFLICTO_VERSION);
  });

  it('reconoce 428 PRECONDITION_REQUIRED y no lo trata como conflicto', () => {
    const e = errorDeRespuesta(428, {
      code: 'PRECONDITION_REQUIRED',
      message: 'Falta la cabecera If-Match con la versión del recurso',
    });
    expect(esPrecondicionRequerida(e)).toBe(true);
    expect(esConflictoVersion(e)).toBe(false);
    expect(e.message).toContain('If-Match');
    expect(esPrecondicionRequerida(new Error('x'))).toBe(false);
  });
});

describe('nuevoUuid / idempotencyKey', () => {
  it('genera UUIDv4 distintos', () => {
    const re =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const a = nuevoUuid();
    expect(a).toMatch(re);
    expect(nuevoUuid()).not.toBe(a);
  });
  it('solo envía la cabecera con clave', () => {
    expect(idempotencyKey('k-1')).toEqual({ 'Idempotency-Key': 'k-1' });
    expect(idempotencyKey()).toEqual({});
    expect(idempotencyKey(null)).toEqual({});
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
