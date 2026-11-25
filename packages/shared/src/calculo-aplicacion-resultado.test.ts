import { describe, expect, it } from 'vitest';
import {
  aplicacionResultado,
  asientoDevengoComision,
  asientoLiquidacionComision,
  cuentasAnuales,
  devengoComisionAval,
  evmConEstimacion,
  liquidacionComisionContraDevengo,
  partidaPyg,
  reservaLegalMinima,
  tramoDevengoMes,
  type SaldosPatrimonioNeto,
} from './calculo';
import {
  computeDesviacionPorPartida,
  computeMargenBrutoObra,
} from './cost-control';
import {
  APLICACION_RESULTADO_TRANSITIONS,
  ESTADOS_APLICACION_RESULTADO,
} from './aplicacion-resultado';
import { transicion, TransicionInvalidaError } from './maquina-estados';

const saldos = (
  s: Partial<SaldosPatrimonioNeto> = {},
): SaldosPatrimonioNeto => ({
  capital: 10_000,
  reservaLegal: 0,
  reservasVoluntarias: 0,
  remanente: 0,
  negativosAnteriores: 0,
  ...s,
});

describe('aplicación del resultado (129)', () => {
  it('reserva legal mínima: 10 % del beneficio hasta el 20 % del capital', () => {
    expect(
      reservaLegalMinima({
        beneficio: 4999.99,
        capital: 10_000,
        reservaLegal: 0,
      }),
    ).toBe(500);
    expect(
      reservaLegalMinima({
        beneficio: 50_000,
        capital: 10_000,
        reservaLegal: 1_500,
      }),
    ).toBe(500);
    expect(
      reservaLegalMinima({
        beneficio: 50_000,
        capital: 10_000,
        reservaLegal: 2_000,
      }),
    ).toBe(0);
    expect(
      reservaLegalMinima({ beneficio: -10, capital: 10_000, reservaLegal: 0 }),
    ).toBe(0);
  });

  it('beneficio: 1290 al debe contra reservas y dividendo, cuadrado al céntimo', () => {
    const r = aplicacionResultado({
      resultado: '4999.99',
      reparto: [
        { cuenta: '1120', importe: 500 },
        { cuenta: '1130', importe: '2499.99' },
        { cuenta: '5260', importe: 2000 },
      ],
      saldos: saldos(),
    });
    expect(r).toEqual({
      ok: true,
      total: 4999.99,
      reservaLegalMinima: 500,
      lineas: [
        { cuenta: '1290', debe: '4999.99', haber: '0.00' },
        { cuenta: '1120', debe: '0.00', haber: '500.00' },
        { cuenta: '1130', debe: '0.00', haber: '2499.99' },
        { cuenta: '5260', debe: '0.00', haber: '2000.00' },
      ],
    });
  });

  it('rechazos del beneficio: descuadre, reserva legal, destino, compensación y dividendos', () => {
    const base = { resultado: 1000, saldos: saldos() };
    expect(
      aplicacionResultado({
        ...base,
        reparto: [{ cuenta: '1120', importe: 999.99 }],
      }),
    ).toMatchObject({ ok: false, codigo: 'RESULT_APPLICATION_UNBALANCED' });
    expect(
      aplicacionResultado({
        ...base,
        reparto: [{ cuenta: '1130', importe: 1000 }],
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_LEGAL_RESERVE',
      reservaLegalMinima: 100,
    });
    expect(
      aplicacionResultado({
        ...base,
        reparto: [{ cuenta: '5720', importe: 1000 }],
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_INVALID_ACCOUNT',
    });
    expect(
      aplicacionResultado({
        resultado: 1000,
        saldos: saldos({ negativosAnteriores: 300, reservaLegal: 2000 }),
        reparto: [
          { cuenta: '1210', importe: 400 },
          { cuenta: '1130', importe: 600 },
        ],
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_COMPENSATION_EXCEEDS',
    });
    expect(
      aplicacionResultado({
        resultado: 1000,
        saldos: saldos({ negativosAnteriores: 300, reservaLegal: 2000 }),
        reparto: [
          { cuenta: '1210', importe: 200 },
          { cuenta: '5260', importe: 800 },
        ],
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_DIVIDEND_BLOCKED',
    });
    // Compensando todas las pérdidas sí hay dividendo.
    expect(
      aplicacionResultado({
        resultado: 1000,
        saldos: saldos({ negativosAnteriores: 300, reservaLegal: 2000 }),
        reparto: [
          { cuenta: '1210', importe: 300 },
          { cuenta: '5260', importe: 700 },
        ],
      }),
    ).toMatchObject({ ok: true });
    expect(
      aplicacionResultado({ ...base, resultado: 0, reparto: [] }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_ZERO',
    });
  });

  it('pérdida: 1290 al haber contra 1210 o reservas, sin superar su saldo', () => {
    const r = aplicacionResultado({
      resultado: -200,
      saldos: saldos({ reservasVoluntarias: 50 }),
      reparto: [
        { cuenta: '1130', importe: 50 },
        { cuenta: '1210', importe: 150 },
      ],
    });
    expect(r).toMatchObject({
      ok: true,
      lineas: [
        { cuenta: '1290', debe: '0.00', haber: '200.00' },
        { cuenta: '1130', debe: '50.00', haber: '0.00' },
        { cuenta: '1210', debe: '150.00', haber: '0.00' },
      ],
    });
    expect(
      aplicacionResultado({
        resultado: -200,
        saldos: saldos({ reservasVoluntarias: 49.99 }),
        reparto: [
          { cuenta: '1130', importe: 50 },
          { cuenta: '1210', importe: 150 },
        ],
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_RESERVES_INSUFFICIENT',
    });
    expect(
      aplicacionResultado({
        resultado: -200,
        saldos: saldos(),
        reparto: [{ cuenta: '5260', importe: 200 }],
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'RESULT_APPLICATION_INVALID_ACCOUNT',
    });
  });

  it('estados: aplicado → anulado', () => {
    for (const de of ESTADOS_APLICACION_RESULTADO) {
      for (const a of ESTADOS_APLICACION_RESULTADO) {
        if (APLICACION_RESULTADO_TRANSITIONS[de].includes(a)) {
          expect(transicion('result_application', de, a)).toBe(a);
        } else {
          expect(() => transicion('result_application', de, a)).toThrow(
            TransicionInvalidaError,
          );
        }
      }
    }
  });
});

describe('cuentas anuales', () => {
  it('balance por masas que cuadra con el resultado de la PyG', () => {
    const c = cuentasAnuales([
      {
        cuenta: '1000',
        nombre: 'Capital',
        tipo: 'patrimonio',
        debe: 0,
        haber: 10_000,
      },
      {
        cuenta: '2130',
        nombre: 'Maquinaria',
        tipo: 'activo',
        debe: 3_000,
        haber: 0,
      },
      {
        cuenta: '2813',
        nombre: 'AAI maquinaria',
        tipo: 'activo',
        debe: 0,
        haber: 300,
      },
      {
        cuenta: '1700',
        nombre: 'Préstamo LP',
        tipo: 'pasivo',
        debe: 0,
        haber: 2_000,
      },
      {
        cuenta: '4000',
        nombre: 'Proveedores',
        tipo: 'pasivo',
        debe: 0,
        haber: 6_050,
      },
      {
        cuenta: '4300',
        nombre: 'Clientes',
        tipo: 'activo',
        debe: 12_100,
        haber: 0,
      },
      // Capital 10.000; maquinaria 3.000 con préstamo de 2.000; comisión e intereses.
      {
        cuenta: '5720',
        nombre: 'Bancos',
        tipo: 'activo',
        debe: 10_000,
        haber: 1_100.01,
      },
      {
        cuenta: '4770',
        nombre: 'IVA rep.',
        tipo: 'pasivo',
        debe: 0,
        haber: 2_100,
      },
      {
        cuenta: '4720',
        nombre: 'IVA sop.',
        tipo: 'activo',
        debe: 1_050,
        haber: 0,
      },
      {
        cuenta: '7050',
        nombre: 'Obra',
        tipo: 'ingreso',
        debe: 0,
        haber: 10_000,
      },
      {
        cuenta: '6000',
        nombre: 'Compras',
        tipo: 'gasto',
        debe: 5_000,
        haber: 0,
      },
      {
        cuenta: '6810',
        nombre: 'Amortización',
        tipo: 'gasto',
        debe: 300,
        haber: 0,
      },
      { cuenta: '6260', nombre: 'Banco', tipo: 'gasto', debe: 0.01, haber: 0 },
      {
        cuenta: '6620',
        nombre: 'Intereses',
        tipo: 'gasto',
        debe: 100,
        haber: 0,
      },
    ]);
    expect(c.pyg).toMatchObject({
      resultadoExplotacion: 4699.99,
      resultadoFinanciero: -100,
      resultadoAntesImpuestos: 4599.99,
      resultado: 4599.99,
    });
    expect(
      c.pyg.partidas.find((p) => p.clave === 'cifraNegocios')?.importe,
    ).toBe(10000);
    expect(
      c.pyg.partidas.find((p) => p.clave === 'amortizacion')?.importe,
    ).toBe(-300);
    expect(c.balance).toMatchObject({
      activoNoCorriente: { total: 2700 },
      activoCorriente: { total: 22049.99 },
      totalActivo: 24749.99,
      patrimonioNeto: { total: 14599.99 },
      resultadoEjercicio: 4599.99,
      pasivoNoCorriente: { total: 2000 },
      pasivoCorriente: { total: 8150 },
      totalPatrimonioNetoYPasivo: 24749.99,
      cuadra: true,
    });
  });

  it('partidas PyG por grupo', () => {
    expect(partidaPyg('7050')).toBe('cifraNegocios');
    expect(partidaPyg('6780')).toBe('otrosResultados');
    expect(partidaPyg('7780')).toBe('otrosResultados');
    expect(partidaPyg('6954')).toBe('otrosGastosExplotacion');
    expect(partidaPyg('7954')).toBe('excesoProvisiones');
    expect(partidaPyg('6300')).toBe('impuesto');
  });
});

describe('EVM con EAC manual y coste de avales en la economía', () => {
  it('EAC manual manda, nunca por debajo del AC; ETC y TCPI', () => {
    expect(
      evmConEstimacion({
        bac: 100_000,
        ac: 40_000,
        ev: 50_000,
        eacCalculada: 80_000,
        eacManual: null,
      }),
    ).toEqual({
      eac: 80000,
      eacCalculada: 80000,
      origenEac: 'automatica',
      eacAjustadaAlReal: false,
      varianceAtCompletion: 20000,
      etc: 40000,
      tcpi: 1.25,
    });
    expect(
      evmConEstimacion({
        bac: 100_000,
        ac: 40_000,
        ev: 50_000,
        eacCalculada: 80_000,
        eacManual: 120_000,
      }),
    ).toMatchObject({
      eac: 120000,
      origenEac: 'manual',
      varianceAtCompletion: -20000,
      etc: 80000,
      tcpi: 0.63,
    });
    expect(
      evmConEstimacion({
        bac: 100,
        ac: 40,
        ev: 10,
        eacCalculada: 400,
        eacManual: 30,
      }),
    ).toMatchObject({ eac: 40, eacAjustadaAlReal: true, etc: 0, tcpi: null });
  });

  it('el margen y las desviaciones suman el coste de avales', () => {
    const m = computeMargenBrutoObra({
      certificado: 1000,
      facturadoVenta: 0,
      costes: {
        facturasCompra: 100,
        partesPersonal: 0,
        partesMaquinaria: 0,
        avales: '12.34',
      },
    });
    expect(m).toMatchObject({
      costeReal: 112.34,
      margenSobreCertificado: 887.66,
    });
    expect(m.costes.avales).toBe(12.34);
    const d = computeDesviacionPorPartida([
      {
        phaseId: null,
        code: '',
        name: '',
        budget: 0,
        facturasCompra: 0,
        partesPersonal: 0,
        partesMaquinaria: 0,
        avales: 5,
      },
    ]);
    expect(d[0]).toMatchObject({ actual: 5, costes: { avales: 5 } });
  });
});

describe('devengo de comisiones de aval', () => {
  it('tramo del mes dentro de emisión y vencimiento', () => {
    expect(
      tramoDevengoMes({
        periodo: '2026-02',
        emision: '2026-01-10',
        vencimiento: null,
      }),
    ).toEqual({
      desde: '2026-02-01',
      hasta: '2026-02-28',
      dias: 28,
    });
    expect(
      tramoDevengoMes({
        periodo: '2026-01',
        emision: '2026-01-10',
        vencimiento: null,
      }),
    ).toMatchObject({
      desde: '2026-01-10',
      dias: 22,
    });
    expect(
      tramoDevengoMes({
        periodo: '2026-03',
        emision: '2026-01-10',
        vencimiento: '2026-03-15',
      }),
    ).toMatchObject({
      hasta: '2026-03-15',
      dias: 15,
    });
    expect(
      tramoDevengoMes({
        periodo: '2025-12',
        emision: '2026-01-10',
        vencimiento: null,
      }),
    ).toBeNull();
    expect(
      tramoDevengoMes({
        periodo: '2024-02',
        emision: '2024-01-01',
        vencimiento: null,
      })?.dias,
    ).toBe(29);
  });

  it('importe por días: saldo × tasa × días / 365, half-up', () => {
    // 100.000 × 0,75 % × 31 / 365 = 63,6986… → 63,70
    expect(
      devengoComisionAval({ saldoVivo: 100_000, tasaAnualPct: 0.75, dias: 31 }),
    ).toBe(63.7);
    expect(
      devengoComisionAval({ saldoVivo: 100_000, tasaAnualPct: 0.75, dias: 0 }),
    ).toBe(0);
    // Un año completo = la comisión anual exacta.
    expect(
      devengoComisionAval({
        saldoVivo: 100_000,
        tasaAnualPct: 0.75,
        dias: 365,
      }),
    ).toBe(750);
    expect(() =>
      devengoComisionAval({ saldoVivo: 1, tasaAnualPct: 1, dias: -1 }),
    ).toThrow(RangeError);
  });

  it('la liquidación salda primero lo devengado; el exceso es gasto (sin duplicar)', () => {
    expect(
      liquidacionComisionContraDevengo({
        importe: 187.5,
        devengado: 127.4,
        liquidadoContraDevengo: 0,
      }),
    ).toEqual({
      contraDevengo: 127.4,
      aGasto: 60.1,
    });
    expect(
      liquidacionComisionContraDevengo({
        importe: 50,
        devengado: 127.4,
        liquidadoContraDevengo: 100,
      }),
    ).toEqual({
      contraDevengo: 27.4,
      aGasto: 22.6,
    });
    expect(
      asientoLiquidacionComision({ contraDevengo: 27.4, aGasto: 22.6 }),
    ).toEqual([
      { cuenta: '4100', debe: '27.40', haber: '0.00', imputaObra: false },
      { cuenta: '6260', debe: '22.60', haber: '0.00', imputaObra: true },
      { cuenta: '5720', debe: '0.00', haber: '50.00', imputaObra: false },
    ]);
    expect(asientoDevengoComision(63.7)).toEqual([
      { cuenta: '6260', debe: '63.70', haber: '0.00', imputaObra: true },
      { cuenta: '4100', debe: '0.00', haber: '63.70', imputaObra: false },
    ]);
  });
});
