import { describe, expect, it } from 'vitest';
import {
  alertRuleUpdateSchema,
  overSobrecosteThreshold,
  withinAlertWindow,
} from './alerts';

describe('withinAlertWindow', () => {
  it('avisa cuando quedan menos días que el umbral', () => {
    expect(withinAlertWindow(10, 30)).toBe(true);
  });

  it('avisa cuando ya caducó (días negativos)', () => {
    expect(withinAlertWindow(-5, 30)).toBe(true);
  });

  it('no avisa fuera de la ventana', () => {
    expect(withinAlertWindow(45, 30)).toBe(false);
  });

  it('el límite exacto sí avisa (<=)', () => {
    expect(withinAlertWindow(30, 30)).toBe(true);
  });
});

describe('overSobrecosteThreshold', () => {
  it('con umbral 0, cualquier sobrecoste avisa', () => {
    expect(overSobrecosteThreshold(0.5, 0)).toBe(true);
    expect(overSobrecosteThreshold(0, 0)).toBe(false);
  });

  it('respeta un umbral mayor que 0', () => {
    expect(overSobrecosteThreshold(4, 5)).toBe(false);
    expect(overSobrecosteThreshold(6, 5)).toBe(true);
  });

  it('sin desviación calculable (null), no avisa', () => {
    expect(overSobrecosteThreshold(null, 0)).toBe(false);
  });
});

describe('alertRuleUpdateSchema', () => {
  it('rechaza un objeto vacío', () => {
    expect(() => alertRuleUpdateSchema.parse({})).toThrow();
  });

  it('acepta actualizar solo el umbral de días', () => {
    expect(alertRuleUpdateSchema.parse({ thresholdDays: 15 })).toEqual({
      thresholdDays: 15,
    });
  });
});
