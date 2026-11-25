import { describe, expect, it } from 'vitest';
import { parseLotes } from './lotes';

describe('parseLotes', () => {
  it('vacío: sin lotes (FEFO en salidas)', () => {
    expect(parseLotes('')).toBeUndefined();
    expect(parseLotes('  ,  ')).toBeUndefined();
    expect(parseLotes(undefined)).toBeUndefined();
  });

  it('lotes con cantidad y caducidad; series sin cantidad', () => {
    expect(parseLotes('L1:4:2027-03-31, L2:6')).toEqual([
      { codigo: 'L1', cantidad: 4, caducidad: '2027-03-31' },
      { codigo: 'L2', cantidad: 6 },
    ]);
    expect(parseLotes('SN-1, SN-2\nSN-3')).toEqual([
      { codigo: 'SN-1', cantidad: 1 },
      { codigo: 'SN-2', cantidad: 1 },
      { codigo: 'SN-3', cantidad: 1 },
    ]);
  });

  it('coma decimal en la cantidad', () => {
    expect(parseLotes('L1:2,5; L2:1')).toEqual([
      { codigo: 'L1', cantidad: 2.5 },
      { codigo: 'L2', cantidad: 1 },
    ]);
  });
});
