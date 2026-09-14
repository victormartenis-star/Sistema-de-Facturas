import { describe, expect, it } from 'vitest';
import { buildHttpRequestLabels, extractSqlOperation } from './metrics';

describe('buildHttpRequestLabels', () => {
  it('usa el patrón de ruta, no la URL resuelta', () => {
    expect(
      buildHttpRequestLabels({
        method: 'GET',
        routePattern: '/invoices/:id',
        statusCode: 200,
        role: 'gerente',
      }),
    ).toEqual({
      method: 'GET',
      route: '/invoices/:id',
      status_code: '200',
      role: 'gerente',
    });
  });

  it('etiqueta como "sin_ruta" cuando Express no llegó a enrutar', () => {
    const labels = buildHttpRequestLabels({
      method: 'GET',
      routePattern: undefined,
      statusCode: 404,
      role: null,
    });
    expect(labels.route).toBe('sin_ruta');
  });

  it('etiqueta como "sin_ruta" con una cadena vacía o solo espacios', () => {
    expect(
      buildHttpRequestLabels({
        method: 'GET',
        routePattern: '   ',
        statusCode: 404,
        role: null,
      }).route,
    ).toBe('sin_ruta');
  });

  it('etiqueta como "anonimo" sin usuario autenticado', () => {
    expect(
      buildHttpRequestLabels({
        method: 'GET',
        routePattern: '/health',
        statusCode: 200,
        role: undefined,
      }).role,
    ).toBe('anonimo');
  });

  it('convierte el código de estado a texto', () => {
    expect(
      buildHttpRequestLabels({
        method: 'POST',
        routePattern: '/auth/login',
        statusCode: 429,
        role: null,
      }).status_code,
    ).toBe('429');
  });
});

describe('extractSqlOperation', () => {
  it.each([
    ['SELECT 1', 'SELECT'],
    ['  select id from projects', 'SELECT'],
    ['INSERT INTO invoices (id) VALUES ($1)', 'INSERT'],
    ['UPDATE invoices SET status = $1', 'UPDATE'],
    ['DELETE FROM sessions', 'DELETE'],
    ['WITH totals AS (SELECT 1) SELECT * FROM totals', 'WITH'],
  ])('reconoce %s como %s', (sql, expected) => {
    expect(extractSqlOperation(sql)).toBe(expected);
  });

  it('devuelve "desconocida" para una cadena vacía', () => {
    expect(extractSqlOperation('')).toBe('desconocida');
  });

  it('devuelve "desconocida" para null/undefined', () => {
    expect(extractSqlOperation(null)).toBe('desconocida');
    expect(extractSqlOperation(undefined)).toBe('desconocida');
  });

  it('devuelve "desconocida" si no empieza por letras', () => {
    expect(extractSqlOperation('123 no es SQL')).toBe('desconocida');
  });
});
