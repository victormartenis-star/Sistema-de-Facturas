import { describe, expect, it } from 'vitest';
import {
  computeEmisionesKgCo2e,
  esgFactorCreateSchema,
  esgRegistroCreateSchema,
  summarizeEmisiones,
} from './esg';

describe('esgFactorCreateSchema', () => {
  it('acepta un factor mínimo con activo por defecto', () => {
    const result = esgFactorCreateSchema.parse({
      categoria: 'combustible',
      nombre: 'Gasóleo B',
      unidad: 'litro',
      factorKgCo2e: 2.68,
    });
    expect(result.activo).toBe(true);
  });

  it('rechaza una categoría no reconocida', () => {
    expect(() =>
      esgFactorCreateSchema.parse({
        categoria: 'plastico',
        nombre: 'x',
        unidad: 'kg',
        factorKgCo2e: 1,
      }),
    ).toThrow();
  });

  it('rechaza un factor negativo', () => {
    expect(() =>
      esgFactorCreateSchema.parse({
        categoria: 'energia',
        nombre: 'Electricidad red',
        unidad: 'kWh',
        factorKgCo2e: -0.2,
      }),
    ).toThrow();
  });
});

describe('esgRegistroCreateSchema', () => {
  it('rechaza cantidad cero o negativa', () => {
    expect(() =>
      esgRegistroCreateSchema.parse({
        projectId: '11111111-1111-1111-1111-111111111111',
        factorId: '22222222-2222-2222-2222-222222222222',
        fecha: '2026-09-14',
        cantidad: 0,
      }),
    ).toThrow();
  });
});

describe('computeEmisionesKgCo2e', () => {
  it('multiplica cantidad por factor con 3 decimales', () => {
    expect(computeEmisionesKgCo2e(100, 2.68)).toBeCloseTo(268, 3);
    expect(computeEmisionesKgCo2e(1500, 0.181)).toBeCloseTo(271.5, 3);
  });
});

describe('summarizeEmisiones', () => {
  it('agrupa por categoría y suma el total', () => {
    const { totalKgCo2e, porCategoria } = summarizeEmisiones([
      { categoria: 'combustible', emisionesKgCo2e: 268 },
      { categoria: 'combustible', emisionesKgCo2e: 100 },
      { categoria: 'energia', emisionesKgCo2e: 50 },
    ]);
    expect(totalKgCo2e).toBe(418);
    expect(porCategoria).toEqual([
      { categoria: 'combustible', emisionesKgCo2e: 368 },
      { categoria: 'energia', emisionesKgCo2e: 50 },
    ]);
  });

  it('devuelve vacío sin registros', () => {
    expect(summarizeEmisiones([])).toEqual({
      totalKgCo2e: 0,
      porCategoria: [],
    });
  });
});
