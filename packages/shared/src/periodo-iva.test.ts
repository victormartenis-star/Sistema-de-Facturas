import { describe, expect, it } from 'vitest';
import { periodoIvaDeFecha, rangoPeriodoIva } from './periodo-iva';

describe('rangoPeriodoIva', () => {
  it('devuelve los cuatro trimestres', () => {
    expect(rangoPeriodoIva('2026-T1')).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(rangoPeriodoIva('2026-T2')).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
    expect(rangoPeriodoIva('2026-T3')).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    });
    expect(rangoPeriodoIva('2026-T4')).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
    });
  });

  it('el año bisiesto no afecta a T1 (marzo termina el 31)', () => {
    expect(rangoPeriodoIva('2024-T1').to).toBe('2024-03-31');
  });

  it.each([
    '2026-T0',
    '2026-T5',
    '2026T1',
    '2026-t1',
    '26-T1',
    '2026-Q1',
    ' 2026-T1',
    '2026-T1 ',
    '',
    '1999-T1',
    '2101-T1',
  ])('rechaza %j', (p) => {
    expect(() => rangoPeriodoIva(p)).toThrow();
  });
});

describe('periodoIvaDeFecha', () => {
  it.each([
    ['2026-03-31', '2026-T1'],
    ['2026-04-01', '2026-T2'],
    ['2026-06-30', '2026-T2'],
    ['2026-07-01', '2026-T3'],
    ['2026-12-31', '2026-T4'],
    ['2026-01-01', '2026-T1'],
    ['2024-02-29', '2024-T1'],
  ])('%s -> %s', (f, p) => {
    expect(periodoIvaDeFecha(f)).toBe(p);
  });

  it.each(['2026-13-01', '2026-02-30', '26-01-01', '2026/01/01', '1999-01-01'])(
    'rechaza %j',
    (f) => {
      expect(() => periodoIvaDeFecha(f)).toThrow();
    },
  );
});
