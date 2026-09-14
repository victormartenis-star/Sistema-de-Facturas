import { describe, expect, it } from 'vitest';
import {
  computeDeviationVsTarget,
  computeLineTotal,
  computeOfertaTotal,
  findCheapestOfertaId,
} from './comparativos';

describe('computeLineTotal', () => {
  it('multiplica precio unitario por medición', () => {
    expect(computeLineTotal(12.5, 100)).toBe(1250);
  });

  it('redondea a 2 decimales', () => {
    expect(computeLineTotal(3.333, 3)).toBe(10);
  });
});

describe('computeOfertaTotal', () => {
  it('suma los importes de línea', () => {
    expect(computeOfertaTotal([100, 250.5, 49.5])).toBe(400);
  });

  it('devuelve 0 sin líneas', () => {
    expect(computeOfertaTotal([])).toBe(0);
  });
});

describe('computeDeviationVsTarget', () => {
  it('desviación positiva = oferta más cara que el objetivo', () => {
    const { deviation, deviationPct } = computeDeviationVsTarget(1100, 1000);
    expect(deviation).toBe(100);
    expect(deviationPct).toBe(10);
  });

  it('desviación negativa = oferta más barata que el objetivo', () => {
    const { deviation, deviationPct } = computeDeviationVsTarget(900, 1000);
    expect(deviation).toBe(-100);
    expect(deviationPct).toBe(-10);
  });

  it('deviationPct es null si el objetivo es 0', () => {
    expect(computeDeviationVsTarget(500, 0).deviationPct).toBeNull();
  });
});

describe('findCheapestOfertaId', () => {
  it('devuelve la oferta de menor importe', () => {
    const id = findCheapestOfertaId([
      { ofertaId: 'a', totalAmount: 1200 },
      { ofertaId: 'b', totalAmount: 950 },
      { ofertaId: 'c', totalAmount: 1000 },
    ]);
    expect(id).toBe('b');
  });

  it('devuelve null sin ofertas', () => {
    expect(findCheapestOfertaId([])).toBeNull();
  });

  it('en empate, devuelve la primera', () => {
    const id = findCheapestOfertaId([
      { ofertaId: 'x', totalAmount: 500 },
      { ofertaId: 'y', totalAmount: 500 },
    ]);
    expect(id).toBe('x');
  });
});
