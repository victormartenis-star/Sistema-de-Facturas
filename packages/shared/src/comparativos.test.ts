import { describe, expect, it } from 'vitest';
import {
  computeDeviationVsTarget,
  computeLineTotal,
  computeOfertaTotal,
  computeSavingsOpportunities,
  findCheapestOfertaId,
  type SavingsObservation,
} from './comparativos';

describe('computeLineTotal', () => {
  it('multiplica precio unitario por medición', () => {
    expect(computeLineTotal(12.5, 100)).toBe(1250);
  });

  it('redondea a 2 decimales', () => {
    expect(computeLineTotal(3.333, 3)).toBe(10);
  });
});

describe('computeOfertaTotal', () => {
  it('suma los importes de línea', () => {
    expect(computeOfertaTotal([100, 250.5, 49.5])).toBe(400);
  });

  it('devuelve 0 sin líneas', () => {
    expect(computeOfertaTotal([])).toBe(0);
  });
});

describe('computeDeviationVsTarget', () => {
  it('desviación positiva = oferta más cara que el objetivo', () => {
    const { deviation, deviationPct } = computeDeviationVsTarget(1100, 1000);
    expect(deviation).toBe(100);
    expect(deviationPct).toBe(10);
  });

  it('desviación negativa = oferta más barata que el objetivo', () => {
    const { deviation, deviationPct } = computeDeviationVsTarget(900, 1000);
    expect(deviation).toBe(-100);
    expect(deviationPct).toBe(-10);
  });

  it('deviationPct es null si el objetivo es 0', () => {
    expect(computeDeviationVsTarget(500, 0).deviationPct).toBeNull();
  });
});

describe('findCheapestOfertaId', () => {
  it('devuelve la oferta de menor importe', () => {
    const id = findCheapestOfertaId([
      { ofertaId: 'a', totalAmount: 1200 },
      { ofertaId: 'b', totalAmount: 950 },
      { ofertaId: 'c', totalAmount: 1000 },
    ]);
    expect(id).toBe('b');
  });

  it('devuelve null sin ofertas', () => {
    expect(findCheapestOfertaId([])).toBeNull();
  });

  it('en empate, devuelve la primera', () => {
    const id = findCheapestOfertaId([
      { ofertaId: 'x', totalAmount: 500 },
      { ofertaId: 'y', totalAmount: 500 },
    ]);
    expect(id).toBe('x');
  });
});

describe('computeSavingsOpportunities', () => {
  function obs(overrides: Partial<SavingsObservation>): SavingsObservation {
    return {
      budgetItemCode: '01.01',
      budgetItemName: 'Hormigón HA-25',
      unitPrice: 100,
      quantity: 10,
      projectId: 'p1',
      projectName: 'Obra A',
      contactId: 'c1',
      contactName: 'Proveedor A',
      isAwarded: false,
      ...overrides,
    };
  }

  it('señala una partida adjudicada por encima del umbral frente al mínimo visto en otra obra', () => {
    const result = computeSavingsOpportunities([
      obs({
        projectId: 'p1',
        contactId: 'c1',
        contactName: 'Proveedor A',
        unitPrice: 100,
        quantity: 10,
        isAwarded: true,
      }),
      obs({
        projectId: 'p2',
        projectName: 'Obra B',
        contactId: 'c2',
        contactName: 'Proveedor B',
        unitPrice: 80,
        isAwarded: false,
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      budgetItemCode: '01.01',
      paidProjectId: 'p1',
      paidUnitPrice: 100,
      minUnitPrice: 80,
      minProjectId: 'p2',
      minContactName: 'Proveedor B',
      overpayPct: 25,
      potentialSavingsAmount: 200, // (100-80) * 10
    });
  });

  it('no señala nada si la adjudicada ya es la más barata', () => {
    const result = computeSavingsOpportunities([
      obs({ contactId: 'c1', unitPrice: 80, isAwarded: true }),
      obs({ contactId: 'c2', unitPrice: 100, isAwarded: false }),
    ]);
    expect(result).toEqual([]);
  });

  it('no señala nada si el sobreprecio no supera el umbral', () => {
    const result = computeSavingsOpportunities([
      obs({
        projectId: 'p1',
        contactId: 'c1',
        unitPrice: 105,
        isAwarded: true,
      }),
      obs({ projectId: 'p2', contactId: 'c2', unitPrice: 100 }),
    ]);
    expect(result).toEqual([]); // 5% de sobreprecio, umbral por defecto 10%
  });

  it('ignora las líneas no adjudicadas como "pagadas" (solo son referencia de precio)', () => {
    const result = computeSavingsOpportunities([
      obs({ projectId: 'p1', contactId: 'c1', unitPrice: 100 }),
      obs({ projectId: 'p2', contactId: 'c2', unitPrice: 200 }),
    ]);
    expect(result).toEqual([]);
  });

  it('agrupa por código de partida, no mezcla partidas distintas', () => {
    const result = computeSavingsOpportunities([
      obs({
        budgetItemCode: '01.01',
        projectId: 'p1',
        contactId: 'c1',
        unitPrice: 100,
        isAwarded: true,
      }),
      obs({
        budgetItemCode: '02.02',
        projectId: 'p1',
        contactId: 'c1',
        unitPrice: 50,
        isAwarded: true,
      }),
      obs({ budgetItemCode: '02.02', projectId: 'p2', unitPrice: 500 }),
    ]);
    expect(result).toEqual([]);
  });

  it('respeta un umbral personalizado', () => {
    const observations = [
      obs({
        projectId: 'p1',
        contactId: 'c1',
        unitPrice: 105,
        isAwarded: true,
      }),
      obs({ projectId: 'p2', contactId: 'c2', unitPrice: 100 }),
    ];
    expect(computeSavingsOpportunities(observations, 10)).toEqual([]);
    expect(computeSavingsOpportunities(observations, 2)).toHaveLength(1);
  });

  it('ordena de mayor a menor sobreprecio', () => {
    const result = computeSavingsOpportunities([
      obs({
        budgetItemCode: 'A',
        projectId: 'p1',
        contactId: 'c1',
        unitPrice: 150,
        isAwarded: true,
      }),
      obs({ budgetItemCode: 'A', projectId: 'p2', unitPrice: 100 }),
      obs({
        budgetItemCode: 'B',
        projectId: 'p1',
        contactId: 'c1',
        unitPrice: 130,
        isAwarded: true,
      }),
      obs({ budgetItemCode: 'B', projectId: 'p2', unitPrice: 100 }),
    ]);
    expect(result.map((r) => r.budgetItemCode)).toEqual(['A', 'B']);
  });

  it('sin observaciones, devuelve vacío', () => {
    expect(computeSavingsOpportunities([])).toEqual([]);
  });
});
