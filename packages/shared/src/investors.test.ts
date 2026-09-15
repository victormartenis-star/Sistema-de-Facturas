import { describe, expect, it } from 'vitest';
import {
  distributeDividend,
  investmentAccountCreateSchema,
  investorCreateSchema,
  participationCreateSchema,
} from './investors';

describe('investorCreateSchema', () => {
  it('acepta un inversor mínimo con kind por defecto', () => {
    const result = investorCreateSchema.parse({ legalName: 'Juan Pérez' });
    expect(result.kind).toBe('persona_fisica');
  });

  it('rechaza un nombre vacío', () => {
    expect(() => investorCreateSchema.parse({ legalName: '' })).toThrow();
  });
});

describe('investmentAccountCreateSchema', () => {
  it('acepta projectId nulo (cuenta a nivel de empresa)', () => {
    const result = investmentAccountCreateSchema.parse({
      name: 'Fondo general',
      startDate: '2026-01-01',
      projectId: null,
    });
    expect(result.projectId).toBeNull();
  });
});

describe('participationCreateSchema', () => {
  it('rechaza un porcentaje superior a 100', () => {
    expect(() =>
      participationCreateSchema.parse({
        investorId: '11111111-1111-1111-1111-111111111111',
        participationPct: 150,
        joinedAt: '2026-01-01',
      }),
    ).toThrow();
  });
});

describe('distributeDividend', () => {
  it('reparte proporcionalmente cuando los porcentajes son exactos', () => {
    const result = distributeDividend(
      [
        { investorId: 'a', participationPct: 60 },
        { investorId: 'b', participationPct: 40 },
      ],
      1000,
    );
    expect(result).toEqual([
      { investorId: 'a', amount: 600 },
      { investorId: 'b', amount: 400 },
    ]);
  });

  it('cuadra céntimos cuando el reparto exacto no es entero (3 inversores al 33,33%)', () => {
    const result = distributeDividend(
      [
        { investorId: 'a', participationPct: 33.3333 },
        { investorId: 'b', participationPct: 33.3333 },
        { investorId: 'c', participationPct: 33.3334 },
      ],
      100,
    );
    const sum = round2Sum(result.map((r) => r.amount));
    expect(sum).toBe(100);
    // El último absorbe el resto de redondeo.
    expect(result[2].investorId).toBe('c');
  });

  it('cuadra céntimos con un importe con decimales impares entre muchos inversores', () => {
    const participations = Array.from({ length: 7 }, (_, i) => ({
      investorId: `inv-${i}`,
      participationPct: 100 / 7,
    }));
    const result = distributeDividend(participations, 1000.01);
    const sum = round2Sum(result.map((r) => r.amount));
    expect(sum).toBeCloseTo(1000.01, 2);
  });

  it('respeta porcentajes desiguales y sigue cuadrando la suma', () => {
    const result = distributeDividend(
      [
        { investorId: 'a', participationPct: 10 },
        { investorId: 'b', participationPct: 25.5 },
        { investorId: 'c', participationPct: 64.5 },
      ],
      12345.67,
    );
    const sum = round2Sum(result.map((r) => r.amount));
    expect(sum).toBeCloseTo(12345.67, 2);
  });

  it('devuelve vacío sin participaciones', () => {
    expect(distributeDividend([], 100)).toEqual([]);
  });

  it('reparte a partes iguales si un único inversor tiene el 100 %', () => {
    const result = distributeDividend(
      [{ investorId: 'unico', participationPct: 100 }],
      500,
    );
    expect(result).toEqual([{ investorId: 'unico', amount: 500 }]);
  });
});

/** Suma exacta en céntimos, para no arrastrar errores de coma flotante en el propio test. */
function round2Sum(amounts: number[]): number {
  const cents = amounts.reduce((s, a) => s + Math.round(a * 100), 0);
  return Math.round(cents) / 100;
}
