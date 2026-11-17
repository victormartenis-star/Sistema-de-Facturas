import { describe, expect, it } from 'vitest';
import {
  accionesCert,
  anchoEjecucion,
  puedeGestionarDinero,
  puedeMedir,
} from './subcontratas';

const c = (
  numero: number,
  status: 'borrador' | 'aprobada' | 'pagada' | 'anulada',
) => ({
  id: `c${numero}`,
  numero,
  status,
});

describe('permisos de la vista de subcontratas', () => {
  it('obra mide pero no gestiona dinero; lector y portal no hacen nada', () => {
    expect(puedeMedir('obra')).toBe(true);
    expect(puedeGestionarDinero('obra')).toBe(false);
    expect(puedeGestionarDinero('administracion')).toBe(true);
    expect(puedeMedir('lector')).toBe(false);
    expect(puedeMedir('subcontrata')).toBe(false);
    expect(puedeMedir(null)).toBe(false);
  });
});

describe('accionesCert', () => {
  it('borrador: obra edita y elimina; administración además aprueba', () => {
    const b = c(1, 'borrador');
    expect(accionesCert(b, [b], 'obra')).toEqual(['editar', 'eliminar']);
    expect(accionesCert(b, [b], 'administracion')).toEqual([
      'editar',
      'eliminar',
      'aprobar',
    ]);
    expect(accionesCert(b, [b], 'lector')).toEqual([]);
  });

  it('aprobada: se paga siempre, se anula solo si es la última no anulada', () => {
    const a1 = c(1, 'aprobada');
    const a2 = c(2, 'aprobada');
    expect(accionesCert(a1, [a1, a2], 'admin')).toEqual(['pagar']);
    expect(accionesCert(a2, [a1, a2], 'admin')).toEqual(['pagar', 'anular']);
    expect(accionesCert(a1, [a1, c(2, 'anulada')], 'admin')).toEqual([
      'pagar',
      'anular',
    ]);
    expect(accionesCert(a2, [a1, a2], 'obra')).toEqual([]);
  });

  it('pagada y anulada no tienen acciones', () => {
    expect(accionesCert(c(1, 'pagada'), [], 'admin')).toEqual([]);
    expect(accionesCert(c(1, 'anulada'), [], 'admin')).toEqual([]);
  });
});

describe('anchoEjecucion', () => {
  it('acota entre 0 y 100', () => {
    expect(anchoEjecucion(42.5)).toBe(42.5);
    expect(anchoEjecucion(130)).toBe(100);
    expect(anchoEjecucion(-1)).toBe(0);
    expect(anchoEjecucion(Number.NaN)).toBe(0);
  });
});
