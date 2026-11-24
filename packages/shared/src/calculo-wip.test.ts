import { describe, expect, it } from 'vitest';
import { asientoRegularizacionWip, calcularWip } from './calculo';
import { tipoCuentaPorCodigo } from './contabilidad';
import { transicion } from './maquina-estados';
import { CUENTAS_WIP } from './wip';

/** Suma debe − haber de un asiento (en céntimos) para comprobar el cuadre. */
function cuadre(lineas: { debe: string; haber: string }[]): number {
  return lineas.reduce(
    (s, l) =>
      s + Math.round(Number(l.debe) * 100) - Math.round(Number(l.haber) * 100),
    0,
  );
}

describe('calcularWip', () => {
  it('producción − facturado a origen; regularización respecto del anterior', () => {
    expect(
      calcularWip({
        produccion: '30000.00',
        facturado: '20000.00',
        wipAnterior: '4000.00',
        costeReal: '24000.00',
      }),
    ).toEqual({
      produccion: 30000,
      facturado: 20000,
      wip: 10000,
      wipAnterior: 4000,
      regularizacion: 6000,
      costeReal: 24000,
      margenReconocido: 6000,
      margenReconocidoPct: 20,
    });
  });

  it('facturado por anticipado: WIP negativo; sin producción, margen % nulo', () => {
    const r = calcularWip({
      produccion: 0,
      facturado: '1000.10',
      wipAnterior: 0,
      costeReal: 500,
    });
    expect(r).toMatchObject({
      wip: -1000.1,
      regularizacion: -1000.1,
      margenReconocidoPct: null,
    });
  });

  it('exacto al céntimo (0,1 + 0,2)', () => {
    expect(
      calcularWip({
        produccion: 0.3,
        facturado: 0.1,
        wipAnterior: 0.1,
        costeReal: 0,
      }).regularizacion,
    ).toBe(0.1);
  });
});

describe('asientoRegularizacionWip', () => {
  const C = CUENTAS_WIP;

  it('primer cierre con WIP positivo: 4309 a 7050 (obra)', () => {
    const l = asientoRegularizacionWip(0, '10000.00', C);
    expect(l).toEqual([
      { cuenta: '4309', debe: '10000.00', haber: '0.00', imputaObra: false },
      { cuenta: '7050', debe: '0.00', haber: '10000.00', imputaObra: true },
    ]);
  });

  it('el WIP baja (se factura lo ejecutado): 7050 a 4309 por la diferencia', () => {
    const l = asientoRegularizacionWip('10000', '4000', C);
    expect(l).toEqual([
      { cuenta: '4309', debe: '0.00', haber: '6000.00', imputaObra: false },
      { cuenta: '7050', debe: '6000.00', haber: '0.00', imputaObra: true },
    ]);
  });

  it('cambio de signo: cancela 4309 y abre 4389; siempre cuadra', () => {
    const l = asientoRegularizacionWip('3000', '-2000', C);
    expect(l).toEqual([
      { cuenta: '4309', debe: '0.00', haber: '3000.00', imputaObra: false },
      { cuenta: '4389', debe: '0.00', haber: '2000.00', imputaObra: false },
      { cuenta: '7050', debe: '5000.00', haber: '0.00', imputaObra: true },
    ]);
    expect(cuadre(l)).toBe(0);
    for (const [a, n] of [
      ['-2000', '3000'],
      ['-500.01', '-0.01'],
      ['1234.56', '1234.56'],
      ['0', '-99.99'],
    ]) {
      expect(cuadre(asientoRegularizacionWip(a, n, C))).toBe(0);
    }
  });

  it('sin variación no hay asiento', () => {
    expect(asientoRegularizacionWip('500', '500.00', C)).toEqual([]);
  });
});

describe('cuentas y estados', () => {
  it('438 / 4389 (anticipos de clientes) son pasivo; 4309 activo', () => {
    expect(tipoCuentaPorCodigo('4389')).toBe('pasivo');
    expect(tipoCuentaPorCodigo('438')).toBe('pasivo');
    expect(tipoCuentaPorCodigo('4309')).toBe('activo');
  });

  it('un cierre contabilizado solo puede anularse, y es definitivo', () => {
    expect(transicion('work_in_progress', 'contabilizado', 'anulado')).toBe(
      'anulado',
    );
    expect(() =>
      transicion('work_in_progress', 'anulado', 'contabilizado'),
    ).toThrow();
  });
});
