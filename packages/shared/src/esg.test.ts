import { describe, expect, it } from 'vitest';
import {
  computeEmisionesKgCo2e,
  esgFactorCreateSchema,
  esgRegistroCreateSchema,
  rcdValeCreateSchema,
  summarizeEmisiones,
  summarizeRcd,
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

describe('rcdValeCreateSchema', () => {
  it('acepta un código LER con o sin espacios', () => {
    const base = {
      projectId: '11111111-1111-1111-1111-111111111111',
      description: 'Hormigón',
      quantity: 5,
      managerContactId: '22222222-2222-2222-2222-222222222222',
      ticketNumber: 'V-001',
      ticketDate: '2026-09-14',
    };
    expect(
      rcdValeCreateSchema.parse({ ...base, lerCode: '17 01 01' }).lerCode,
    ).toBe('17 01 01');
    expect(
      rcdValeCreateSchema.parse({ ...base, lerCode: '170101' }).lerCode,
    ).toBe('170101');
  });

  it('rechaza un código LER con formato inválido', () => {
    expect(() =>
      rcdValeCreateSchema.parse({
        projectId: '11111111-1111-1111-1111-111111111111',
        lerCode: 'hormigon',
        description: 'Hormigón',
        quantity: 5,
        managerContactId: '22222222-2222-2222-2222-222222222222',
        ticketNumber: 'V-001',
        ticketDate: '2026-09-14',
      }),
    ).toThrow();
  });
});

describe('summarizeRcd', () => {
  it('calcula % de valorización solo sobre toneladas, agrupa m³ aparte', () => {
    const result = summarizeRcd([
      {
        lerCode: '17 01 01',
        description: 'Hormigón',
        quantity: 10,
        unit: 'tn',
        treatment: 'valorizacion',
      },
      {
        lerCode: '17 09 04',
        description: 'Mezcla de residuos',
        quantity: 5,
        unit: 'tn',
        treatment: 'eliminacion',
      },
      {
        lerCode: '17 05 04',
        description: 'Tierras',
        quantity: 20,
        unit: 'm3',
        treatment: 'valorizacion',
      },
    ]);
    expect(result.totalToneladas).toBe(15);
    expect(result.totalM3).toBe(20);
    expect(result.valorizacionPct).toBeCloseTo(66.7, 1);
    expect(result.porLer).toHaveLength(3);
  });

  it('valorizacionPct es null sin toneladas', () => {
    expect(summarizeRcd([]).valorizacionPct).toBeNull();
  });

  it('agrupa por LER + unidad, sumando cantidades repetidas', () => {
    const result = summarizeRcd([
      {
        lerCode: '17 01 01',
        description: 'Hormigón',
        quantity: 3,
        unit: 'tn',
        treatment: 'valorizacion',
      },
      {
        lerCode: '17 01 01',
        description: 'Hormigón',
        quantity: 2,
        unit: 'tn',
        treatment: 'valorizacion',
      },
    ]);
    expect(result.porLer).toEqual([
      { lerCode: '17 01 01', description: 'Hormigón', quantity: 5, unit: 'tn' },
    ]);
  });
});
