import { describe, expect, it } from 'vitest';
import { crearGuardaEnvio } from './envio-unico';

describe('crearGuardaEnvio', () => {
  it('permite un único envío mientras está en curso', () => {
    const g = crearGuardaEnvio();
    expect(g.intentar()).toBe(true);
    expect(g.intentar()).toBe(false);
    expect(g.intentar()).toBe(false);
    expect(g.enCurso()).toBe(true);
  });

  it('vuelve a aceptar envíos tras liberar (éxito o error)', () => {
    const g = crearGuardaEnvio();
    g.intentar();
    g.liberar();
    expect(g.enCurso()).toBe(false);
    expect(g.intentar()).toBe(true);
  });

  it('liberar sin envío previo no rompe el estado', () => {
    const g = crearGuardaEnvio();
    g.liberar();
    expect(g.intentar()).toBe(true);
  });
});
