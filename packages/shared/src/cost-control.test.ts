import { describe, expect, it } from 'vitest';
import {
  buildCurvaS,
  computeCostControl,
  computeSobrecostePorPartida,
} from './cost-control';

describe('computeCostControl', () => {
  it('obra por delante de coste (CPI > 1): EAC por debajo del presupuesto', () => {
    const result = computeCostControl({ bac: 100_000, ac: 40_000, ev: 50_000 });
    expect(result.currentMargin).toBe(10_000);
    expect(result.currentMarginPct).toBe(20);
    expect(result.cpi).toBe(1.25);
    expect(result.percentComplete).toBe(50);
    expect(result.eac).toBe(80_000);
    expect(result.varianceAtCompletion).toBe(20_000);
  });

  it('obra recién empezada (sin coste real todavía): EAC = BAC', () => {
    const result = computeCostControl({ bac: 100_000, ac: 0, ev: 0 });
    expect(result.currentMargin).toBe(0);
    expect(result.currentMarginPct).toBeNull();
    expect(result.cpi).toBeNull();
    expect(result.percentComplete).toBe(0);
    expect(result.eac).toBe(100_000);
    expect(result.varianceAtCompletion).toBe(0);
  });

  it('sobrecoste real (CPI < 1): EAC por encima del presupuesto', () => {
    const result = computeCostControl({ bac: 100_000, ac: 60_000, ev: 40_000 });
    expect(result.currentMargin).toBe(-20_000);
    expect(result.currentMarginPct).toBe(-50);
    expect(result.cpi).toBeCloseTo(0.67, 2);
    expect(result.percentComplete).toBe(40);
    // EAC > BAC: a este ritmo de gasto, la obra va a costar más de lo presupuestado
    expect(result.eac).toBeGreaterThan(100_000);
    expect(result.varianceAtCompletion).toBeLessThan(0);
  });

  it('sin presupuesto (BAC = 0): percentComplete null, EAC = AC', () => {
    const result = computeCostControl({ bac: 0, ac: 5_000, ev: 5_000 });
    expect(result.percentComplete).toBeNull();
    expect(result.cpi).toBe(1);
    expect(result.eac).toBe(0); // bac / cpi = 0 / 1 = 0
  });
});

describe('computeSobrecostePorPartida', () => {
  it('marca overBudget cuando el gasto real supera el presupuesto de la partida', () => {
    const rows = computeSobrecostePorPartida([
      {
        phaseId: 'p1',
        code: '01',
        name: 'Movimiento de tierras',
        budget: 10_000,
        actual: 12_000,
      },
      {
        phaseId: 'p2',
        code: '02',
        name: 'Cimentación',
        budget: 20_000,
        actual: 15_000,
      },
    ]);
    expect(rows[0]).toMatchObject({
      deviation: 2_000,
      deviationPct: 20,
      overBudget: true,
    });
    expect(rows[1]).toMatchObject({
      deviation: -5_000,
      deviationPct: -25,
      overBudget: false,
    });
  });

  it('deviationPct es null si la partida no tiene presupuesto', () => {
    const [row] = computeSobrecostePorPartida([
      {
        phaseId: 'p1',
        code: '01',
        name: 'Sin presupuesto',
        budget: 0,
        actual: 500,
      },
    ]);
    expect(row.deviationPct).toBeNull();
    expect(row.overBudget).toBe(true);
  });
});

describe('buildCurvaS', () => {
  it('acumula ambas series por periodo, arrastrando el acumulado cuando un mes no tiene movimiento', () => {
    const actual = new Map([
      ['2026-01', 1_000],
      ['2026-02', 2_000],
    ]);
    const earned = new Map([
      ['2026-01', 500],
      ['2026-03', 1_500],
    ]);
    const curve = buildCurvaS(actual, earned);
    expect(curve).toEqual([
      { period: '2026-01', actualCumulative: 1_000, earnedCumulative: 500 },
      { period: '2026-02', actualCumulative: 3_000, earnedCumulative: 500 },
      { period: '2026-03', actualCumulative: 3_000, earnedCumulative: 2_000 },
    ]);
  });

  it('devuelve un array vacío sin movimientos', () => {
    expect(buildCurvaS(new Map(), new Map())).toEqual([]);
  });
});
