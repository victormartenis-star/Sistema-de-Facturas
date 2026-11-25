import { describe, expect, it } from 'vitest';
import {
  cuentasAnuales,
  devengoComisionAval,
  devengoPorTramos,
  estadoCambiosPatrimonioNeto,
  estadoFlujosEfectivo,
  mesAnteriorA,
  mesTerminado,
} from './calculo';
import {
  cuentasAnualesACsv,
  cuentasAnualesAJson,
  indicadoresPatrimoniales,
  memoriaAbreviada,
  movimientoMasa,
} from './memoria-abreviada';

const saldos = [
  {
    cuenta: '1000',
    nombre: 'Capital',
    tipo: 'patrimonio' as const,
    debe: 0,
    haber: 10_000,
  },
  {
    cuenta: '2130',
    nombre: 'Maquinaria',
    tipo: 'activo' as const,
    debe: 3_000,
    haber: 0,
  },
  {
    cuenta: '2813',
    nombre: 'AAI',
    tipo: 'activo' as const,
    debe: 0,
    haber: 300,
  },
  {
    cuenta: '1700',
    nombre: 'Préstamo',
    tipo: 'pasivo' as const,
    debe: 0,
    haber: 2_000,
  },
  {
    cuenta: '4000',
    nombre: 'Proveedores',
    tipo: 'pasivo' as const,
    debe: 0,
    haber: 6_050,
  },
  {
    cuenta: '4300',
    nombre: 'Clientes',
    tipo: 'activo' as const,
    debe: 12_100,
    haber: 0,
  },
  {
    cuenta: '5720',
    nombre: 'Bancos',
    tipo: 'activo' as const,
    debe: 12_000,
    haber: 3_100.01,
  },
  {
    cuenta: '4770',
    nombre: 'IVA rep.',
    tipo: 'pasivo' as const,
    debe: 0,
    haber: 2_100,
  },
  {
    cuenta: '4720',
    nombre: 'IVA sop.',
    tipo: 'activo' as const,
    debe: 1_050,
    haber: 0,
  },
  {
    cuenta: '7050',
    nombre: 'Obra',
    tipo: 'ingreso' as const,
    debe: 0,
    haber: 10_000,
  },
  {
    cuenta: '6000',
    nombre: 'Compras',
    tipo: 'gasto' as const,
    debe: 5_000,
    haber: 0,
  },
  {
    cuenta: '6810',
    nombre: 'Amortización',
    tipo: 'gasto' as const,
    debe: 300,
    haber: 0,
  },
  {
    cuenta: '6260',
    nombre: 'Banco',
    tipo: 'gasto' as const,
    debe: 0.01,
    haber: 0,
  },
  {
    cuenta: '6620',
    nombre: 'Intereses',
    tipo: 'gasto' as const,
    debe: 100,
    haber: 0,
  },
];

function caso() {
  const cuentas = cuentasAnuales(saldos);
  const movs = saldos.map((s) => ({ ...s, origen: 'otro' as const }));
  const ecpn = estadoCambiosPatrimonioNeto({
    movimientos: movs.filter((m) => m.tipo === 'patrimonio'),
    resultadoEjercicio: cuentas.pyg.resultado,
    dividendos: 0,
  });
  const efe = estadoFlujosEfectivo({ movimientos: movs, efectivoInicial: 0 });
  const memoria = memoriaAbreviada({
    empresa: 'Constructora Prueba SL',
    ejercicio: 2025,
    cuentas,
    ecpn,
    efe,
    aplicacion: null,
    inmovilizado: movimientoMasa(
      movs,
      (c) => c.startsWith('2') && !c.startsWith('28'),
      'deudora',
    ),
    amortizacionAcumulada: movimientoMasa(
      movs,
      (c) => c.startsWith('28'),
      'acreedora',
    ),
    provisiones: movimientoMasa(
      movs,
      (c) => c.startsWith('499') || c.startsWith('14'),
      'acreedora',
    ),
    garantias: {
      emitidosNumero: 1,
      emitidosSaldoVivo: '40000',
      recibidosNumero: 0,
      recibidosSaldoVivo: 0,
      comisionesDevengadas: '57.53',
    },
    capital: 10_000,
  });
  return { cuentas, ecpn, efe, memoria };
}

describe('memoria abreviada', () => {
  it('notas, cifras, indicadores y comprobaciones de coherencia', () => {
    const { memoria, cuentas } = caso();
    expect(cuentas.balance.cuadra).toBe(true);
    expect(memoria.notas.map((n) => n.numero)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(memoria.notas[4].cifras).toEqual({
      costeFinal: 3000,
      amortizacionFinal: 300,
      valorNeto: 2700,
    });
    expect(memoria.notas[6].cifras).toEqual({
      emitidosSaldoVivo: 40000,
      recibidosSaldoVivo: 0,
    });
    expect(memoria.indicadores).toEqual({
      // AC 22.049,99 − PC 8.150; PN 14.599,99; pasivo 10.150; activo 24.749,99.
      fondoManiobra: 13899.99,
      liquidez: 2.71,
      endeudamiento: 0.7,
      autonomiaPct: 58.99,
    });
    expect(memoria.comprobaciones.every((c) => c.ok)).toBe(true);
    expect(memoria.coherente).toBe(true);
  });

  it('movimiento de una masa: inicial, aumentos, disminuciones y final', () => {
    expect(
      movimientoMasa(
        [
          { cuenta: '2130', origen: 'apertura', debe: 1000, haber: 0 },
          { cuenta: '2130', origen: 'otro', debe: 500, haber: 200 },
          { cuenta: '2130', origen: 'cierre', debe: 0, haber: 1300 },
          { cuenta: '4300', origen: 'otro', debe: 99, haber: 0 },
        ],
        (c) => c.startsWith('2'),
        'deudora',
      ),
    ).toEqual({
      inicial: 1000,
      aumentos: 500,
      disminuciones: 200,
      final: 1300,
    });
  });

  it('indicadores sin pasivo corriente ni PN: null', () => {
    const vacio = cuentasAnuales([]).balance;
    expect(indicadoresPatrimoniales(vacio)).toEqual({
      fondoManiobra: 0,
      liquidez: null,
      endeudamiento: null,
      autonomiaPct: null,
    });
  });
});

describe('exportación determinista', () => {
  it('CSV con secciones y JSON canónico estable', () => {
    const { cuentas, ecpn, efe, memoria } = caso();
    const dto = { ejercicio: 2025, ...cuentas, ecpn, efe, memoria };
    const csv = cuentasAnualesACsv(dto);
    const lineas = csv.trim().split('\r\n');
    expect(lineas[0]).toBe('seccion;partida;concepto;importe');
    expect(lineas).toContain('balance;total_activo;Total activo;24749.99');
    expect(lineas).toContain('pyg;resultado;Resultado del ejercicio;4599.99');
    expect(lineas).toContain('efe;capital_corriente;clientes;-12100.00');
    expect(lineas).toContain('memoria;comprobacion;balance_cuadra;ok');
    expect(cuentasAnualesACsv(dto)).toBe(csv);
    const json = cuentasAnualesAJson(dto);
    expect(cuentasAnualesAJson(JSON.parse(json))).toBe(json);
  });
});

describe('devengo determinista y con cambio de tasa', () => {
  it('mes terminado respecto a una fecha de referencia', () => {
    expect(mesTerminado('2026-10', '2026-11-15')).toBe(true);
    expect(mesTerminado('2026-11', '2026-11-15')).toBe(false);
    expect(mesAnteriorA('2026-01-15')).toBe('2025-12');
    expect(mesAnteriorA('2026-11-30')).toBe('2026-10');
  });

  it('cambio de tasa dentro del mes: dos tramos con su tasa', () => {
    const r = devengoPorTramos({
      periodo: '2026-03',
      emision: '2026-01-10',
      vencimiento: null,
      tasaAnualPct: 0.75,
      saldos: [{ fecha: '2026-01-10', saldo: 100_000 }],
      tasas: [
        { fecha: '2026-01-10', tasaAnualPct: 0.75 },
        { fecha: '2026-03-21', tasaAnualPct: 1.25 },
      ],
    });
    // 100.000 × (0,75 % × 20 + 1,25 % × 11) / 365 = 41,10 + 37,67 = 78,77
    expect(r.tramos).toEqual([
      {
        desde: '2026-03-01',
        hasta: '2026-03-20',
        dias: 20,
        saldo: 100000,
        tasaAnualPct: 0.75,
        importe: 41.1,
      },
      {
        desde: '2026-03-21',
        hasta: '2026-03-31',
        dias: 11,
        saldo: 100000,
        tasaAnualPct: 1.25,
        importe: 37.67,
      },
    ]);
    expect(r.importe).toBe(78.77);
  });

  it('saldo y tasa cambian el mismo mes; tasa constante = devengo simple', () => {
    const r = devengoPorTramos({
      periodo: '2026-03',
      emision: '2026-01-10',
      vencimiento: null,
      tasaAnualPct: 0.75,
      saldos: [
        { fecha: '2026-01-10', saldo: 100_000 },
        { fecha: '2026-03-16', saldo: 40_000 },
      ],
      tasas: [{ fecha: '2026-03-21', tasaAnualPct: 1 }],
    });
    expect(r.tramos.map((t) => [t.desde, t.saldo, t.tasaAnualPct])).toEqual([
      ['2026-03-01', 100000, 0.75],
      ['2026-03-16', 40000, 0.75],
      ['2026-03-21', 40000, 1],
    ]);
    expect(r.tramos.reduce((s, t) => s + Math.round(t.importe * 100), 0)).toBe(
      Math.round(r.importe * 100),
    );
    const constante = devengoPorTramos({
      periodo: '2026-03',
      emision: '2026-01-10',
      vencimiento: null,
      tasaAnualPct: 0.75,
      saldos: [{ fecha: '2026-01-10', saldo: 100_000 }],
      tasas: [{ fecha: '2026-01-10', tasaAnualPct: 0.75 }],
    });
    expect(constante.importe).toBe(
      devengoComisionAval({ saldoVivo: 100_000, tasaAnualPct: 0.75, dias: 31 }),
    );
  });
});
