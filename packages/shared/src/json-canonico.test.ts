import { describe, expect, it } from 'vitest';
import { jsonCanonico } from './json-canonico';

describe('jsonCanonico', () => {
  it('ordena las claves de objetos de forma recursiva', () => {
    expect(jsonCanonico({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('mismo objeto con claves en otro orden produce la misma cadena', () => {
    const x = { a: 1, b: [{ y: 1, x: 2 }], c: { q: null, p: 'z' } };
    const y = { c: { p: 'z', q: null }, b: [{ x: 2, y: 1 }], a: 1 };
    expect(jsonCanonico(x)).toBe(jsonCanonico(y));
  });

  it('respeta el orden de los arrays (es significativo)', () => {
    expect(jsonCanonico([1, 2])).not.toBe(jsonCanonico([2, 1]));
  });

  it('distingue valores distintos', () => {
    expect(jsonCanonico({ a: 1 })).not.toBe(jsonCanonico({ a: 2 }));
    expect(jsonCanonico({ a: '1' })).not.toBe(jsonCanonico({ a: 1 }));
  });

  it('omite undefined en objetos igual que JSON.stringify y soporta primitivos', () => {
    expect(jsonCanonico({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(jsonCanonico(null)).toBe('null');
    expect(jsonCanonico(undefined)).toBe('null');
    expect(jsonCanonico('x')).toBe('"x"');
  });
});
