import { describe, expect, it } from 'vitest';
import {
  centroPorCuenta,
  previsionObra,
  repartoCiclo,
  totalesPrevision,
  varianzaPrevision,
  type EntradaPrevisionObra,
  type EscenarioPrevision,
} from './calculo';
import { toCents } from './dinero';
import {
  cicloRepartoCreateSchema,
  escenarioCreateSchema,
} from './control-analitico';
import { lineaAsientoSchema } from './contabilidad';

const suma = (vs: number[]) => vs.reduce((s, v) => s + toCents(v), 0n);

describe('centroPorCuenta', () => {
  const asignaciones = [
    { prefijo: '62', centroId: 'ADM' },
    { prefijo: '621', centroId: 'PARQUE' },
    { prefijo: '64', centroId: 'RRHH' },
  ];
  it('gana el prefijo más largo y null si no hay asignación', () => {
    expect(centroPorCuenta('6210', asignaciones)).toBe('PARQUE');
    expect(centroPorCuenta('6220', asignaciones)).toBe('ADM');
    expect(centroPorCuenta('6400', asignaciones)).toBe('RRHH');
    expect(centroPorCuenta('6000', asignaciones)).toBeNull();
  });
});

describe('repartoCiclo', () => {
  it('distribución por porcentaje: conserva cuentas y cuadra al céntimo', () => {
    const r = repartoCiclo({
      tipo: 'distribucion',
      emisores: [
        {
          centroId: 'ADM',
          partidas: [
            { cuenta: '6220', importe: '1000.00' },
            { cuenta: '6400', importe: '100.00' },
          ],
        },
      ],
      receptores: [
        { clave: 'obra:A', peso: 33.3333 },
        { clave: 'obra:B', peso: 33.3333 },
        { clave: 'obra:C', peso: 33.3334 },
      ],
    });
    expect(r.totalRepartido).toBe(1100);
    expect(suma(r.lineas.map((l) => l.importe))).toBe(110000n);
    const p6220 = r.lineas.filter((l) => l.cuenta === '6220');
    expect(suma(p6220.map((l) => l.importe))).toBe(100000n);
    // 1.000 × 33,3334 % = 333,334 → C recibe 333,33 y el céntimo de resto
    // va al de mayor fracción; todos los residuos suman lo sobrante.
    expect(p6220.map((l) => l.importe)).toEqual([333.33, 333.33, 333.34]);
    expect(p6220.reduce((s, l) => s + l.residuo, 0)).toBe(1);
    expect(r.porReceptor.find((x) => x.clave === 'obra:C')!.importe).toBe(
      366.68,
    );
    expect(r.cuotas.map((c) => c.pct)).toEqual([33.3333, 33.3333, 33.3334]);
  });

  it('imputación: una sola cuenta secundaria con el saldo total del emisor', () => {
    const r = repartoCiclo({
      tipo: 'imputacion',
      cuentaImputacion: '6290',
      emisores: [
        {
          centroId: 'ADM',
          partidas: [
            { cuenta: '6220', importe: 600 },
            { cuenta: '6400', importe: 400 },
          ],
        },
      ],
      receptores: [
        { clave: 'obra:A', peso: '300000.00' },
        { clave: 'obra:B', peso: '100000.00' },
      ],
    });
    expect(r.lineas).toEqual([
      expect.objectContaining({
        cuenta: '6290',
        receptor: 'obra:A',
        importe: 750,
      }),
      expect.objectContaining({
        cuenta: '6290',
        receptor: 'obra:B',
        importe: 250,
      }),
    ]);
  });

  it('saldo negativo (abono) se reparte con signo y cuadra', () => {
    const r = repartoCiclo({
      tipo: 'distribucion',
      emisores: [
        { centroId: 'ADM', partidas: [{ cuenta: '6220', importe: -100 }] },
      ],
      receptores: [
        { clave: 'obra:A', peso: 1 },
        { clave: 'obra:B', peso: 1 },
        { clave: 'obra:C', peso: 1 },
      ],
    });
    expect(r.lineas.map((l) => l.importe)).toEqual([-33.34, -33.33, -33.33]);
    expect(r.lineas[0].residuo).toBe(-1);
    expect(r.totalRepartido).toBe(-100);
  });

  it('barrido de pesos e importes: nunca pierde ni crea céntimos', () => {
    const pesos = [7, 13, 0.0001, 29.5, 1000];
    for (const imp of ['0.01', '0.07', '999.99', '-12345.67', '100000.03']) {
      const r = repartoCiclo({
        tipo: 'distribucion',
        emisores: [
          { centroId: 'E', partidas: [{ cuenta: '6000', importe: imp }] },
        ],
        receptores: pesos.map((p, i) => ({ clave: `obra:${i}`, peso: p })),
      });
      expect(suma(r.lineas.map((l) => l.importe))).toBe(toCents(imp));
      for (const l of r.lineas)
        expect(Math.abs(l.residuo)).toBeLessThanOrEqual(1);
    }
  });

  it('rechaza sin base, pesos negativos, autorreparto e imputación sin cuenta', () => {
    const emisores = [
      { centroId: 'E', partidas: [{ cuenta: '6000', importe: 10 }] },
    ];
    expect(() =>
      repartoCiclo({
        tipo: 'distribucion',
        emisores,
        receptores: [{ clave: 'obra:A', peso: 0 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      repartoCiclo({
        tipo: 'distribucion',
        emisores,
        receptores: [{ clave: 'obra:A', peso: -1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      repartoCiclo({
        tipo: 'distribucion',
        emisores,
        receptores: [{ clave: 'centro:E', peso: 1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      repartoCiclo({
        tipo: 'imputacion',
        emisores,
        receptores: [{ clave: 'obra:A', peso: 1 }],
      }),
    ).toThrow(RangeError);
  });
});

describe('previsionObra (rolling forecast)', () => {
  const base: EntradaPrevisionObra = {
    contrato: 120000,
    presupuestado: 100000,
    costeReal: 40000,
    indirectos: 4000,
    certificado: 50000,
    costeEstimadoCierre: 100000,
    fechaCorte: '2026-06-30',
    finPrevista: '2026-12-31',
  };
  const esc: EscenarioPrevision = {
    ajusteCostePct: 0,
    ajusteIngresoPct: 0,
    retrasoMeses: 0,
    incluirIndirectos: true,
  };

  it('escenario base: ETC, indirectos proyectados, margen y serie exacta', () => {
    const r = previsionObra(base, esc);
    // ETC = 100.000 − 40.000 = 60.000; tasa de indirectos 10 % → 6.000.
    expect(r).toMatchObject({
      costePendiente: 60000,
      indirectosPendientes: 6000,
      eac: 110000,
      ingresosPendientes: 70000,
      ingresosPrevistos: 120000,
      margen: 10000,
      margenPct: 8.33,
      desviacionPresupuesto: 10000,
      tasaIndirectosPct: 10,
      mesesRestantes: 6,
    });
    expect(r.serie.map((s) => s.mes)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(suma(r.serie.map((s) => s.coste))).toBe(toCents(66000));
    expect(suma(r.serie.map((s) => s.ingreso))).toBe(toCents(70000));
    expect(r.alertas).toEqual(['sobrecoste']);
  });

  it('escenario tensionado: +10 % coste, −5 % ingresos y 3 meses de retraso', () => {
    const r = previsionObra(base, {
      ajusteCostePct: 10,
      ajusteIngresoPct: -5,
      retrasoMeses: 3,
      incluirIndirectos: true,
    });
    expect(r).toMatchObject({
      costePendiente: 66000,
      indirectosPendientes: 6600,
      eac: 116600,
      ingresosPendientes: 66500,
      ingresosPrevistos: 116500,
      margen: -100,
      mesesRestantes: 9,
    });
    expect(r.alertas).toContain('perdida');
  });

  it('sin indirectos, horizonte corto con resto fuera y céntimos repartidos', () => {
    const r = previsionObra(
      { ...base, costeEstimadoCierre: '40000.10', finPrevista: '2027-06-30' },
      { ...esc, incluirIndirectos: false },
      3,
    );
    expect(r.indirectos).toBe(0);
    expect(r.costePendiente).toBe(0.1);
    expect(r.serie).toHaveLength(3);
    expect(r.mesesRestantes).toBe(12);
    const total =
      suma(r.serie.map((s) => s.coste)) + toCents(r.fueraHorizonte.coste);
    expect(total).toBe(10n);
  });

  it('EAC por debajo del real no da ETC negativo; obra vencida y sin presupuesto', () => {
    const r = previsionObra(
      {
        ...base,
        presupuestado: 0,
        costeEstimadoCierre: 30000,
        finPrevista: '2026-03-31',
      },
      esc,
    );
    expect(r.costePendiente).toBe(0);
    expect(r.eac).toBe(44000);
    expect(r.mesesRestantes).toBe(1);
    expect(r.alertas).toEqual(['sin_presupuesto', 'plazo_vencido']);
  });

  it('totales y varianza frente a la línea base, exactos', () => {
    const a = previsionObra(base, esc);
    const b = previsionObra({ ...base, contrato: null, certificado: 0 }, esc);
    const t = totalesPrevision([a, b]);
    expect(t).toMatchObject({
      eac: 220000,
      ingresosPrevistos: 120000,
      margen: -100000,
    });
    expect(
      varianzaPrevision(t, {
        eac: 210000.01,
        ingresosPrevistos: 120000,
        margen: -90000,
      }),
    ).toEqual({
      eac: 9999.99,
      ingresosPrevistos: 0,
      margen: -10000,
    });
  });
});

describe('esquemas de control analítico', () => {
  const ciclo = {
    codigo: 'rep-adm',
    nombre: 'Reparto de administración',
    tipo: 'distribucion' as const,
    criterio: 'porcentaje' as const,
    emisores: ['11111111-1111-4111-8111-111111111111'],
    receptores: [
      { projectId: '22222222-2222-4222-8222-222222222222', pesoPct: 60 },
      { projectId: '33333333-3333-4333-8333-333333333333', pesoPct: 40 },
    ],
  };
  it('ciclo por porcentaje: suma 100 exacta y código normalizado', () => {
    expect(cicloRepartoCreateSchema.parse(ciclo).codigo).toBe('REP-ADM');
    expect(
      cicloRepartoCreateSchema.safeParse({
        ...ciclo,
        receptores: [
          { ...ciclo.receptores[0], pesoPct: 59.9999 },
          ciclo.receptores[1],
        ],
      }).success,
    ).toBe(false);
  });
  it('coherencia: imputación con cuenta, criterios con obras y sin autorreparto', () => {
    expect(
      cicloRepartoCreateSchema.safeParse({ ...ciclo, tipo: 'imputacion' })
        .success,
    ).toBe(false);
    expect(
      cicloRepartoCreateSchema.safeParse({
        ...ciclo,
        tipo: 'imputacion',
        cuentaImputacion: '6290',
      }).success,
    ).toBe(true);
    expect(
      cicloRepartoCreateSchema.safeParse({
        ...ciclo,
        criterio: 'horas',
        receptores: [{ projectId: ciclo.receptores[0].projectId }],
      }).success,
    ).toBe(true);
    expect(
      cicloRepartoCreateSchema.safeParse({
        ...ciclo,
        criterio: 'horas',
        receptores: [{ costCenterId: '44444444-4444-4444-8444-444444444444' }],
      }).success,
    ).toBe(false);
    expect(
      cicloRepartoCreateSchema.safeParse({
        ...ciclo,
        receptores: [{ costCenterId: ciclo.emisores[0], pesoPct: 100 }],
      }).success,
    ).toBe(false);
  });
  it('escenario: ajustes acotados y línea de asiento obra XOR centro', () => {
    expect(
      escenarioCreateSchema.safeParse({
        codigo: 'B',
        nombre: 'Base',
        ajusteCostePct: -101,
      }).success,
    ).toBe(false);
    expect(
      lineaAsientoSchema.safeParse({
        cuenta: '6220',
        debe: 10,
        projectId: '22222222-2222-4222-8222-222222222222',
        costCenterId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });
});
