import { describe, expect, it } from 'vitest';
import {
  asientoEjecucionAval,
  asientosCierreEjercicio,
  costeEstimadoCierreEfectivo,
  cuadroMargenesObra,
  sumarEntradasCuadro,
  validarLineaAval,
  type EntradaCuadroMargenes,
  type LineaCierre,
} from './calculo';
import { diferenciasAuditoria } from './audit';
import { can } from './capacidades';
import {
  CIERRE_EJERCICIO_TRANSITIONS,
  ESTADOS_CIERRE_EJERCICIO,
} from './cierre-ejercicio';
import { transicion, TransicionInvalidaError } from './maquina-estados';

const suma = (l: LineaCierre[], lado: 'debe' | 'haber') =>
  l.reduce((t, x) => t + Math.round(Number(x[lado]) * 100), 0);

const OBRA = 'obra-1';

describe('asientosCierreEjercicio', () => {
  // Libro de un ejercicio: capital 10.000; venta de obra 12.100 (10.000 +
  // IVA); compras 6.050 (5.000 + IVA); comisión de aval 0,01 imputada a la obra.
  const saldos = [
    { cuenta: '5720', projectId: null, debe: '10000', haber: '0' },
    { cuenta: '1000', projectId: null, debe: '0', haber: '10000' },
    { cuenta: '4300', projectId: null, debe: '12100', haber: '0' },
    { cuenta: '7050', projectId: OBRA, debe: '0', haber: '10000' },
    { cuenta: '4770', projectId: null, debe: '0', haber: '2100' },
    { cuenta: '6000', projectId: OBRA, debe: '5000', haber: '0' },
    { cuenta: '4720', projectId: null, debe: '1050', haber: '0' },
    { cuenta: '4000', projectId: null, debe: '0', haber: '6050' },
    { cuenta: '6260', projectId: OBRA, debe: '0.01', haber: '0' },
    { cuenta: '5720', projectId: null, debe: '0', haber: '0.01' },
  ];

  it('regularización: 6 y 7 contra 1290 por cuenta y obra, cuadrada', () => {
    const r = asientosCierreEjercicio(saldos);
    expect(r).toMatchObject({
      ingresos: 10000,
      gastos: 5000.01,
      resultado: 4999.99,
      totalRegularizacion: 10000,
    });
    expect(r.regularizacion).toEqual([
      { cuenta: '6000', projectId: OBRA, debe: '0.00', haber: '5000.00' },
      { cuenta: '6260', projectId: OBRA, debe: '0.00', haber: '0.01' },
      { cuenta: '7050', projectId: OBRA, debe: '10000.00', haber: '0.00' },
      { cuenta: '1290', projectId: null, debe: '0.00', haber: '4999.99' },
    ]);
    expect(suma(r.regularizacion, 'debe')).toBe(
      suma(r.regularizacion, 'haber'),
    );
  });

  it('cierre de balance (con 129) y apertura invertida exacta', () => {
    const r = asientosCierreEjercicio(saldos);
    expect(r.cierre).toEqual([
      { cuenta: '1000', projectId: null, debe: '10000.00', haber: '0.00' },
      { cuenta: '1290', projectId: null, debe: '4999.99', haber: '0.00' },
      { cuenta: '4000', projectId: null, debe: '6050.00', haber: '0.00' },
      { cuenta: '4300', projectId: null, debe: '0.00', haber: '12100.00' },
      { cuenta: '4720', projectId: null, debe: '0.00', haber: '1050.00' },
      { cuenta: '4770', projectId: null, debe: '2100.00', haber: '0.00' },
      { cuenta: '5720', projectId: null, debe: '0.00', haber: '9999.99' },
    ]);
    expect(suma(r.cierre, 'debe')).toBe(suma(r.cierre, 'haber'));
    expect(r.totalCierre).toBe(23149.99);
    expect(r.apertura).toEqual(
      r.cierre.map((l) => ({ ...l, debe: l.haber, haber: l.debe })),
    );
  });

  it('pérdida al debe de 129; cuentas saldadas y libro vacío sin líneas', () => {
    const r = asientosCierreEjercicio([
      { cuenta: '6000', projectId: null, debe: '300', haber: '0' },
      { cuenta: '7050', projectId: null, debe: '0', haber: '100' },
      { cuenta: '5720', projectId: null, debe: '0', haber: '200' },
      { cuenta: '4300', projectId: null, debe: '50', haber: '50' },
    ]);
    expect(r.resultado).toBe(-200);
    expect(r.regularizacion.at(-1)).toEqual({
      cuenta: '1290',
      projectId: null,
      debe: '200.00',
      haber: '0.00',
    });
    expect(r.cierre.map((l) => l.cuenta)).toEqual(['1290', '5720']);
    expect(asientosCierreEjercicio([])).toMatchObject({
      regularizacion: [],
      cierre: [],
      apertura: [],
      resultado: 0,
    });
  });

  it('un libro descuadrado no se cierra', () => {
    expect(() =>
      asientosCierreEjercicio([
        { cuenta: '5720', projectId: null, debe: '10', haber: '0' },
      ]),
    ).toThrow(RangeError);
  });
});

describe('estimación al cierre (EAC)', () => {
  it('automática, manual y ajustada al coste real', () => {
    expect(
      costeEstimadoCierreEfectivo({
        presupuestado: 100,
        consumido: 80,
        costeReal: 50,
        manual: null,
      }),
    ).toEqual({
      automatica: 100,
      efectiva: 100,
      origen: 'automatica',
      ajustadaAlReal: false,
    });
    expect(
      costeEstimadoCierreEfectivo({
        presupuestado: 100,
        consumido: 80,
        costeReal: 50,
        manual: '120.01',
      }),
    ).toMatchObject({
      efectiva: 120.01,
      origen: 'manual',
      ajustadaAlReal: false,
    });
    expect(
      costeEstimadoCierreEfectivo({
        presupuestado: 100,
        consumido: 80,
        costeReal: 60,
        manual: 55,
      }),
    ).toMatchObject({ efectiva: 60, ajustadaAlReal: true });
  });

  const entrada = (
    extra: Partial<EntradaCuadroMargenes> = {},
  ): EntradaCuadroMargenes => ({
    contrato: 1000,
    presupuestado: 800,
    comprometido: { pedidos: 0, subcontratas: 0 },
    costeReal: {
      facturasCompra: 100,
      partesPersonal: 0,
      partesMaquinaria: 0,
      almacen: 0,
      amortizacion: 0,
      avales: '12.50',
    },
    certificado: 0,
    facturado: 0,
    cobrado: 0,
    ...extra,
  });

  it('el cuadro suma el coste de avales y usa la EAC manual en el margen', () => {
    const c = cuadroMargenesObra(entrada({ estimacionCierre: 1100 }));
    expect(c.costeReal).toBe(112.5);
    expect(c.costeRealDesglose.avales).toBe(12.5);
    expect(c).toMatchObject({
      costeEstimadoCierre: 1100,
      costeEstimadoCierreAutomatico: 800,
      origenEstimacion: 'manual',
      margenProyectado: -100,
    });
    // Sin campos nuevos: comportamiento anterior.
    const sin = cuadroMargenesObra({
      ...entrada(),
      costeReal: { ...entrada().costeReal, avales: undefined },
    });
    expect(sin).toMatchObject({
      costeReal: 100,
      costeEstimadoCierre: 800,
      origenEstimacion: 'automatica',
    });
  });

  it('cartera: con alguna manual, el total es la suma de las efectivas', () => {
    const t = cuadroMargenesObra(
      sumarEntradasCuadro([
        entrada({ estimacionCierre: 1100 }),
        entrada({ presupuestado: 500 }),
      ]),
    );
    expect(t.costeEstimadoCierre).toBe(1600);
    expect(t.costeRealDesglose.avales).toBe(25);
  });
});

describe('líneas de avales y financiación de la ejecución', () => {
  it('valida el límite al céntimo', () => {
    expect(
      validarLineaAval({ limite: 1000, dispuesto: '999.98', importe: '0.02' }),
    ).toMatchObject({ ok: true, disponible: 0.02, dispuestoTras: 1000 });
    expect(
      validarLineaAval({ limite: 1000, dispuesto: '999.98', importe: '0.03' }),
    ).toMatchObject({ ok: false });
  });

  it('ejecución emitida financiada: 6780 (obra) a 5200', () => {
    expect(asientoEjecucionAval(500, 'emitido', true)).toEqual([
      { cuenta: '6780', debe: '500.00', haber: '0.00', imputaObra: true },
      { cuenta: '5200', debe: '0.00', haber: '500.00', imputaObra: false },
    ]);
    expect(() => asientoEjecucionAval(500, 'recibido', true)).toThrow(
      RangeError,
    );
  });
});

describe('cierre de ejercicio: estados, permisos y rastro de cambios', () => {
  it('cerrado → revertido; revertido es terminal', () => {
    for (const de of ESTADOS_CIERRE_EJERCICIO) {
      for (const a of ESTADOS_CIERRE_EJERCICIO) {
        if (CIERRE_EJERCICIO_TRANSITIONS[de].includes(a)) {
          expect(transicion('fiscal_year_closing', de, a)).toBe(a);
        } else {
          expect(() => transicion('fiscal_year_closing', de, a)).toThrow(
            TransicionInvalidaError,
          );
        }
      }
    }
  });

  it('solo admin y gerente cierran; la EAC también la fija el jefe de obra', () => {
    expect(can('admin', 'cambiarEstado', 'cierre_ejercicio')).toBe(true);
    expect(can('gerente', 'cambiarEstado', 'cierre_ejercicio')).toBe(true);
    expect(can('administracion', 'cambiarEstado', 'cierre_ejercicio')).toBe(
      false,
    );
    expect(can('obra', 'editar', 'estimacion_cierre')).toBe(true);
    expect(can('lector', 'editar', 'estimacion_cierre')).toBe(false);
  });

  it('diferenciasAuditoria: solo los campos que cambian', () => {
    expect(
      diferenciasAuditoria(
        { limite: '100.00', activa: true, notas: null },
        { limite: '150.00', activa: true, notas: null },
      ),
    ).toEqual([{ campo: 'limite', antes: '100.00', despues: '150.00' }]);
    expect(diferenciasAuditoria(null, { a: 1 }, ['a', 'b'])).toEqual([
      { campo: 'a', antes: null, despues: 1 },
    ]);
  });
});
