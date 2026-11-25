import { describe, expect, it } from 'vitest';
import {
  aplicarMovimientoAval,
  asientoComisionAval,
  asientoEjecucionAval,
  comisionAval,
  diasHastaVencimiento,
  estadoPorSaldo,
  resumenAvales,
  saldoAval,
  type EstadoAval,
} from './calculo';
import { AVAL_TRANSITIONS, ESTADOS_AVAL, avalCreateSchema } from './avales';
import { transicion, TransicionInvalidaError } from './maquina-estados';

const base = {
  estado: 'vigente' as EstadoAval,
  nominal: '100000.00',
  liberado: '0',
  ejecutado: '0',
};

describe('saldo y estado del aval (céntimos exactos)', () => {
  it('saldo vivo = nominal − liberado − ejecutado sin ruido binario', () => {
    expect(
      saldoAval({ nominal: '0.30', liberado: 0.1, ejecutado: 0.2 }).saldoVivo,
    ).toBe(0);
    expect(
      saldoAval({ nominal: '1000.01', liberado: '0.01', ejecutado: '0' }),
    ).toEqual({
      nominal: 1000.01,
      liberado: 0.01,
      ejecutado: 0,
      saldoVivo: 1000,
    });
  });

  it('estado por saldo', () => {
    expect(estadoPorSaldo({ nominal: 100, liberado: 0, ejecutado: 0 })).toBe(
      'vigente',
    );
    expect(estadoPorSaldo({ nominal: 100, liberado: 10, ejecutado: 0 })).toBe(
      'liberado_parcial',
    );
    expect(estadoPorSaldo({ nominal: 100, liberado: 100, ejecutado: 0 })).toBe(
      'liberado',
    );
    expect(estadoPorSaldo({ nominal: 100, liberado: 60, ejecutado: 40 })).toBe(
      'ejecutado',
    );
  });
});

describe('aplicarMovimientoAval', () => {
  it('liberación parcial y luego total', () => {
    const r1 = aplicarMovimientoAval({
      ...base,
      tipo: 'liberacion',
      importe: 25_000.5,
    });
    expect(r1).toEqual({
      ok: true,
      importe: 25000.5,
      liberado: 25000.5,
      ejecutado: 0,
      saldoVivo: 74999.5,
      estado: 'liberado_parcial',
    });
    if (!r1.ok) throw new Error();
    const r2 = aplicarMovimientoAval({
      ...base,
      estado: r1.estado,
      liberado: r1.liberado,
      tipo: 'liberacion',
    });
    expect(r2).toMatchObject({
      ok: true,
      importe: 74999.5,
      saldoVivo: 0,
      estado: 'liberado',
    });
  });

  it('ejecución total y parcial', () => {
    expect(aplicarMovimientoAval({ ...base, tipo: 'ejecucion' })).toMatchObject(
      { ok: true, ejecutado: 100000, saldoVivo: 0, estado: 'ejecutado' },
    );
    expect(
      aplicarMovimientoAval({ ...base, tipo: 'ejecucion', importe: 1 }),
    ).toMatchObject({ ok: true, saldoVivo: 99999, estado: 'liberado_parcial' });
    // Parte ejecutada y resto liberado: queda ejecutado.
    expect(
      aplicarMovimientoAval({
        ...base,
        estado: 'liberado_parcial',
        ejecutado: '1000',
        tipo: 'liberacion',
      }),
    ).toMatchObject({ ok: true, liberado: 99000, estado: 'ejecutado' });
  });

  it('vencimiento libera el saldo entero', () => {
    expect(
      aplicarMovimientoAval({
        ...base,
        estado: 'liberado_parcial',
        liberado: '40000',
        tipo: 'vencimiento',
        importe: 5,
      }),
    ).toMatchObject({
      ok: true,
      importe: 60000,
      saldoVivo: 0,
      estado: 'vencido',
    });
  });

  it('rechazos: importe no positivo, superior al saldo, aval no vivo', () => {
    expect(
      aplicarMovimientoAval({ ...base, tipo: 'liberacion', importe: 0 }),
    ).toMatchObject({ ok: false, codigo: 'BANK_GUARANTEE_AMOUNT_INVALID' });
    expect(
      aplicarMovimientoAval({
        ...base,
        liberado: '99999.99',
        estado: 'liberado_parcial',
        tipo: 'ejecucion',
        importe: '0.02',
      }),
    ).toMatchObject({
      ok: false,
      codigo: 'BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE',
    });
    for (const estado of [
      'liberado',
      'ejecutado',
      'vencido',
      'anulado',
    ] as const) {
      expect(
        aplicarMovimientoAval({ ...base, estado, tipo: 'liberacion' }),
      ).toMatchObject({ ok: false, codigo: 'BANK_GUARANTEE_NOT_ACTIVE' });
    }
  });
});

describe('comisión de riesgo', () => {
  it('saldo × tasa anual × meses / 12, half-up al céntimo', () => {
    // 100.000 × 0,75 % × 3/12 = 187,50
    expect(
      comisionAval({ saldoVivo: '100000', tasaAnualPct: 0.75, meses: 3 }),
    ).toBe(187.5);
    // 33.333,33 × 1,2345 % / 12 = 34,2916... → 34,29
    expect(
      comisionAval({ saldoVivo: '33333.33', tasaAnualPct: '1.2345', meses: 1 }),
    ).toBe(34.29);
    // 1.000 × 0,5 % × 1/12 = 0,41666 → 0,42
    expect(comisionAval({ saldoVivo: 1000, tasaAnualPct: 0.5, meses: 1 })).toBe(
      0.42,
    );
    expect(() =>
      comisionAval({ saldoVivo: 1, tasaAnualPct: 1, meses: 0 }),
    ).toThrow(RangeError);
  });
});

describe('vencimientos y resumen de exposición', () => {
  it('días hasta vencimiento', () => {
    expect(diasHastaVencimiento('2026-12-31', '2026-12-01')).toBe(30);
    expect(diasHastaVencimiento('2026-11-30', '2026-12-01')).toBe(-1);
    expect(diasHastaVencimiento(null, '2026-12-01')).toBeNull();
  });

  it('resumen solo con avales vivos; comisiones de todos', () => {
    const r = resumenAvales(
      [
        {
          direccion: 'emitido',
          estado: 'vigente',
          nominal: '100000',
          saldoVivo: '100000',
          fechaVencimiento: '2026-12-15',
          comisiones: '187.50',
        },
        {
          direccion: 'emitido',
          estado: 'liberado_parcial',
          nominal: '50000',
          saldoVivo: '20000.10',
          fechaVencimiento: '2026-11-01',
          comisiones: '0',
        },
        {
          direccion: 'emitido',
          estado: 'liberado',
          nominal: '9999',
          saldoVivo: '0',
          fechaVencimiento: '2026-12-02',
          comisiones: '12.5',
        },
        {
          direccion: 'recibido',
          estado: 'vigente',
          nominal: '7000',
          saldoVivo: '7000',
          fechaVencimiento: null,
          comisiones: '0',
        },
      ],
      '2026-12-01',
      30,
    );
    expect(r).toEqual({
      emitidos: { numero: 2, nominal: 150000, saldoVivo: 120000.1 },
      recibidos: { numero: 1, nominal: 7000, saldoVivo: 7000 },
      proximosVencer: 1,
      saldoProximosVencer: 100000,
      vencidosSinCerrar: 1,
      comisionesAcumuladas: 200,
    });
  });
});

describe('asientos del aval', () => {
  it('comisión: 6260 (obra) a 5720', () => {
    expect(asientoComisionAval('187.5')).toEqual([
      { cuenta: '6260', debe: '187.50', haber: '0.00', imputaObra: true },
      { cuenta: '5720', debe: '0.00', haber: '187.50', imputaObra: false },
    ]);
    expect(asientoComisionAval(0)).toEqual([]);
  });

  it('ejecución emitida (6780 a 5720) y recibida (5720 a 7780)', () => {
    expect(asientoEjecucionAval(1000, 'emitido')).toEqual([
      { cuenta: '6780', debe: '1000.00', haber: '0.00', imputaObra: true },
      { cuenta: '5720', debe: '0.00', haber: '1000.00', imputaObra: false },
    ]);
    expect(asientoEjecucionAval('0.01', 'recibido')).toEqual([
      { cuenta: '5720', debe: '0.01', haber: '0.00', imputaObra: false },
      { cuenta: '7780', debe: '0.00', haber: '0.01', imputaObra: true },
    ]);
  });
});

describe('máquina de estados del aval', () => {
  it('matriz completa estado × estado', () => {
    for (const de of ESTADOS_AVAL) {
      for (const a of ESTADOS_AVAL) {
        const legal = AVAL_TRANSITIONS[de].includes(a);
        if (legal) expect(transicion('bank_guarantee', de, a)).toBe(a);
        else
          expect(() => transicion('bank_guarantee', de, a)).toThrow(
            TransicionInvalidaError,
          );
      }
    }
  });

  it('terminales y anulación solo desde vigente', () => {
    for (const t of ['liberado', 'ejecutado', 'vencido', 'anulado'] as const) {
      expect(AVAL_TRANSITIONS[t]).toEqual([]);
    }
    expect(AVAL_TRANSITIONS.liberado_parcial).not.toContain('anulado');
    expect(AVAL_TRANSITIONS.liberado_parcial).toContain('liberado_parcial');
  });
});

describe('esquema de alta', () => {
  const alta = {
    referencia: 'AV-1',
    tipo: 'garantia_definitiva',
    direccion: 'emitido',
    entidad: 'Banco',
    importe: 1000,
    fechaEmision: '2026-01-10',
  } as const;

  it('vencimiento ≥ emisión y comisión solo en emitidos', () => {
    expect(avalCreateSchema.safeParse(alta).success).toBe(true);
    expect(
      avalCreateSchema.safeParse({ ...alta, fechaVencimiento: '2026-01-09' })
        .success,
    ).toBe(false);
    expect(
      avalCreateSchema.safeParse({
        ...alta,
        direccion: 'recibido',
        tasaComisionAnualPct: 0.5,
      }).success,
    ).toBe(false);
    expect(avalCreateSchema.safeParse({ ...alta, importe: 0 }).success).toBe(
      false,
    );
    expect(
      avalCreateSchema.safeParse({ ...alta, importe: 10.001 }).success,
    ).toBe(false);
  });
});
