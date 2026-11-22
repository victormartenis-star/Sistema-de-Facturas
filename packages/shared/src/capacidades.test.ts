import { describe, expect, it } from 'vitest';
import { READ_ONLY_ROLES, USER_ROLES, type UserRole } from './auth';
import { ACCIONES_UI, RECURSOS_UI, can } from './capacidades';

describe('can', () => {
  it('sin rol no se permite nada', () => {
    for (const a of ACCIONES_UI) {
      expect(can(null, a, 'factura')).toBe(false);
      expect(can(undefined, a)).toBe(false);
    }
  });

  it('el lector solo puede exportar', () => {
    for (const a of ACCIONES_UI) {
      for (const r of RECURSOS_UI) {
        expect(can('lector', a, r)).toBe(a === 'exportar');
      }
    }
  });

  it('todo rol de solo lectura cumple lo mismo', () => {
    for (const rol of READ_ONLY_ROLES) {
      for (const a of ACCIONES_UI) {
        if (a !== 'exportar') expect(can(rol, a)).toBe(false);
      }
    }
  });

  it('admin, gerente y administracion pueden todo', () => {
    for (const rol of ['admin', 'gerente', 'administracion'] as UserRole[]) {
      for (const a of ACCIONES_UI) {
        for (const r of RECURSOS_UI) expect(can(rol, a, r)).toBe(true);
      }
    }
  });

  it('el rol obra no rectifica ni devuelve', () => {
    expect(can('obra', 'crear', 'factura')).toBe(true);
    expect(can('obra', 'cambiarEstado', 'albaran')).toBe(true);
    expect(can('obra', 'rectificar', 'factura')).toBe(false);
    expect(can('obra', 'rectificar', 'certificacion')).toBe(false);
    expect(can('obra', 'devolver', 'albaran')).toBe(false);
  });

  it('los roles de portal no ven acciones', () => {
    for (const rol of ['subcontrata', 'cliente'] as UserRole[]) {
      for (const a of ACCIONES_UI) expect(can(rol, a, 'factura')).toBe(false);
    }
  });

  it('contabilidad: solo admin, gerente y administración la mutan', () => {
    expect(can('administracion', 'crear', 'contabilidad')).toBe(true);
    expect(can('gerente', 'anular', 'contabilidad')).toBe(true);
    expect(can('obra', 'crear', 'contabilidad')).toBe(false);
    expect(can('lector', 'exportar', 'contabilidad')).toBe(true);
  });

  it('cubre todos los roles definidos', () => {
    for (const rol of USER_ROLES) {
      expect(typeof can(rol, 'crear')).toBe('boolean');
    }
  });
});
