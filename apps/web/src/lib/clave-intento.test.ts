import { describe, expect, it } from 'vitest';
import { crearClaveIntento } from './clave-intento';

function generadorSecuencial() {
  let n = 0;
  return () => `clave-${++n}`;
}

describe('crearClaveIntento', () => {
  it('reutiliza la misma clave en reintentos y dobles clics del mismo intento', () => {
    const intento = crearClaveIntento(generadorSecuencial());
    const a = intento.actual();
    expect(intento.actual()).toBe(a);
    expect(intento.actual()).toBe(a);
  });

  it('genera una clave nueva al renovar (tras éxito o al reabrir)', () => {
    const intento = crearClaveIntento(generadorSecuencial());
    const a = intento.actual();
    const b = intento.renovar();
    expect(b).not.toBe(a);
    expect(intento.actual()).toBe(b);
  });

  it('usa UUID por defecto y claves distintas entre formularios', () => {
    const x = crearClaveIntento().actual();
    const y = crearClaveIntento().actual();
    expect(x).toMatch(/^[0-9a-f-]{36}$/);
    expect(x).not.toBe(y);
  });
});
