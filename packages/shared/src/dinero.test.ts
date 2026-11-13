import { describe, expect, it } from 'vitest';
import {
  applyPct,
  centsToNumeric,
  fromCents,
  lineAmountCents,
  mulDivRound,
  sumCents,
  toCents,
  toScaled,
} from './dinero';

describe('toCents', () => {
  it('parsea strings sin pasar por coma flotante', () => {
    expect(toCents('1234.56')).toBe(123456n);
    expect(toCents('-0.01')).toBe(-1n);
    expect(toCents('7')).toBe(700n);
    expect(toCents('.5')).toBe(50n);
  });

  it('absorbe el ruido binario de los number', () => {
    expect(toCents(0.1 + 0.2)).toBe(30n);
    expect(toCents(1.005)).toBe(101n);
    expect(toCents(20.1)).toBe(2010n);
  });

  it('redondea el medio céntimo alejándose de cero', () => {
    expect(toCents('0.005')).toBe(1n);
    expect(toCents('-0.005')).toBe(-1n);
    expect(toCents('0.004')).toBe(0n);
  });

  it('lanza si el valor no es finito o no es numérico', () => {
    expect(() => toCents(NaN)).toThrow();
    expect(() => toCents(Infinity)).toThrow();
    expect(() => toCents('abc')).toThrow();
    expect(() => toCents('')).toThrow();
  });

  it('toScaled admite escala arbitraria', () => {
    expect(toScaled('12.3456', 4)).toBe(123456n);
    expect(toScaled('12.34565', 4)).toBe(123457n);
  });
});

describe('suma exacta', () => {
  it('sumar 1.000 veces 0,10 da exactamente 100,00', () => {
    // En coma flotante: 99.9999999999986
    const total = sumCents(Array.from({ length: 1000 }, () => toCents(0.1)));
    expect(fromCents(total)).toBe(100);
    expect(centsToNumeric(total)).toBe('100.00');
  });
});

describe('mulDivRound', () => {
  it('half-up en positivo y negativo', () => {
    expect(mulDivRound(5n, 1n, 2n)).toBe(3n); // 2,5 → 3
    expect(mulDivRound(-5n, 1n, 2n)).toBe(-3n); // −2,5 → −3
    expect(mulDivRound(4n, 1n, 3n)).toBe(1n);
    expect(mulDivRound(-4n, 1n, 3n)).toBe(-1n);
  });

  it('admite divisor negativo y rechaza el cero', () => {
    expect(mulDivRound(10n, 1n, -4n)).toBe(-3n);
    expect(() => mulDivRound(1n, 1n, 0n)).toThrow();
  });
});

describe('applyPct', () => {
  it('5 % de 20,10 € son 1,01 € (1,005 sube)', () => {
    expect(applyPct(2010n, 5)).toBe(101n);
  });

  it('es simétrico: el negativo da −1,01 €', () => {
    expect(applyPct(-2010n, 5)).toBe(-101n);
  });

  it('admite porcentajes con 2 decimales', () => {
    expect(applyPct(10000n, '21.50')).toBe(2150n);
  });
});

describe('lineAmountCents', () => {
  it('precio(4) × cantidad(4) → céntimos', () => {
    expect(lineAmountCents('12.3456', '3.5')).toBe(4321n); // 43,2096 → 43,21
    expect(lineAmountCents(100, 10)).toBe(100000n);
  });
});

describe('ida y vuelta con numeric(14,2)', () => {
  it.each(['0.00', '0.01', '-0.01', '999999999999.99', '-999999999999.99'])(
    '%s',
    (x) => {
      expect(centsToNumeric(toCents(x))).toBe(x);
    },
  );

  it('fromCents es exacto en los extremos', () => {
    expect(fromCents(toCents('999999999999.99'))).toBe(999999999999.99);
  });
});
