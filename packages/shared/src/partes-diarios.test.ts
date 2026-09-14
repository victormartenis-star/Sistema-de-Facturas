import { describe, expect, it } from 'vitest';
import {
  computeParteMaquinariaCost,
  computePartePersonalCost,
} from './partes-diarios';

describe('computePartePersonalCost', () => {
  it('calcula horas ordinarias a su tarifa', () => {
    expect(
      computePartePersonalCost({
        ordinaryHours: 8,
        overtimeHours: 0,
        ordinaryRate: 15,
        overtimeRate: 22.5,
      }),
    ).toBe(120);
  });

  it('suma horas extra a su propia tarifa', () => {
    expect(
      computePartePersonalCost({
        ordinaryHours: 8,
        overtimeHours: 2,
        ordinaryRate: 15,
        overtimeRate: 22.5,
      }),
    ).toBe(165); // 8*15 + 2*22.5 = 120 + 45
  });

  it('devuelve 0 sin horas', () => {
    expect(
      computePartePersonalCost({
        ordinaryHours: 0,
        overtimeHours: 0,
        ordinaryRate: 15,
        overtimeRate: 22.5,
      }),
    ).toBe(0);
  });
});

describe('computeParteMaquinariaCost', () => {
  it('calcula horas de uso a la tarifa horaria', () => {
    expect(computeParteMaquinariaCost({ hoursUsed: 6.5, hourlyRate: 40 })).toBe(
      260,
    );
  });

  it('redondea a 2 decimales', () => {
    expect(
      computeParteMaquinariaCost({ hoursUsed: 1 / 3, hourlyRate: 30 }),
    ).toBe(10);
  });
});
