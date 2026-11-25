import { describe, expect, it } from 'vitest';
import {
  aplicacionResultado,
  conciliar,
  devengoComisionAval,
  devengoPorTramos,
  estadoCambiosPatrimonioNeto,
  estadoFlujosEfectivo,
  fechaLimiteAplicacion,
  mesesEntre,
  situacionPatrimonial,
} from './calculo';
import {
  buildCurvaS,
  buildPlannedByPeriod,
  buildPlannedByPeriodCents,
  computeCostControl,
  pvAcumuladoHasta,
} from './cost-control';

describe('validaciones societarias de la aplicación del resultado', () => {
  const base = {
    resultado: 1000,
    saldos: {
      capital: 3000,
      reservaLegal: 600,
      reservasVoluntarias: 0,
      remanente: 0,
      negativosAnteriores: 0,
      patrimonioNeto: 3500,
    },
  };

  it('plazo de seis meses (art. 164 LSC), con confirmación expresa', () => {
    expect(fechaLimiteAplicacion(2025)).toBe('2026-06-30');
    const tarde = aplicacionResultado({
      ...base,
      saldos: { ...base.saldos, patrimonioNeto: undefined },
      reparto: [{ cuenta: '1130', importe: 1000 }],
      plazo: { ejercicio: 2025, fecha: '2026-07-01' },
    });
    expect(tarde).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_DEADLINE_EXCEEDED',
    });
    expect(
      aplicacionResultado({
        ...base,
        reparto: [{ cuenta: '1130', importe: 1000 }],
        plazo: {
          ejercicio: 2025,
          fecha: '2026-07-01',
          aceptarFueraDePlazo: true,
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      aplicacionResultado({
        ...base,
        reparto: [{ cuenta: '1130', importe: 1000 }],
        plazo: { ejercicio: 2025, fecha: '2026-06-30' },
      }),
    ).toMatchObject({ ok: true });
  });

  it('dividendo que deja el PN por debajo del capital (art. 273.2 LSC)', () => {
    // PN 3.500 y capital 3.000: dividendo máximo 500.
    expect(
      aplicacionResultado({
        ...base,
        reparto: [
          { cuenta: '1130', importe: 499.99 },
          { cuenta: '5260', importe: 500.01 },
        ],
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_EQUITY_BELOW_CAPITAL',
    });
    expect(
      aplicacionResultado({
        ...base,
        reparto: [
          { cuenta: '1130', importe: 500 },
          { cuenta: '5260', importe: 500 },
        ],
      }),
    ).toMatchObject({ ok: true });
  });

  it('situación patrimonial: bajo capital y desequilibrio (art. 363 LSC)', () => {
    expect(
      situacionPatrimonial({ patrimonioNeto: 3500, capital: 3000 }),
    ).toEqual({
      bajoCapital: false,
      desequilibrio: false,
      margen: 500,
    });
    expect(
      situacionPatrimonial({ patrimonioNeto: 1499.99, capital: 3000 }),
    ).toMatchObject({
      bajoCapital: true,
      desequilibrio: true,
    });
    expect(
      situacionPatrimonial({ patrimonioNeto: 1500, capital: 3000 }),
    ).toMatchObject({
      desequilibrio: false,
    });
  });
});

describe('ECPN', () => {
  it('saldo inicial, resultado, dividendos, distribución y otras variaciones', () => {
    const r = estadoCambiosPatrimonioNeto({
      movimientos: [
        // Apertura: capital 10.000 y resultado anterior 4.999,99.
        { cuenta: '1000', origen: 'apertura', debe: 0, haber: 10_000 },
        { cuenta: '1290', origen: 'apertura', debe: 0, haber: '4999.99' },
        // Aplicación: 500 legal, 2.499,99 voluntarias, 2.000 dividendo.
        { cuenta: '1290', origen: 'aplicacion', debe: '4999.99', haber: 0 },
        { cuenta: '1120', origen: 'aplicacion', debe: 0, haber: 500 },
        { cuenta: '1130', origen: 'aplicacion', debe: 0, haber: '2499.99' },
        // Ampliación de capital y una reserva manual.
        { cuenta: '1000', origen: 'otro', debe: 0, haber: 1_000 },
        { cuenta: '1130', origen: 'otro', debe: 0, haber: 0.01 },
      ],
      resultadoEjercicio: 800,
      dividendos: 2_000,
    });
    const fila = (k: string) => r.filas.find((f) => f.clave === k)!;
    expect(fila('saldoInicial')).toMatchObject({ total: 14999.99 });
    expect(fila('ingresosGastosReconocidos').importes.resultadoEjercicio).toBe(
      800,
    );
    expect(fila('operacionesSocios')).toMatchObject({
      importes: { capital: 1000, resultadoEjercicio: -2000 },
      total: -1000,
    });
    expect(fila('distribucionResultado')).toMatchObject({
      importes: { reservas: 2999.99, resultadoEjercicio: -2999.99 },
      total: 0,
    });
    expect(fila('otrasVariaciones').total).toBe(0.01);
    expect(r.saldoFinal).toMatchObject({
      importes: { capital: 11000, reservas: 3000, resultadoEjercicio: 800 },
      total: 14800,
    });
  });
});

describe('EFE (indirecto)', () => {
  it('explotación, inversión y financiación cuadran con la variación de 57x', () => {
    const e = estadoFlujosEfectivo({
      efectivoInicial: 1_000,
      movimientos: [
        // Venta cobrada en parte, compra pagada, amortización, compra de
        // maquinaria con préstamo y pago de dividendo.
        { cuenta: '4300', debe: 12_100, haber: 6_000 },
        { cuenta: '7050', debe: 0, haber: 10_000 },
        { cuenta: '4770', debe: 0, haber: 2_100 },
        { cuenta: '5720', debe: 6_000 + 2_000, haber: 5_000 + 3_000 + 500 },
        { cuenta: '6000', debe: 5_000, haber: 0 },
        { cuenta: '6810', debe: 300, haber: 0 },
        { cuenta: '2813', debe: 0, haber: 300 },
        { cuenta: '2130', debe: 3_000, haber: 0 },
        { cuenta: '1700', debe: 0, haber: 2_000 },
        { cuenta: '5260', debe: 500, haber: 0 },
      ],
    });
    expect(e.explotacion).toEqual({
      resultado: 4700,
      ajustes: 300,
      capitalCorriente: -4000,
      total: 1000,
    });
    expect(e).toMatchObject({
      inversion: -3000,
      financiacion: 1500,
      flujoNeto: -500,
      variacionEfectivo: -500,
      efectivoInicial: 1000,
      efectivoFinal: 500,
      cuadra: true,
    });
  });
});

describe('devengo por tramos de saldo', () => {
  const comun = {
    periodo: '2026-03',
    emision: '2026-01-10',
    vencimiento: null,
    tasaAnualPct: 0.75,
  };

  it('saldo constante: coincide con devengoComisionAval', () => {
    const r = devengoPorTramos({
      ...comun,
      saldos: [{ fecha: '2026-01-10', saldo: 100_000 }],
    });
    expect(r.tramos).toHaveLength(1);
    expect(r.importe).toBe(
      devengoComisionAval({ saldoVivo: 100_000, tasaAnualPct: 0.75, dias: 31 }),
    );
    expect(r.importe).toBe(63.7);
  });

  it('liberación a mitad de mes: dos tramos que suman el total exacto', () => {
    const r = devengoPorTramos({
      ...comun,
      saldos: [
        { fecha: '2026-01-10', saldo: 100_000 },
        { fecha: '2026-03-16', saldo: 40_000 },
      ],
    });
    expect(r.tramos).toEqual([
      {
        desde: '2026-03-01',
        hasta: '2026-03-15',
        dias: 15,
        saldo: 100000,
        importe: 30.82,
      },
      {
        desde: '2026-03-16',
        hasta: '2026-03-31',
        dias: 16,
        saldo: 40000,
        importe: 13.15,
      },
    ]);
    // (100.000 × 15 + 40.000 × 16) × 0,75 % / 365 = 43,97
    expect(r.importe).toBe(43.97);
    expect(r.dias).toBe(31);
  });

  it('liberación total: no devenga desde ese día; nada antes de la emisión', () => {
    const r = devengoPorTramos({
      ...comun,
      saldos: [
        { fecha: '2026-01-10', saldo: 100_000 },
        { fecha: '2026-03-11', saldo: 0 },
      ],
    });
    expect(r.tramos).toHaveLength(1);
    expect(r.tramos[0]).toMatchObject({ hasta: '2026-03-10', dias: 10 });
    expect(
      devengoPorTramos({ ...comun, periodo: '2025-12', saldos: [] }),
    ).toEqual({
      tramos: [],
      dias: 0,
      importe: 0,
    });
  });

  it('meses entre dos periodos', () => {
    expect(mesesEntre('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(mesesEntre('2026-03', '2026-02')).toEqual([]);
  });
});

describe('EVM y curva S en céntimos BigInt', () => {
  it('sin ruido binario: 0,1 + 0,2 y CPI/EAC exactos', () => {
    const r = computeCostControl({
      bac: '100000.00',
      ac: '33333.33',
      ev: '50000.00',
      pv: '60000',
    });
    expect(r).toMatchObject({
      cpi: 1.5,
      eac: 66666.66,
      varianceAtCompletion: 33333.34,
      costVariance: 16666.67,
      pv: 60000,
      spi: 0.83,
      scheduleVariance: -10000,
    });
    const curva = buildCurvaS(
      new Map([
        ['2026-01', 0.1],
        ['2026-02', 0.2],
      ]),
      new Map([['2026-02', 1n]]),
    );
    expect(curva.map((p) => p.actualCumulative)).toEqual([0.1, 0.3]);
    expect(curva[1].earnedCumulative).toBe(0.01);
  });

  it('PV: el reparto mensual suma exactamente el presupuesto', () => {
    const cents = buildPlannedByPeriodCents([
      {
        budgetAmount: 100,
        plannedStartDate: '2026-01-15',
        plannedEndDate: '2026-03-10',
      },
    ]);
    expect([...cents.values()].reduce((a, b) => a + b, 0n)).toBe(10_000n);
    expect([
      ...buildPlannedByPeriod([
        {
          budgetAmount: 100,
          plannedStartDate: '2026-01-15',
          plannedEndDate: '2026-03-10',
        },
      ]).values(),
    ]).toEqual([33.34, 33.33, 33.33]);
    expect(pvAcumuladoHasta(cents, '2026-02')).toBe(66.67);
    expect(pvAcumuladoHasta(new Map(), '2026-02')).toBeNull();
  });
});

describe('conciliación auxiliar ↔ mayor', () => {
  it('marca los descuadres', () => {
    expect(
      conciliar([
        {
          clave: 'a',
          etiqueta: 'A',
          cuentas: '4100',
          auxiliar: '102.74',
          mayor: 102.74,
        },
        {
          clave: 'b',
          etiqueta: 'B',
          cuentas: '281x',
          auxiliar: 300,
          mayor: 300.01,
        },
      ]),
    ).toMatchObject({
      cuadra: false,
      descuadres: 1,
      partidas: [{ cuadra: true }, { diferencia: 0.01, cuadra: false }],
    });
  });
});
