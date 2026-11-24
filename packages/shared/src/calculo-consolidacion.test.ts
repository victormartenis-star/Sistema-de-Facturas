import { describe, expect, it } from 'vitest';
import {
  consolidarEstados,
  eliminacionesIntragrupo,
  posicionTesoreriaGrupo,
  type SociedadConsolidable,
} from './calculo';

/**
 * Matriz: caja 1.000 (5720), capital 600 (1000), ventas 1.000 (7050),
 * compras 600 (6000) → resultado 400. Cuadra: 1.000 = 600 + 400.
 */
const matriz: SociedadConsolidable = {
  companyId: 'M',
  nombre: 'Matriz',
  metodo: 'global',
  participacionPct: 100,
  saldos: [
    { codigo: '5720', saldoDeudor: '1000.00' },
    { codigo: '1000', saldoDeudor: '-600.00' },
    { codigo: '7050', saldoDeudor: '-1000.00' },
    { codigo: '6000', saldoDeudor: '600.00' },
  ],
};

/** Filial: clientes 300 (4300), capital 200, ventas 100 → resultado 100. */
const filial = (
  pct: number,
  metodo: 'global' | 'proporcional' = 'global',
): SociedadConsolidable => ({
  companyId: 'F',
  nombre: 'Filial',
  metodo,
  participacionPct: pct,
  saldos: [
    { codigo: '4300', saldoDeudor: '300.00' },
    { codigo: '1000', saldoDeudor: '-200.00' },
    { codigo: '7050', saldoDeudor: '-100.00' },
  ],
});

describe('consolidarEstados', () => {
  it('agrega por sociedad, grupo PGC y masa; el balance cuadra', () => {
    const r = consolidarEstados({
      sociedades: [matriz, filial(100)],
      ajustes: [],
    });
    expect(r.totales).toMatchObject({
      activo: 1300,
      patrimonio: 800,
      ingresos: 1100,
      gastos: 600,
      resultado: 500,
      descuadreBalance: 0,
    });
    const g7 = r.porGrupo.find((f) => f.clave === '7')!;
    expect(g7).toMatchObject({
      porSociedad: { M: -1000, F: -100 },
      agregado: -1100,
      eliminaciones: 0,
      consolidado: -1100,
    });
    const ingreso = r.porMasa.find((f) => f.clave === 'ingreso')!;
    expect(ingreso.porSociedad).toEqual({ M: 1000, F: 100 });
    expect(r.sociosExternos.patrimonio).toBe(0);
  });

  it('global al 60 %: integra el 100 % y calcula socios externos (40 %)', () => {
    const r = consolidarEstados({
      sociedades: [matriz, filial(60)],
      ajustes: [],
    });
    expect(r.totales.resultado).toBe(500);
    expect(r.sociosExternos).toMatchObject({ patrimonio: 80, resultado: 40 });
    expect(r.resultadoAtribuidoDominante).toBe(460);
  });

  it('proporcional al 33,33 %: escala saldos y lleva el redondeo a patrimonio', () => {
    const r = consolidarEstados({
      sociedades: [matriz, filial(33.33, 'proporcional')],
      ajustes: [],
    });
    // 300 × 33,33 % = 99,99; −200 → −66,66; −100 → −33,33: suma 0 → sin redondeo.
    expect(r.porMasa.find((f) => f.clave === 'activo')!.porSociedad.F).toBe(
      99.99,
    );
    expect(r.totales.descuadreBalance).toBe(0);
    expect(r.sociosExternos.patrimonio).toBe(0);

    const raro = consolidarEstados({
      sociedades: [
        {
          ...filial(50, 'proporcional'),
          saldos: [
            { codigo: '4300', saldoDeudor: '0.01' },
            { codigo: '1000', saldoDeudor: '-0.01' },
          ],
        },
      ],
      ajustes: [],
    });
    // 0,01 × 50 % = 0,01 (half-up) y −0,01 → −0,01: suma 0.
    expect(raro.totales.descuadreBalance).toBe(0);
  });

  it('aplica ajustes cuadrados y rechaza uno descuadrado', () => {
    const r = consolidarEstados({
      sociedades: [matriz, filial(100)],
      ajustes: [
        {
          concepto: 'Eliminación',
          origen: 'automatico',
          lineas: [
            { cuenta: '7050', debe: '100', haber: '0' },
            { cuenta: '6000', debe: '0', haber: '100' },
          ],
        },
      ],
    });
    expect(r.totales).toMatchObject({
      ingresos: 1000,
      gastos: 500,
      resultado: 500,
    });
    expect(r.porGrupo.find((f) => f.clave === '7')!.eliminaciones).toBe(100);
    expect(() =>
      consolidarEstados({
        sociedades: [matriz],
        ajustes: [
          {
            concepto: 'Mal',
            origen: 'manual',
            lineas: [{ cuenta: '7050', debe: '1', haber: '0' }],
          },
        ],
      }),
    ).toThrow(/descuadrado/);
  });

  it('rechaza una participación fuera de rango', () => {
    expect(() =>
      consolidarEstados({ sociedades: [filial(0)], ajustes: [] }),
    ).toThrow(RangeError);
  });
});

describe('eliminacionesIntragrupo', () => {
  it('cuadra: elimina ventas/compras y saldos sin descuadre', () => {
    const { conciliacion, ajustes } = eliminacionesIntragrupo([
      {
        vendedor: 'M',
        comprador: 'F',
        ventas: 500,
        compras: 500,
        cobrar: 605,
        pagar: 605,
      },
    ]);
    expect(conciliacion[0]).toMatchObject({
      descuadre: false,
      diferenciaOperaciones: 0,
    });
    expect(ajustes).toHaveLength(2);
    expect(ajustes[0].lineas).toEqual([
      { cuenta: '7050', debe: '500.00', haber: '0.00' },
      { cuenta: '6000', debe: '0.00', haber: '500.00' },
    ]);
  });

  it('descuadre: cada lado por su importe y la diferencia a 5550', () => {
    const { conciliacion, ajustes } = eliminacionesIntragrupo([
      {
        vendedor: 'M',
        comprador: 'F',
        ventas: 500,
        compras: 450.5,
        cobrar: 605,
        pagar: 0,
      },
    ]);
    expect(conciliacion[0]).toMatchObject({
      descuadre: true,
      diferenciaOperaciones: 49.5,
      diferenciaSaldos: 605,
    });
    expect(ajustes[0].lineas).toContainEqual({
      cuenta: '5550',
      debe: '0.00',
      haber: '49.50',
    });
    expect(ajustes[1].lineas).toContainEqual({
      cuenta: '5550',
      debe: '605.00',
      haber: '0.00',
    });
    // Los ajustes generados cuadran (consolidarEstados no lanza).
    expect(() =>
      consolidarEstados({ sociedades: [matriz], ajustes }),
    ).not.toThrow();
  });

  it('proporcional: escala al % indicado', () => {
    const { conciliacion } = eliminacionesIntragrupo(
      [
        {
          vendedor: 'M',
          comprador: 'F',
          ventas: 1000,
          compras: 1000,
          cobrar: 0,
          pagar: 0,
        },
      ],
      () => 50,
    );
    expect(conciliacion[0].ventas).toBe(500);
  });
});

describe('posicionTesoreriaGrupo', () => {
  it('suma liquidez y cartera externa; los recíprocos intragrupo no cuentan', () => {
    const r = posicionTesoreriaGrupo([
      {
        companyId: 'M',
        metodo: 'global',
        participacionPct: 100,
        liquidez: '1000.10',
        cobrosExternos: 500,
        cobrosIntragrupo: 605,
        pagosExternos: 200,
        pagosIntragrupo: 0,
      },
      {
        companyId: 'F',
        metodo: 'proporcional',
        participacionPct: 50,
        liquidez: '0.20',
        cobrosExternos: 0,
        cobrosIntragrupo: 0,
        pagosExternos: 100,
        pagosIntragrupo: 605,
      },
    ]);
    expect(r).toMatchObject({
      liquidez: 1000.2,
      cobrosPendientes: 500,
      pagosPendientes: 250,
      posicionNeta: 1250.2,
      intragrupoEliminado: { cobros: 605, pagos: 302.5 },
    });
  });
});
