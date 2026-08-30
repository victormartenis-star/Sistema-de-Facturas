import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  USER_ROLES,
  can,
  capabilitiesOf,
  isProjectScoped,
} from './auth';

describe('reparto de capacidades', () => {
  it('Dirección tiene todas', () => {
    for (const c of CAPABILITIES) {
      expect(can('direccion', c)).toBe(true);
    }
  });

  it('solo Dirección gestiona usuarios', () => {
    const gestores = USER_ROLES.filter((r) => can(r, 'usuarios.gestionar'));
    expect(gestores).toEqual(['direccion']);
  });

  it('compras emite pedidos; obra no', () => {
    // La regla de oro exige centralizar las compras en el departamento.
    expect(can('compras', 'pedidos.emitir')).toBe(true);
    expect(can('jefe_obra', 'pedidos.emitir')).toBe(false);
    expect(can('jefe_grupo', 'pedidos.emitir')).toBe(false);
    expect(can('encargado', 'pedidos.emitir')).toBe(false);
  });

  it('quien registra un modificado no lo aprueba', () => {
    expect(can('jefe_obra', 'modificados.registrar')).toBe(true);
    expect(can('jefe_obra', 'modificados.aprobar')).toBe(false);
    expect(can('jefe_grupo', 'modificados.aprobar')).toBe(false);
    expect(can('direccion', 'modificados.aprobar')).toBe(true);
  });

  it('el encargado valida albaranes pero no ve dinero de la empresa', () => {
    expect(can('encargado', 'albaranes.validar')).toBe(true);
    expect(can('encargado', 'economico.ver')).toBe(false);
    expect(can('encargado', 'tesoreria.gestionar')).toBe(false);
    expect(can('encargado', 'facturas.gestionar')).toBe(false);
  });

  it('Estudios define el presupuesto y el coste objetivo', () => {
    expect(can('estudios', 'presupuesto.definir')).toBe(true);
    // pero no toca facturas ni tesorería
    expect(can('estudios', 'facturas.gestionar')).toBe(false);
    expect(can('estudios', 'tesoreria.gestionar')).toBe(false);
  });

  it('Administración lleva facturas y tesorería, no pedidos', () => {
    expect(can('administracion', 'facturas.gestionar')).toBe(true);
    expect(can('administracion', 'tesoreria.gestionar')).toBe(true);
    expect(can('administracion', 'pedidos.emitir')).toBe(false);
  });

  it('el jefe de obra declara la previsión de coste pendiente', () => {
    expect(can('jefe_obra', 'prevision.declarar')).toBe(true);
    expect(can('jefe_grupo', 'prevision.declarar')).toBe(true);
    expect(can('encargado', 'prevision.declarar')).toBe(false);
  });

  it('todo el mundo puede subir documentos', () => {
    for (const r of USER_ROLES) {
      expect(can(r, 'documentos.subir')).toBe(true);
    }
  });

  it('ningún rol se queda sin capacidades', () => {
    for (const r of USER_ROLES) {
      expect(capabilitiesOf(r).length).toBeGreaterThan(0);
    }
  });

  it('capabilitiesOf devuelve una copia, no la lista interna', () => {
    const caps = capabilitiesOf('encargado');
    caps.push('usuarios.gestionar');
    expect(can('encargado', 'usuarios.gestionar')).toBe(false);
  });
});

describe('alcance por obra', () => {
  it('los roles de obra solo ven las suyas', () => {
    expect(isProjectScoped('jefe_grupo')).toBe(true);
    expect(isProjectScoped('jefe_obra')).toBe(true);
    expect(isProjectScoped('encargado')).toBe(true);
  });

  it('los roles transversales ven todas', () => {
    // Compras trabaja con todas las obras a la vez y Administración las
    // factura todas: limitarlos por obra les impediría trabajar.
    expect(isProjectScoped('compras')).toBe(false);
    expect(isProjectScoped('administracion')).toBe(false);
    expect(isProjectScoped('estudios')).toBe(false);
    expect(isProjectScoped('direccion')).toBe(false);
  });
});
