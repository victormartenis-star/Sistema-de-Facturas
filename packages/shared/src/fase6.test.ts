import { describe, expect, it } from 'vitest';
import {
  ErrorEam,
  costeExplotacion,
  costeOrden,
  diasEnRango,
  estadoPreventivo,
  indicadoresDisponibilidad,
  validarAsignacion,
  validarCierreOrden,
  validarJerarquia,
  validarLectura,
  validarPlan,
} from './eam';
import { can } from './capacidades';
import { transicion } from './maquina-estados';

const codigo = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as ErrorEam).code;
  }
  return null;
};

describe('EAM: jerarquía y contadores', () => {
  it('jerarquía sin ciclos ni más de 5 niveles', () => {
    // a ← b ← c (c es componente de b, b de a)
    const padres = { a: null, b: 'a', c: 'b', d: null };
    expect(() =>
      validarJerarquia({ id: 'd', padreId: 'c', padres }),
    ).not.toThrow();
    expect(
      codigo(() => validarJerarquia({ id: 'a', padreId: 'c', padres })),
    ).toBe('EAM_HIERARCHY_CYCLE');
    expect(
      codigo(() => validarJerarquia({ id: 'a', padreId: 'a', padres })),
    ).toBe('EAM_HIERARCHY_CYCLE');
    expect(
      codigo(() =>
        validarJerarquia({
          id: 'd',
          padreId: 'c',
          padres,
          profundidadSubarbol: 2,
        }),
      ),
    ).toBe('EAM_HIERARCHY_TOO_DEEP');
    expect(() =>
      validarJerarquia({ id: 'a', padreId: null, padres }),
    ).not.toThrow();
  });

  it('lecturas: avance, sin retroceso ni salto imposible, corrección motivada', () => {
    const base = {
      tipo: 'horas' as const,
      anterior: '1200.50',
      fechaAnterior: '2026-11-20',
      hoy: '2026-11-26',
    };
    expect(
      validarLectura({ ...base, valor: 1250.5, fecha: '2026-11-22' }),
    ).toBe(5000n);
    expect(
      codigo(() =>
        validarLectura({ ...base, valor: 1100, fecha: '2026-11-22' }),
      ),
    ).toBe('EAM_COUNTER_BACKWARDS');
    expect(
      codigo(() =>
        validarLectura({ ...base, valor: 1300, fecha: '2026-11-21' }),
      ),
    ).toBe('EAM_COUNTER_IMPLAUSIBLE');
    expect(
      codigo(() =>
        validarLectura({ ...base, valor: 1201, fecha: '2026-11-19' }),
      ),
    ).toBe('EAM_COUNTER_DATE_INVALID');
    expect(
      codigo(() =>
        validarLectura({ ...base, valor: 1201, fecha: '2026-12-01' }),
      ),
    ).toBe('EAM_COUNTER_DATE_INVALID');
    expect(
      codigo(() =>
        validarLectura({
          ...base,
          valor: 1100,
          fecha: '2026-11-22',
          correccion: true,
        }),
      ),
    ).toBe('EAM_COUNTER_REASON_REQUIRED');
    expect(
      validarLectura({
        ...base,
        valor: 1100,
        fecha: '2026-11-22',
        correccion: true,
        motivo: 'Cambio de cuadro',
      }),
    ).toBe(-10050n);
    // Kilómetros: sin límite diario de plausibilidad.
    expect(
      validarLectura({ ...base, tipo: 'km', valor: 9000, fecha: '2026-11-21' }),
    ).toBe(779950n);
    expect(
      validarLectura({
        ...base,
        anterior: null,
        fechaAnterior: null,
        valor: 10,
        fecha: '2026-11-21',
      }),
    ).toBe(1000n);
  });

  it('asignación a obra sin solapes y días en rango', () => {
    const existentes = [{ id: 'x', desde: '2026-11-01', hasta: '2026-11-15' }];
    expect(() =>
      validarAsignacion({ desde: '2026-11-16', hasta: null }, existentes),
    ).not.toThrow();
    expect(
      codigo(() =>
        validarAsignacion({ desde: '2026-11-15', hasta: null }, existentes),
      ),
    ).toBe('EAM_ASSIGNMENT_OVERLAP');
    expect(
      codigo(() =>
        validarAsignacion({ desde: '2026-11-20', hasta: '2026-11-19' }, []),
      ),
    ).toBe('EAM_ASSIGNMENT_DATES');
    expect(() =>
      validarAsignacion(
        { id: 'x', desde: '2026-11-01', hasta: '2026-11-10' },
        existentes,
      ),
    ).not.toThrow();
    expect(
      diasEnRango(
        { desde: '2026-10-20', hasta: '2026-11-05' },
        '2026-11-01',
        '2026-11-30',
      ),
    ).toBe(5);
    expect(
      diasEnRango(
        { desde: '2026-11-20', hasta: null },
        '2026-11-01',
        '2026-11-30',
      ),
    ).toBe(11);
    expect(
      diasEnRango(
        { desde: '2026-12-01', hasta: null },
        '2026-11-01',
        '2026-11-30',
      ),
    ).toBe(0);
  });
});

describe('EAM: preventivo y órdenes', () => {
  it('plan exige intervalo positivo', () => {
    expect(codigo(() => validarPlan({}))).toBe('EAM_PLAN_INTERVAL_REQUIRED');
    expect(codigo(() => validarPlan({ intervaloHoras: 0 }))).toBe(
      'EAM_PLAN_INTERVAL_REQUIRED',
    );
    expect(() => validarPlan({ periodicidadDias: 180 })).not.toThrow();
  });

  it('vencimiento por fecha, por horas y por km: el primero que venza', () => {
    const plan = {
      periodicidadDias: 180,
      intervaloHoras: 500,
      avisoDias: 15,
      avisoHoras: 25,
    };
    const alDia = estadoPreventivo({
      plan,
      ultima: { fecha: '2026-09-01', horas: 1000, km: null },
      actual: { horas: 1200, km: 0 },
      hoy: '2026-11-26',
    });
    expect(alDia).toMatchObject({
      estado: 'al_dia',
      fechaProxima: '2027-02-28',
      horasProximas: 1500,
      horasRestantes: 300,
      diasRestantes: 94,
    });
    const porHoras = estadoPreventivo({
      plan,
      ultima: { fecha: '2026-09-01', horas: 1000, km: null },
      actual: { horas: 1480, km: 0 },
      hoy: '2026-11-26',
    });
    expect(porHoras).toMatchObject({
      estado: 'proximo',
      criterio: 'horas',
      horasRestantes: 20,
    });
    const vencido = estadoPreventivo({
      plan,
      ultima: { fecha: '2026-05-01', horas: 1000, km: null },
      actual: { horas: 1100, km: 0 },
      hoy: '2026-11-26',
    });
    expect(vencido).toMatchObject({ estado: 'vencido', criterio: 'fecha' });
    const km = estadoPreventivo({
      plan: { intervaloKm: 15000 },
      ultima: { fecha: null, horas: null, km: 30000 },
      actual: { horas: 0, km: 45200 },
      hoy: '2026-11-26',
    });
    expect(km).toMatchObject({
      estado: 'vencido',
      criterio: 'km',
      kmProximos: 45000,
      kmRestantes: -200,
    });
    const nunca = estadoPreventivo({
      plan: { periodicidadDias: 365 },
      ultima: { fecha: null, horas: null, km: null },
      actual: { horas: 0, km: 0 },
      hoy: '2026-11-26',
    });
    expect(nunca.estado).toBe('vencido');
  });

  it('ciclo, coste y cierre de la orden', () => {
    expect(transicion('orden_trabajo', 'abierta', 'en_curso')).toBe('en_curso');
    expect(() => transicion('orden_trabajo', 'cerrada', 'en_curso')).toThrow();
    expect(() => transicion('orden_trabajo', 'abierta', 'cerrada')).toThrow();
    expect(
      costeOrden({
        horasManoObra: 3.5,
        tarifaManoObra: 42.15,
        repuestos: '120.40',
        externo: 0,
      }),
    ).toEqual({
      manoObra: 14753n, // 3,5 × 42,15 = 147,525 → 147,53
      repuestos: 12040n,
      externo: 0n,
      total: 26793n,
    });
    expect(codigo(() => costeOrden({ repuestos: -1 }))).toBe(
      'EAM_WO_COST_INVALID',
    );
    expect(() =>
      validarCierreOrden({
        inicio: '2026-11-20',
        fin: '2026-11-21',
        hoy: '2026-11-26',
        horasParada: 48,
      }),
    ).not.toThrow();
    expect(
      codigo(() =>
        validarCierreOrden({
          inicio: '2026-11-20',
          fin: '2026-11-21',
          hoy: '2026-11-26',
          horasParada: 48.01,
        }),
      ),
    ).toBe('EAM_WO_DOWNTIME_INVALID');
    expect(
      codigo(() =>
        validarCierreOrden({
          inicio: '2026-11-20',
          fin: '2026-11-19',
          hoy: '2026-11-26',
        }),
      ),
    ).toBe('EAM_WO_DATES_INVALID');
    expect(
      codigo(() =>
        validarCierreOrden({
          inicio: '2026-11-20',
          fin: '2026-11-27',
          hoy: '2026-11-26',
        }),
      ),
    ).toBe('EAM_WO_DATES_INVALID');
  });
});

describe('EAM: disponibilidad y explotación', () => {
  it('disponibilidad, utilización, MTBF y MTTR exactos', () => {
    const d = indicadoresDisponibilidad({
      dias: 30,
      jornadaHoras: 8,
      horasTrabajadas: '150.50',
      paradas: [
        { horas: 16, correctiva: true },
        { horas: 4, correctiva: true },
        { horas: 8, correctiva: false },
      ],
    });
    expect(d).toEqual({
      horasCalendario: 240,
      horasParada: 28,
      horasDisponibles: 212,
      horasTrabajadas: 150.5,
      disponibilidadPct: 88.33,
      utilizacionPct: 70.99,
      averias: 2,
      mtbfHoras: 75.25,
      mttrHoras: 10,
    });
    const sin = indicadoresDisponibilidad({
      dias: 0,
      jornadaHoras: 8,
      horasTrabajadas: 0,
      paradas: [],
    });
    expect(sin).toMatchObject({ disponibilidadPct: null, mtbfHoras: null });
    const saturada = indicadoresDisponibilidad({
      dias: 1,
      jornadaHoras: 8,
      horasTrabajadas: 0,
      paradas: [{ horas: 24, correctiva: true }],
    });
    expect(saturada).toMatchObject({ horasParada: 8, disponibilidadPct: 0 });
    expect(
      codigo(() =>
        indicadoresDisponibilidad({
          dias: 1,
          jornadaHoras: 25,
          horasTrabajadas: 0,
          paradas: [],
        }),
      ),
    ).toBe('EAM_RANGE_INVALID');
  });

  it('TCO: amortización + mantenimiento frente a lo imputado, coste/hora y cobertura', () => {
    expect(
      costeExplotacion({
        amortizacion: '1000.00',
        mantenimientoOrdenes: '267.93',
        mantenimientoSuelto: 32.07,
        imputadoObras: 1450,
        horasTrabajadas: 150.5,
      }),
    ).toEqual({
      amortizacion: 1000,
      mantenimiento: 300,
      total: 1300,
      imputadoObras: 1450,
      diferencia: 150,
      coberturaPct: 111.54,
      costeHora: 8.64,
    });
    expect(
      costeExplotacion({
        amortizacion: 0,
        mantenimientoOrdenes: 0,
        mantenimientoSuelto: 0,
        imputadoObras: 0,
        horasTrabajadas: 0,
      }),
    ).toMatchObject({ coberturaPct: null, costeHora: null });
  });

  it('permisos: mantenimiento restringido; aviso de avería también obra', () => {
    expect(can('gerente', 'crear', 'mantenimiento')).toBe(true);
    expect(can('obra', 'crear', 'mantenimiento')).toBe(false);
    expect(can('obra', 'crear', 'aviso_averia')).toBe(true);
    expect(can('lector', 'crear', 'aviso_averia')).toBe(false);
  });
});
