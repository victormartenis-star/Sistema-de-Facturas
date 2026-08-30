import { describe, expect, it } from 'vitest';
import {
  buildMonthlyEvolution,
  computeMarginAtCompletion,
  computeProbableCost,
  deviationLight,
  forecastBias,
} from './forecast';

describe('computeProbableCost', () => {
  it('suma los cuatro estados del coste sin solaparlos', () => {
    const c = computeProbableCost({
      invoicedCost: 400_000,
      accruedCost: 123_500,
      committedCost: 45_000,
      pendingToContract: 900_000,
    });
    expect(c.incurredCost).toBe(523_500); // facturado + recibido sin facturar
    expect(c.total).toBe(1_468_500);
  });

  it('el devengado no incluye lo que todavía no ha llegado a obra', () => {
    // Un pedido emitido y no servido es compromiso, no coste devengado:
    // contarlo como incurrido adelantaría un coste que aún puede anularse.
    const c = computeProbableCost({
      invoicedCost: 100_000,
      accruedCost: 0,
      committedCost: 50_000,
      pendingToContract: 0,
    });
    expect(c.incurredCost).toBe(100_000);
    expect(c.total).toBe(150_000);
  });

  it('una obra sin nada registrado da cero y no NaN', () => {
    const c = computeProbableCost({
      invoicedCost: 0,
      accruedCost: 0,
      committedCost: 0,
      pendingToContract: 0,
    });
    expect(c.total).toBe(0);
    expect(c.incurredCost).toBe(0);
  });
});

describe('computeMarginAtCompletion', () => {
  it('el margen previsto es la venta menos el coste probable', () => {
    const m = computeMarginAtCompletion(10_000_000, 8_500_000, 8_800_000);
    expect(m.margin).toBe(1_200_000);
    expect(m.marginPct).toBe(12);
  });

  it('el desvío se mide contra el coste objetivo, no contra la venta', () => {
    const m = computeMarginAtCompletion(10_000_000, 8_500_000, 8_800_000);
    expect(m.costDeviation).toBe(300_000);
    expect(m.costDeviationPct).toBe(3.53);
  });

  it('un coste probable por debajo del objetivo da desvío negativo', () => {
    const m = computeMarginAtCompletion(10_000_000, 8_500_000, 8_200_000);
    expect(m.costDeviation).toBe(-300_000);
  });

  it('sin coste objetivo no inventa un desvío', () => {
    const m = computeMarginAtCompletion(10_000_000, null, 8_800_000);
    expect(m.costDeviation).toBeNull();
    expect(m.costDeviationPct).toBeNull();
    expect(m.margin).toBe(1_200_000);
  });

  it('una obra en pérdidas da margen negativo, no cero', () => {
    const m = computeMarginAtCompletion(1_000_000, 900_000, 1_150_000);
    expect(m.margin).toBe(-150_000);
    expect(m.marginPct).toBe(-15);
  });
});

describe('deviationLight', () => {
  it('hasta el 2 % está en objetivo', () => {
    expect(deviationLight(0)).toBe('verde');
    expect(deviationLight(2)).toBe('verde');
  });

  it('entre el 2 y el 5 % hay que vigilar', () => {
    expect(deviationLight(2.01)).toBe('ambar');
    expect(deviationLight(5)).toBe('ambar');
  });

  it('por encima del 5 % está desviado', () => {
    expect(deviationLight(5.01)).toBe('rojo');
    expect(deviationLight(40)).toBe('rojo');
  });

  it('gastar menos de lo previsto no enciende el semáforo', () => {
    expect(deviationLight(-12)).toBe('verde');
  });

  it('sin plan no hay semáforo que encender', () => {
    expect(deviationLight(null)).toBe('verde');
  });
});

describe('buildMonthlyEvolution', () => {
  const meses = [
    {
      month: '2026-01-01',
      plannedProduction: 100_000,
      plannedCost: 85_000,
      realProduction: 95_000,
      realCost: 86_000,
    },
    {
      month: '2026-02-01',
      plannedProduction: 100_000,
      plannedCost: 85_000,
      realProduction: 105_000,
      realCost: 95_000,
    },
    {
      month: '2026-03-01',
      plannedProduction: 100_000,
      plannedCost: 85_000,
      realProduction: 100_000,
      realCost: 90_000,
    },
  ];

  it('acumula las cuatro series mes a mes', () => {
    const { rows } = buildMonthlyEvolution(meses);
    expect(rows[2].cumulativePlannedCost).toBe(255_000);
    expect(rows[2].cumulativeRealCost).toBe(271_000);
    expect(rows[2].cumulativeRealProduction).toBe(300_000);
  });

  it('el margen del mes es producción menos coste de ese mes', () => {
    const { rows } = buildMonthlyEvolution(meses);
    expect(rows[0].monthMargin).toBe(9_000);
    expect(rows[1].monthMargin).toBe(10_000);
    expect(rows[2].cumulativeMargin).toBe(29_000);
  });

  it('señala el primer mes en que el coste se separa del plan', () => {
    // Enero: 86.000 vs 85.000 = +1,18 % → verde
    // Febrero: 181.000 vs 170.000 = +6,47 % → rojo
    const { rows, firstDivergenceMonth } = buildMonthlyEvolution(meses);
    expect(rows[0].light).toBe('verde');
    expect(rows[1].light).toBe('rojo');
    expect(firstDivergenceMonth).toBe('2026-02-01');
  });

  it('el mes de divergencia es el primero, no el último que sigue en rojo', () => {
    // Marzo sigue desviado, pero la causa hay que buscarla en febrero.
    const { rows, firstDivergenceMonth } = buildMonthlyEvolution(meses);
    expect(rows[2].light).toBe('rojo');
    expect(firstDivergenceMonth).toBe('2026-02-01');
  });

  it('una obra en objetivo no tiene mes de divergencia', () => {
    const { firstDivergenceMonth } = buildMonthlyEvolution([
      {
        month: '2026-01-01',
        plannedProduction: 100_000,
        plannedCost: 85_000,
        realProduction: 100_000,
        realCost: 85_000,
      },
    ]);
    expect(firstDivergenceMonth).toBeNull();
  });

  it('ordena los meses antes de acumular aunque lleguen desordenados', () => {
    const desordenados = [meses[2], meses[0], meses[1]];
    const { rows } = buildMonthlyEvolution(desordenados);
    expect(rows.map((r) => r.month)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(rows[2].cumulativeRealCost).toBe(271_000);
  });

  it('no muta el array que recibe', () => {
    const original = [meses[2], meses[0], meses[1]];
    const copia = [...original];
    buildMonthlyEvolution(original);
    expect(original).toEqual(copia);
  });

  it('un plan vacío no revienta', () => {
    const { rows, firstDivergenceMonth } = buildMonthlyEvolution([]);
    expect(rows).toEqual([]);
    expect(firstDivergenceMonth).toBeNull();
  });

  it('sin plan pero con coste real no inventa desviación', () => {
    const { rows } = buildMonthlyEvolution([
      {
        month: '2026-01-01',
        plannedProduction: 0,
        plannedCost: 0,
        realProduction: 50_000,
        realCost: 40_000,
      },
    ]);
    expect(rows[0].costDeviationPct).toBeNull();
    expect(rows[0].light).toBe('verde');
    expect(rows[0].monthMargin).toBe(10_000);
  });
});

describe('forecastBias', () => {
  it('detecta la previsión sistemáticamente optimista', () => {
    // Tres meses en los que el coste acabó siendo mayor del previsto
    const bias = forecastBias([
      { forecastTotal: 1_000_000, laterTotal: 1_050_000 },
      { forecastTotal: 1_050_000, laterTotal: 1_100_000 },
      { forecastTotal: 1_100_000, laterTotal: 1_180_000 },
    ]);
    expect(bias.optimisticMonths).toBe(3);
    expect(bias.averageBiasPct).toBeGreaterThan(0);
  });

  it('una previsión ajustada no da sesgo', () => {
    const bias = forecastBias([
      { forecastTotal: 1_000_000, laterTotal: 1_000_000 },
    ]);
    expect(bias.averageBiasPct).toBe(0);
    expect(bias.optimisticMonths).toBe(0);
  });

  it('sin histórico no se pronuncia', () => {
    expect(forecastBias([]).averageBiasPct).toBeNull();
    expect(
      forecastBias([{ forecastTotal: 0, laterTotal: 5 }]).averageBiasPct,
    ).toBeNull();
  });
});
