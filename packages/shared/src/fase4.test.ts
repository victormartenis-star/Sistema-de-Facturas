import { describe, expect, it } from 'vitest';
import { can } from './capacidades';
import { planContableBase } from './contabilidad';
import { transicion } from './maquina-estados';
import {
  aplicarModificado,
  motivoReduccionAvalSustituto,
  planLiberacionRetenciones,
  resumenRetencionesObra,
} from './project-system';
import {
  efectosTransicionTalon,
  importeTalon,
  numeroTalon,
  siguienteTalon,
  validarFechaTalon,
  validarTalonario,
} from './talones';
import { PAYMENT_INSTRUMENTS } from './treasury';

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { codigo?: string }).codigo ?? 'otro';
  }
  return null;
};

describe('talonarios y talones', () => {
  it('rango válido, sin solapes y con tamaño máximo', () => {
    expect(
      codigo(() => validarTalonario({ primero: 1, ultimo: 50 })),
    ).toBeNull();
    expect(codigo(() => validarTalonario({ primero: 50, ultimo: 10 }))).toBe(
      'CHECK_BOOK_RANGE_INVALID',
    );
    expect(codigo(() => validarTalonario({ primero: 0, ultimo: 10 }))).toBe(
      'CHECK_BOOK_RANGE_INVALID',
    );
    expect(codigo(() => validarTalonario({ primero: 1, ultimo: 20_000 }))).toBe(
      'CHECK_BOOK_RANGE_INVALID',
    );
    expect(
      codigo(() =>
        validarTalonario({ primero: 40, ultimo: 60 }, [
          { primero: 1, ultimo: 50 },
        ]),
      ),
    ).toBe('CHECK_BOOK_OVERLAP');
    expect(
      codigo(() =>
        validarTalonario({ primero: 51, ultimo: 60 }, [
          { primero: 1, ultimo: 50 },
        ]),
      ),
    ).toBeNull();
  });

  it('numeración y agotamiento', () => {
    expect(numeroTalon('BBVA-', 42)).toBe('BBVA-0000042');
    expect(
      siguienteTalon({ estado: 'activo', siguiente: 49, ultimo: 50 }),
    ).toEqual({ secuencia: 49, agotadoTras: false });
    expect(
      siguienteTalon({ estado: 'activo', siguiente: 50, ultimo: 50 }),
    ).toEqual({ secuencia: 50, agotadoTras: true });
    expect(
      codigo(() =>
        siguienteTalon({ estado: 'activo', siguiente: 51, ultimo: 50 }),
      ),
    ).toBe('CHECK_BOOK_EXHAUSTED');
    expect(
      codigo(() =>
        siguienteTalon({ estado: 'agotado', siguiente: 1, ultimo: 50 }),
      ),
    ).toBe('CHECK_BOOK_EXHAUSTED');
    expect(
      codigo(() =>
        siguienteTalon({ estado: 'anulado', siguiente: 1, ultimo: 50 }),
      ),
    ).toBe('CHECK_BOOK_INACTIVE');
  });

  it('ciclo de vida: efectos contables de cada transición', () => {
    expect(efectosTransicionTalon('emitido', 'entregado')).toEqual({
      compensar: false,
      revertirCompensacion: false,
      anularLiquidacion: false,
    });
    expect(efectosTransicionTalon('entregado', 'cobrado')).toEqual({
      compensar: true,
      revertirCompensacion: false,
      anularLiquidacion: false,
    });
    expect(efectosTransicionTalon('emitido', 'anulado')).toEqual({
      compensar: false,
      revertirCompensacion: false,
      anularLiquidacion: true,
    });
    expect(
      efectosTransicionTalon('entregado', 'detenido').anularLiquidacion,
    ).toBe(true);
    expect(efectosTransicionTalon('cobrado', 'devuelto')).toEqual({
      compensar: false,
      revertirCompensacion: true,
      anularLiquidacion: true,
    });
    // No se anula dos veces ni se compensa lo anulado.
    expect(codigo(() => efectosTransicionTalon('anulado', 'anulado'))).toBe(
      'CHECK_INVALID_TRANSITION',
    );
    expect(codigo(() => efectosTransicionTalon('anulado', 'cobrado'))).toBe(
      'CHECK_INVALID_TRANSITION',
    );
    expect(codigo(() => efectosTransicionTalon('cobrado', 'anulado'))).toBe(
      'CHECK_INVALID_TRANSITION',
    );
    expect(codigo(() => efectosTransicionTalon('emitido', 'detenido'))).toBe(
      'CHECK_INVALID_TRANSITION',
    );
    expect(() => transicion('check', 'devuelto', 'cobrado')).toThrow();
  });

  it('fechas: no futuras, no antes de la emisión y no se compensa antes de la fecha de pago', () => {
    const base = {
      hoy: '2026-11-26',
      emision: '2026-11-10',
      vencimiento: '2026-11-20',
    };
    expect(
      codigo(() =>
        validarFechaTalon({
          ...base,
          fecha: '2026-11-27',
          operacion: 'emitir',
        }),
      ),
    ).toBe('CHECK_DATE_INVALID');
    expect(
      codigo(() =>
        validarFechaTalon({
          ...base,
          fecha: '2026-11-09',
          operacion: 'entregar',
        }),
      ),
    ).toBe('CHECK_DATE_INVALID');
    expect(
      codigo(() =>
        validarFechaTalon({
          ...base,
          fecha: '2026-11-15',
          operacion: 'cobrar',
        }),
      ),
    ).toBe('CHECK_DATE_INVALID');
    expect(
      codigo(() =>
        validarFechaTalon({
          ...base,
          fecha: '2026-11-20',
          operacion: 'cobrar',
        }),
      ),
    ).toBeNull();
    expect(
      codigo(() =>
        validarFechaTalon({
          ...base,
          fecha: '2026-11-15',
          operacion: 'anular',
        }),
      ),
    ).toBeNull();
    expect(importeTalon('1210.00')).toBe(121000n);
    expect(codigo(() => importeTalon(0))).toBe('CHECK_AMOUNT_INVALID');
  });

  it('cuenta de tránsito en el plan, medio de pago y permisos', () => {
    expect(planContableBase().find((c) => c.codigo === '5729')).toMatchObject({
      tipo: 'activo',
      imputable: true,
    });
    expect(PAYMENT_INSTRUMENTS).toContain('talon');
    expect(can('administracion', 'crear', 'talon')).toBe(true);
    expect(can('obra', 'crear', 'talon')).toBe(false);
    expect(can('obra', 'cambiarEstado', 'retencion')).toBe(false);
  });
});

describe('retenciones: liberación por hito y sustitución por aval', () => {
  const ret = [
    { id: 'r1', pendiente: '50.00', vencimiento: '2027-05-10' },
    { id: 'r2', pendiente: 25, vencimiento: '2027-09-01' },
  ];

  it('libera el pendiente entero de cada retención, con el vencimiento anterior', () => {
    expect(
      planLiberacionRetenciones({ fecha: '2026-11-26', retenciones: ret }),
    ).toEqual({
      total: 75,
      lineas: [
        { id: 'r1', importe: 50, vencimientoAnterior: '2027-05-10' },
        { id: 'r2', importe: 25, vencimientoAnterior: '2027-09-01' },
      ],
    });
  });

  it('el aval cubre lo sustituido (saldo vivo − lo ya sustituido)', () => {
    expect(
      planLiberacionRetenciones({
        fecha: '2026-11-26',
        retenciones: ret,
        aval: { saldoVivo: 100, yaSustituido: 25 },
      }).total,
    ).toBe(75);
    expect(
      codigo(() =>
        planLiberacionRetenciones({
          fecha: '2026-11-26',
          retenciones: ret,
          aval: { saldoVivo: 100, yaSustituido: '25.01' },
        }),
      ),
    ).toBe('PS_GUARANTEE_INSUFFICIENT');
  });

  it('rechaza retenciones saldadas, repetidas o ya vencidas', () => {
    expect(
      codigo(() =>
        planLiberacionRetenciones({ fecha: '2026-11-26', retenciones: [] }),
      ),
    ).toBe('PS_RETENTION_NOT_OPEN');
    expect(
      codigo(() =>
        planLiberacionRetenciones({
          fecha: '2026-11-26',
          retenciones: [{ id: 'x', pendiente: 0, vencimiento: '2027-01-01' }],
        }),
      ),
    ).toBe('PS_RETENTION_NOT_OPEN');
    expect(
      codigo(() =>
        planLiberacionRetenciones({
          fecha: '2026-11-26',
          retenciones: [ret[0], ret[0]],
        }),
      ),
    ).toBe('PS_RETENTION_NOT_OPEN');
    expect(
      codigo(() =>
        planLiberacionRetenciones({
          fecha: '2027-05-10',
          retenciones: [ret[0]],
        }),
      ),
    ).toBe('PS_RETENTION_ALREADY_RELEASABLE');
  });

  it('un aval sustituto no baja de lo que sustituye', () => {
    expect(
      motivoReduccionAvalSustituto({ saldoVivoTras: 74.99, sustituido: 75 }),
    ).toContain('75');
    expect(
      motivoReduccionAvalSustituto({ saldoVivoTras: 75, sustituido: 75 }),
    ).toBeNull();
    expect(
      motivoReduccionAvalSustituto({ saldoVivoTras: 0, sustituido: 0 }),
    ).toBeNull();
  });

  it('resumen de la obra por lado: liberable, sustituido y en garantía, exacto', () => {
    const r = resumenRetencionesObra('2026-11-26', [
      {
        lado: 'pago',
        importe: 50,
        liquidado: 0,
        vencimiento: '2026-11-26',
        sustituidaAval: true,
        liberadaHito: false,
      },
      {
        lado: 'pago',
        importe: '25.10',
        liquidado: '10.05',
        vencimiento: '2027-01-01',
        sustituidaAval: false,
        liberadaHito: false,
      },
      {
        lado: 'cobro',
        importe: 60,
        liquidado: 60,
        vencimiento: '2026-01-01',
        sustituidaAval: false,
        liberadaHito: true,
      },
      {
        lado: 'cobro',
        importe: 30,
        liquidado: 0,
        vencimiento: '2027-06-30',
        sustituidaAval: false,
        liberadaHito: false,
      },
    ]);
    expect(r.pago).toEqual({
      retenido: 75.1,
      liquidado: 10.05,
      pendiente: 65.05,
      liberable: 50,
      sustituidoAval: 50,
      enGarantia: 15.05,
    });
    expect(r.cobro).toEqual({
      retenido: 90,
      liquidado: 60,
      pendiente: 30,
      liberable: 0,
      sustituidoAval: 0,
      enGarantia: 30,
    });
  });
});

describe('modificados del contrato de subcontrata', () => {
  it('suma con signo y no baja de lo certificado a origen', () => {
    expect(
      aplicarModificado({
        importeVigente: 10_000,
        importeModificado: '2500.50',
        certificadoOrigen: 4000,
      }),
    ).toBe(12500.5);
    expect(
      aplicarModificado({
        importeVigente: 10_000,
        importeModificado: -6000,
        certificadoOrigen: 4000,
      }),
    ).toBe(4000);
    expect(
      codigo(() =>
        aplicarModificado({
          importeVigente: 10_000,
          importeModificado: '-6000.01',
          certificadoOrigen: 4000,
        }),
      ),
    ).toBe('PS_CHANGE_BELOW_CERTIFIED');
    expect(
      codigo(() =>
        aplicarModificado({
          importeVigente: 10_000,
          importeModificado: 0,
          certificadoOrigen: 0,
        }),
      ),
    ).toBe('PS_CHANGE_INVALID');
    expect(
      codigo(() =>
        aplicarModificado({
          importeVigente: 100,
          importeModificado: -100,
          certificadoOrigen: 0,
        }),
      ),
    ).toBe('PS_CHANGE_INVALID');
  });
});
