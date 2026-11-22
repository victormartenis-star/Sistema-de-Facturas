import { describe, expect, it } from 'vitest';
import { ErrorApi, errorDeDominio } from './api';
import { ejecutar, ok } from './comun';

describe('ok', () => {
  it('devuelve el objeto también en structuredContent', () => {
    expect(ok({ a: 1 }).structuredContent).toEqual({ a: 1 });
  });

  it('envuelve listas en items y escalares en resultado (MCP exige objeto)', () => {
    expect(ok([1, 2]).structuredContent).toEqual({ items: [1, 2] });
    expect(ok(3).structuredContent).toEqual({ resultado: 3 });
    expect(ok(undefined).structuredContent).toBeUndefined();
  });
});

describe('errorDeDominio', () => {
  it('extrae errorCode, detail y correlationId de un problem+json', () => {
    const e = new ErrorApi(
      409,
      {
        type: 'https://erp-dintel/errores/INVOICE_NOT_DRAFT',
        status: 409,
        detail: 'Solo se aprueban facturas en borrador',
        errorCode: 'INVOICE_NOT_DRAFT',
        correlationId: 'corr-1',
      },
      'Solo se aprueban facturas en borrador (ref: corr-1)',
      'corr-1',
    );
    expect(errorDeDominio(e)).toEqual({
      status: 409,
      errorCode: 'INVOICE_NOT_DRAFT',
      detail: 'Solo se aprueban facturas en borrador',
      correlationId: 'corr-1',
    });
  });

  it('cae al X-Request-Id de la cabecera si el cuerpo no trae correlationId', () => {
    const e = new ErrorApi(
      404,
      { errorCode: 'BUDGET_NOT_FOUND', detail: 'Presupuesto no encontrado' },
      'Presupuesto no encontrado',
      'req-9',
    );
    expect(errorDeDominio(e).correlationId).toBe('req-9');
  });

  it('usa el código genérico legado (code) si no hay errorCode', () => {
    const e = new ErrorApi(409, { code: 'VERSION_CONFLICT' }, 'x');
    expect(errorDeDominio(e).errorCode).toBe('VERSION_CONFLICT');
  });

  it('sin cuerpo JSON, el detail es el mensaje del error y no hay código', () => {
    const e = new ErrorApi(0, null, 'No se pudo conectar con la API');
    const d = errorDeDominio(e);
    expect(d.errorCode).toBeUndefined();
    expect(d.detail).toBe('No se pudo conectar con la API');
    expect(d.status).toBe(0);
  });
});

describe('ejecutar con errores de dominio', () => {
  it('devuelve isError, el texto con el código y structuredContent para el agente', async () => {
    const r = await ejecutar(async () => {
      throw new ErrorApi(
        409,
        {
          detail: 'Solo se aprueban facturas en borrador',
          errorCode: 'INVOICE_NOT_DRAFT',
          correlationId: 'corr-7',
        },
        'Solo se aprueban facturas en borrador (ref: corr-7)',
        'corr-7',
      );
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('[409]');
    expect(r.content[0].text).toContain(
      'Solo se aprueban facturas en borrador',
    );
    expect(r.content[0].text).toContain('código: INVOICE_NOT_DRAFT');
    expect(r.structuredContent).toEqual({
      status: 409,
      errorCode: 'INVOICE_NOT_DRAFT',
      detail: 'Solo se aprueban facturas en borrador',
      correlationId: 'corr-7',
    });
  });

  it('un error que no es de la API no lleva structuredContent', async () => {
    const r = await ejecutar(async () => {
      throw new Error('boom');
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
  });
});
