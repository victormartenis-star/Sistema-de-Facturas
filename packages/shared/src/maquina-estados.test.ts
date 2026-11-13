import { describe, expect, it } from 'vitest';
import {
  motivoTransicionInvalida,
  puedeTransitar,
  type Transiciones,
} from './maquina-estados';

type S = 'a' | 'b' | 'c';
const T: Transiciones<S> = { a: ['b'], b: ['c'], c: [] };
const ETIQUETAS: Record<S, string> = { a: 'A', b: 'B', c: 'C' };

describe('puedeTransitar', () => {
  it('solo permite las transiciones declaradas', () => {
    expect(puedeTransitar(T, 'a', 'b')).toBe(true);
    expect(puedeTransitar(T, 'a', 'c')).toBe(false);
    expect(puedeTransitar(T, 'c', 'a')).toBe(false);
  });

  it('mantenerse en el mismo estado no es una transición', () => {
    expect(puedeTransitar(T, 'a', 'a')).toBe(false);
  });
});

describe('motivoTransicionInvalida', () => {
  it('devuelve null si es válida', () => {
    expect(
      motivoTransicionInvalida(T, 'a', 'b', ETIQUETAS, 'el doc'),
    ).toBeNull();
  });

  it('devuelve un mensaje listo para el 409 si no lo es', () => {
    const m = motivoTransicionInvalida(T, 'b', 'a', ETIQUETAS, 'el doc');
    expect(m).toContain('el doc');
    expect(m).toContain('B');
    expect(m).toContain('A');
  });

  it('distingue el estado terminal', () => {
    expect(
      motivoTransicionInvalida(T, 'c', 'b', ETIQUETAS, 'el doc'),
    ).toContain('terminal');
  });
});
