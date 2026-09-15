import { describe, expect, it } from 'vitest';
import { computeCommercializationPct } from './real-estate';

describe('computeCommercializationPct', () => {
  it('devuelve 0/0 sin unidades', () => {
    expect(computeCommercializationPct([])).toEqual({
      vendidasPct: 0,
      entregadasPct: 0,
    });
  });

  it('cuenta vendida y entregada como vendida; solo entregada cuenta para entregadasPct', () => {
    const units = [
      { status: 'disponible' as const },
      { status: 'reservada' as const },
      { status: 'vendida' as const },
      { status: 'entregada' as const },
    ];
    expect(computeCommercializationPct(units)).toEqual({
      vendidasPct: 50,
      entregadasPct: 25,
    });
  });

  it('redondea a un decimal', () => {
    const units = [
      { status: 'vendida' as const },
      { status: 'disponible' as const },
      { status: 'disponible' as const },
    ];
    expect(computeCommercializationPct(units).vendidasPct).toBeCloseTo(33.3, 1);
  });
});
