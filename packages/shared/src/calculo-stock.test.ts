import { describe, expect, it } from 'vitest';
import {
  ErrorStock,
  entradaStock,
  pmpDe,
  regularizacionStock,
  salidaStock,
  traspasoStock,
  valorEntradaStock,
} from './calculo';
import { scaledToNumeric } from './dinero';

const vacio = { cantidad: '0', valor: '0' };

function codigoDe(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErrorStock ? e.codigo : `otro: ${String(e)}`;
  }
  return undefined;
}

describe('scaledToNumeric', () => {
  it('formatea con la escala pedida y signo', () => {
    expect(scaledToNumeric(1234567n, 3)).toBe('1234.567');
    expect(scaledToNumeric(-5n, 3)).toBe('-0.005');
    expect(scaledToNumeric(42n, 0)).toBe('42');
  });
});

describe('valorEntradaStock', () => {
  it('cantidad × coste unitario redondeado al céntimo (half-up)', () => {
    expect(valorEntradaStock('3', '1.3333')).toBe('4.00');
    expect(valorEntradaStock('0.5', '0.0150')).toBe('0.01');
    expect(valorEntradaStock('10', '12.3456')).toBe('123.46');
  });
  it('rechaza cantidad cero o negativa', () => {
    expect(codigoDe(() => valorEntradaStock(0, 5))).toBe(
      'STOCK_QUANTITY_INVALID',
    );
  });
});

describe('entradaStock: PMP = (V0 + Ve) / (Q0 + Qe)', () => {
  it('primera entrada fija el PMP al coste de compra', () => {
    expect(entradaStock(vacio, { cantidad: '100', valor: '1250.00' })).toEqual({
      cantidad: '100.000',
      valor: '1250.00',
      pmp: '12.5000',
    });
  });

  it('segunda entrada pondera por cantidades', () => {
    const s1 = entradaStock(vacio, { cantidad: 100, valor: 1000 });
    const s2 = entradaStock(s1, { cantidad: 50, valor: 650 });
    // (1000 + 650) / 150 = 11
    expect(s2).toEqual({
      cantidad: '150.000',
      valor: '1650.00',
      pmp: '11.0000',
    });
  });

  it('una entrada con cantidad cero se rechaza', () => {
    expect(codigoDe(() => entradaStock(vacio, { cantidad: 0, valor: 0 }))).toBe(
      'STOCK_QUANTITY_INVALID',
    );
  });
});

describe('salidaStock', () => {
  it('valora al PMP vigente y no lo altera', () => {
    const r = salidaStock({ cantidad: '150', valor: '1650.00' }, '40');
    expect(r.valor).toBe('440.00');
    expect(r.saldo).toEqual({
      cantidad: '110.000',
      valor: '1210.00',
      pmp: '11.0000',
    });
  });

  it('PMP no exacto: valor proporcional al céntimo y la última salida se lleva el resto', () => {
    // 3 uds por 10,00 € → PMP 3,3333…
    const s0 = { cantidad: '3', valor: '10.00' };
    expect(pmpDe(s0)).toBe('3.3333');
    const a = salidaStock(s0, 1);
    expect(a.valor).toBe('3.33');
    const b = salidaStock(a.saldo, 1);
    expect(b.valor).toBe('3.34');
    const c = salidaStock(b.saldo, 1);
    expect(c.valor).toBe('3.33');
    expect(c.saldo).toEqual({ cantidad: '0.000', valor: '0.00', pmp: null });
    // Lo que sale suma exactamente lo que entró.
    const total =
      Number(a.valor) * 100 + Number(b.valor) * 100 + Number(c.valor) * 100;
    expect(Math.round(total)).toBe(1000);
  });

  it('rechaza stock negativo con INSUFFICIENT_STOCK y el disponible', () => {
    try {
      salidaStock({ cantidad: '5', valor: '50' }, '5.001');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorStock);
      expect((e as ErrorStock).codigo).toBe('INSUFFICIENT_STOCK');
      expect((e as ErrorStock).disponible).toBe('5.000');
    }
  });

  it('la cantidad reservada no está disponible', () => {
    expect(
      codigoDe(() => salidaStock({ cantidad: 10, valor: 100 }, 8, 3)),
    ).toBe('INSUFFICIENT_STOCK');
    expect(salidaStock({ cantidad: 10, valor: 100 }, 7, 3).valor).toBe('70.00');
  });

  it('rechaza un saldo incoherente (valor sin cantidad)', () => {
    expect(() => salidaStock({ cantidad: 0, valor: 1 }, 1)).toThrow(RangeError);
  });
});

describe('traspasoStock', () => {
  it('sale al PMP del origen y recalcula el PMP del destino; el valor global se conserva', () => {
    const origen = { cantidad: '100', valor: '1000.00' }; // PMP 10
    const destino = { cantidad: '50', valor: '700.00' }; // PMP 14
    const r = traspasoStock(origen, destino, '50');
    expect(r.valor).toBe('500.00');
    expect(r.origen).toEqual({
      cantidad: '50.000',
      valor: '500.00',
      pmp: '10.0000',
    });
    // (700 + 500) / 100 = 12
    expect(r.destino).toEqual({
      cantidad: '100.000',
      valor: '1200.00',
      pmp: '12.0000',
    });
    const antes = 1000 + 700;
    const despues = Number(r.origen.valor) + Number(r.destino.valor);
    expect(despues).toBe(antes);
  });

  it('rechaza traspasar más de lo disponible', () => {
    expect(
      codigoDe(() => traspasoStock({ cantidad: 1, valor: 1 }, vacio, 2)),
    ).toBe('INSUFFICIENT_STOCK');
  });
});

describe('regularizacionStock', () => {
  const teorico = { cantidad: '100', valor: '1000.00' };

  it('faltante: salida al PMP con valor negativo', () => {
    const r = regularizacionStock(teorico, '97.5');
    expect(r.diferencia).toBe('-2.500');
    expect(r.valor).toBe('-25.00');
    expect(r.saldo).toEqual({
      cantidad: '97.500',
      valor: '975.00',
      pmp: '10.0000',
    });
  });

  it('sobrante: entrada al PMP vigente', () => {
    const r = regularizacionStock(teorico, '102');
    expect(r).toMatchObject({ diferencia: '2.000', valor: '20.00' });
    expect(r.saldo.pmp).toBe('10.0000');
  });

  it('sobrante con coste indicado recalcula el PMP', () => {
    const r = regularizacionStock(teorico, 110, { costeUnitario: '21' });
    expect(r.valor).toBe('210.00');
    expect(r.saldo.pmp).toBe('11.0000');
  });

  it('sobrante sin existencias usa el último PMP conocido o exige el coste', () => {
    expect(regularizacionStock(vacio, 4, { pmpReferencia: '2.5' }).valor).toBe(
      '10.00',
    );
    expect(codigoDe(() => regularizacionStock(vacio, 4))).toBe(
      'STOCK_COST_REQUIRED',
    );
  });

  it('recuento igual al teórico no cambia nada; recuento a cero vacía el valor', () => {
    expect(regularizacionStock(teorico, 100)).toMatchObject({
      diferencia: '0.000',
      valor: '0.00',
    });
    expect(regularizacionStock(teorico, 0).saldo).toEqual({
      cantidad: '0.000',
      valor: '0.00',
      pmp: null,
    });
  });

  it('no deja la cantidad por debajo de lo reservado ni acepta recuentos negativos', () => {
    expect(
      codigoDe(() => regularizacionStock(teorico, 5, { reservada: 10 })),
    ).toBe('INSUFFICIENT_STOCK');
    expect(codigoDe(() => regularizacionStock(teorico, -1))).toBe(
      'STOCK_QUANTITY_INVALID',
    );
  });
});
