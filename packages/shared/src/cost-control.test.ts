import { describe, expect, it } from 'vitest';
import {
  buildCurvaS,
  agruparDesviacionPorCapitulo,
  buildPlannedByPeriod,
  capituloDeCodigo,
  computeCostControl,
  computeMargenPrevistoObra,
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
      {
        period: '2026-01',
        actualCumulative: 1_000,
        earnedCumulative: 500,
        plannedCumulative: null,
      },
      {
        period: '2026-02',
        actualCumulative: 3_000,
        earnedCumulative: 500,
        plannedCumulative: null,
      },
      {
        period: '2026-03',
        actualCumulative: 3_000,
        earnedCumulative: 2_000,
        plannedCumulative: null,
      },
    ]);
  });

  it('incluye la serie planificada acumulada cuando se le pasa', () => {
    const actual = new Map([['2026-01', 1_000]]);
    const earned = new Map([['2026-01', 500]]);
    const planned = new Map([
      ['2026-01', 800],
      ['2026-02', 800],
    ]);
    const curve = buildCurvaS(actual, earned, planned);
    expect(curve.map((p) => [p.period, p.plannedCumulative])).toEqual([
      ['2026-01', 800],
      ['2026-02', 1_600],
    ]);
  });

  it('devuelve un array vacío sin movimientos', () => {
    expect(buildCurvaS(new Map(), new Map())).toEqual([]);
  });
});

describe('buildPlannedByPeriod', () => {
  it('reparte el presupuesto de una partida linealmente entre sus meses', () => {
    const result = buildPlannedByPeriod([
      {
        budgetAmount: 3_000,
        plannedStartDate: '2026-01-15',
        plannedEndDate: '2026-03-05',
      },
    ]);
    expect(Object.fromEntries(result)).toEqual({
      '2026-01': 1_000,
      '2026-02': 1_000,
      '2026-03': 1_000,
    });
  });

  it('reparte una partida de un solo mes entera en ese mes', () => {
    const result = buildPlannedByPeriod([
      {
        budgetAmount: 500,
        plannedStartDate: '2026-06-01',
        plannedEndDate: '2026-06-30',
      },
    ]);
    expect(Object.fromEntries(result)).toEqual({ '2026-06': 500 });
  });

  it('suma varias partidas que solapan mes', () => {
    const result = buildPlannedByPeriod([
      {
        budgetAmount: 1_000,
        plannedStartDate: '2026-01-01',
        plannedEndDate: '2026-01-31',
      },
      {
        budgetAmount: 2_000,
        plannedStartDate: '2026-01-10',
        plannedEndDate: '2026-02-10',
      },
    ]);
    expect(Object.fromEntries(result)).toEqual({
      '2026-01': 2_000,
      '2026-02': 1_000,
    });
  });

  it('ignora una partida con fecha de fin anterior a la de inicio', () => {
    const result = buildPlannedByPeriod([
      {
        budgetAmount: 1_000,
        plannedStartDate: '2026-03-01',
        plannedEndDate: '2026-01-01',
      },
    ]);
    expect(result.size).toBe(0);
  });

  it('ignora una partida sin presupuesto', () => {
    const result = buildPlannedByPeriod([
      {
        budgetAmount: 0,
        plannedStartDate: '2026-01-01',
        plannedEndDate: '2026-01-31',
      },
    ]);
    expect(result.size).toBe(0);
  });
});

describe('computeMargenPrevistoObra', () => {
  it('contrato 100 000 y presupuesto 80 000: margen 20 000 (20 %)', () => {
    const r = computeMargenPrevistoObra({
      contrato: 100_000,
      totalPresupuestado: 80_000,
      margenActualPct: 15,
    });
    expect(r.contrato).toBe(100_000);
    expect(r.totalPresupuestado).toBe(80_000);
    expect(r.margenPrevisto).toBe(20_000);
    expect(r.margenPrevistoPct).toBe(20);
    expect(r.diferenciaPuntos).toBe(-5);
  });

  it('sin contrato no hay margen previsto', () => {
    const r = computeMargenPrevistoObra({
      contrato: null,
      totalPresupuestado: 80_000,
      margenActualPct: 10,
    });
    expect(r.margenPrevisto).toBeNull();
    expect(r.margenPrevistoPct).toBeNull();
    expect(r.diferenciaPuntos).toBeNull();
    expect(r.totalPresupuestado).toBe(80_000);
  });

  it('sin presupuesto (0) no presenta el contrato entero como margen', () => {
    const r = computeMargenPrevistoObra({
      contrato: 100_000,
      totalPresupuestado: 0,
      margenActualPct: 10,
    });
    expect(r.margenPrevisto).toBeNull();
    expect(r.margenPrevistoPct).toBeNull();
  });

  it('margen actual nulo deja la diferencia en nulo', () => {
    const r = computeMargenPrevistoObra({
      contrato: 100_000,
      totalPresupuestado: 80_000,
      margenActualPct: null,
    });
    expect(r.margenPrevistoPct).toBe(20);
    expect(r.diferenciaPuntos).toBeNull();
  });

  it('es exacto en céntimos con strings de numeric', () => {
    const r = computeMargenPrevistoObra({
      contrato: '1000.10',
      totalPresupuestado: '0.30',
      margenActualPct: null,
    });
    expect(r.margenPrevisto).toBe(999.8);
  });

  it('presupuesto mayor que contrato da margen negativo', () => {
    const r = computeMargenPrevistoObra({
      contrato: 100_000,
      totalPresupuestado: 120_000,
      margenActualPct: null,
    });
    expect(r.margenPrevisto).toBe(-20_000);
    expect(r.margenPrevistoPct).toBe(-20);
  });
});

describe('capituloDeCodigo', () => {
  it('toma el texto anterior al primer punto', () => {
    expect(capituloDeCodigo('01.02')).toBe('01');
    expect(capituloDeCodigo(' C03.10.2 ')).toBe('C03');
  });
  it('devuelve null sin punto o con prefijo vacío', () => {
    expect(capituloDeCodigo('CIM')).toBeNull();
    expect(capituloDeCodigo('.5')).toBeNull();
    expect(capituloDeCodigo('')).toBeNull();
  });
});

describe('agruparDesviacionPorCapitulo', () => {
  const fila = (
    phaseId: string | null,
    code: string,
    budget: number,
    actual: number,
  ) => ({
    phaseId,
    code,
    name: `P ${code}`,
    budget,
    actual,
    costes: {
      facturasCompra: actual,
      partesPersonal: 0,
      partesMaquinaria: 0,
      almacen: 0,
      amortizacion: 0,
    },
    deviation: actual - budget,
    deviationPct: budget > 0 ? ((actual - budget) / budget) * 100 : null,
    overBudget: actual > budget,
  });

  it('suma partidas del mismo capítulo y calcula la desviación', () => {
    const r = agruparDesviacionPorCapitulo([
      fila('a', '01.01', 100.1, 50.2),
      fila('b', '01.02', 200.2, 300.3),
      fila('c', '02.01', 50, 10),
    ]);
    expect(r).not.toBeNull();
    expect(r!.map((c) => c.capitulo)).toEqual(['01', '02']);
    expect(r![0].budget).toBe(300.3);
    expect(r![0].actual).toBe(350.5);
    expect(r![0].deviation).toBe(50.2);
    expect(r![0].overBudget).toBe(true);
    expect(r![0].partidas).toHaveLength(2);
    expect(r![1].overBudget).toBe(false);
  });

  it('devuelve null si algún código no tiene capítulo', () => {
    expect(
      agruparDesviacionPorCapitulo([
        fila('a', '01.01', 1, 1),
        fila('b', 'CIM', 1, 1),
      ]),
    ).toBeNull();
  });

  it('devuelve null sin partidas con código', () => {
    expect(agruparDesviacionPorCapitulo([])).toBeNull();
  });

  it('deja la fila "Sin partida" al final como grupo propio', () => {
    const r = agruparDesviacionPorCapitulo([
      fila(null, '', 0, 20),
      fila('a', '01.01', 10, 5),
    ]);
    expect(r!.map((c) => c.capitulo)).toEqual(['01', 'Sin partida']);
  });
});
