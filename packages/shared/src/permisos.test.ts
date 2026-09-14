import { describe, expect, it } from 'vitest';
import { computePermisoAlertLevel, computePermisoAlerts } from './permisos';

const HOY = '2026-09-14';

describe('computePermisoAlertLevel', () => {
  it('null si el permiso no está concedido', () => {
    expect(
      computePermisoAlertLevel(
        { status: 'en_tramite', fechaVencimiento: '2026-09-20' },
        HOY,
      ),
    ).toBeNull();
  });

  it('null si no tiene fecha de vencimiento (p. ej. licencia de obra sin caducidad)', () => {
    expect(
      computePermisoAlertLevel(
        { status: 'concedido', fechaVencimiento: null },
        HOY,
      ),
    ).toBeNull();
  });

  it('vencido si la fecha ya pasó', () => {
    expect(
      computePermisoAlertLevel(
        { status: 'concedido', fechaVencimiento: '2026-01-01' },
        HOY,
      ),
    ).toBe('vencido');
  });

  it('próximo a vencer dentro del horizonte', () => {
    expect(
      computePermisoAlertLevel(
        { status: 'concedido', fechaVencimiento: '2026-09-30' },
        HOY,
      ),
    ).toBe('proximo_vencimiento');
  });

  it('null si falta mucho para vencer', () => {
    expect(
      computePermisoAlertLevel(
        { status: 'concedido', fechaVencimiento: '2026-12-31' },
        HOY,
      ),
    ).toBeNull();
  });
});

describe('computePermisoAlerts', () => {
  it('filtra los que no requieren aviso y ordena por urgencia', () => {
    const alertas = computePermisoAlerts(
      [
        {
          id: 'a',
          projectId: 'p1',
          tipo: 'vado',
          organismoPublico: 'Ayuntamiento',
          status: 'concedido',
          fechaVencimiento: '2026-09-30',
        },
        {
          id: 'b',
          projectId: 'p1',
          tipo: 'licencia_obra',
          organismoPublico: 'Ayuntamiento',
          status: 'concedido',
          fechaVencimiento: '2026-01-01',
        },
        {
          id: 'c',
          projectId: 'p1',
          tipo: 'ocupacion_via_publica',
          organismoPublico: 'Ayuntamiento',
          status: 'en_tramite',
          fechaVencimiento: '2026-09-15',
        },
        {
          id: 'd',
          projectId: 'p1',
          tipo: 'gestion_residuos',
          organismoPublico: 'Ayuntamiento',
          status: 'concedido',
          fechaVencimiento: '2027-01-01',
        },
      ],
      HOY,
    );

    expect(alertas.map((a) => a.id)).toEqual(['b', 'a']);
    expect(alertas[0].level).toBe('vencido');
    expect(alertas[1].level).toBe('proximo_vencimiento');
  });
});
