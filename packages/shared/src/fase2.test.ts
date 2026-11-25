import { describe, expect, it } from 'vitest';
import {
  antiguedadSaldos,
  cobrosPagosEfe,
  conciliarTerceros,
  diasEntre,
  ErrorCartera,
  imputarPartidas,
  partidasAbiertas,
  planCompensacion,
  tramoAntiguedad,
  type PartidaEntrada,
} from './cartera';
import {
  asientoAnticipo,
  asientoDesdeVencimiento,
  esCuentaTercero,
  planContableBase,
} from './contabilidad';
import { can } from './capacidades';
import {
  asignarLotesSalida,
  ErrorLote,
  lotesCaducados,
  validarLotesEntrada,
} from './lotes';

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ErrorCartera | ErrorLote).codigo;
  }
  return null;
};

describe('cartera: partidas abiertas y antigüedad', () => {
  const p = (x: Partial<PartidaEntrada> & { id: string }): PartidaEntrada => ({
    contactId: 'c1',
    contactName: 'Cliente Uno',
    invoiceId: `f-${x.id}`,
    invoiceNumber: `F-${x.id}`,
    kind: 'ordinario',
    vencimiento: '2026-06-30',
    importe: 100,
    liquidado: 0,
    ...x,
  });

  it('tramos por días vencidos y días entre fechas', () => {
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
    expect([0, -5, 1, 30, 31, 60, 61, 90, 91].map(tramoAntiguedad)).toEqual([
      'al_corriente',
      'al_corriente',
      'd1_30',
      'd1_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'mas_90',
    ]);
  });

  it('pendiente exacto, saldadas fuera, signo contrario conservado y totales que cuadran', () => {
    const abiertas = partidasAbiertas(
      [
        p({
          id: '1',
          vencimiento: '2026-07-31',
          importe: '1160.00',
          liquidado: '500.10',
        }),
        p({
          id: '2',
          vencimiento: '2026-03-01',
          importe: 50,
          kind: 'retencion',
        }),
        p({ id: '3', importe: 100, liquidado: 100 }),
        p({
          id: '4',
          vencimiento: '2026-05-01',
          importe: '0.30',
          liquidado: '0.40',
        }),
        p({
          id: '5',
          contactId: 'c2',
          contactName: 'Beta',
          vencimiento: '2026-08-10',
          importe: '200.01',
        }),
      ],
      '2026-07-31',
    );
    expect(
      abiertas.map((a) => [a.id, a.pendiente, a.diasVencido, a.tramo]),
    ).toEqual([
      ['5', 200.01, -10, 'al_corriente'],
      ['2', 50, 152, 'mas_90'],
      ['4', -0.1, 91, 'mas_90'],
      ['1', 659.9, 0, 'al_corriente'],
    ]);
    const ag = antiguedadSaldos('clientes', '2026-07-31', abiertas);
    expect(
      ag.terceros.map((t) => [t.contactName, t.total, t.vencido, t.retencion]),
    ).toEqual([
      ['Beta', 200.01, 0, 0],
      ['Cliente Uno', 709.8, 49.9, 50],
    ]);
    expect(ag.totales).toMatchObject({
      tramos: {
        al_corriente: 859.91,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        mas_90: 49.9,
      },
      total: 909.81,
      vencido: 49.9,
      partidas: 4,
    });
    const suma = ag.terceros.reduce((s, t) => s + Math.round(t.total * 100), 0);
    expect(suma).toBe(Math.round(ag.totales.total * 100));
  });
});

describe('cartera: imputación y compensación', () => {
  const partidas = [
    { id: 'a', vencimiento: '2026-03-01', pendiente: 100 },
    { id: 'b', vencimiento: '2026-01-15', pendiente: '40.50' },
    { id: 'c', vencimiento: '2026-02-01', pendiente: 0 },
  ];

  it('automática por antigüedad hasta agotar el disponible', () => {
    expect(imputarPartidas({ disponible: '90.50', partidas })).toEqual([
      { vencimientoId: 'b', importe: 40.5 },
      { vencimientoId: 'a', importe: 50 },
    ]);
    expect(imputarPartidas({ disponible: 1000, partidas })).toEqual([
      { vencimientoId: 'b', importe: 40.5 },
      { vencimientoId: 'a', importe: 100 },
    ]);
  });

  it('explícita: valida partida, importe, duplicados y disponible', () => {
    expect(
      imputarPartidas({
        disponible: 60,
        partidas,
        explicitas: [{ vencimientoId: 'a', importe: 60 }],
      }),
    ).toEqual([{ vencimientoId: 'a', importe: 60 }]);
    expect(codigo(() => imputarPartidas({ disponible: 0, partidas }))).toBe(
      'AR_AP_ALLOCATION_INVALID',
    );
    expect(
      codigo(() =>
        imputarPartidas({
          disponible: 10,
          partidas,
          explicitas: [{ vencimientoId: 'x', importe: 1 }],
        }),
      ),
    ).toBe('AR_AP_ITEM_NOT_FOUND');
    expect(
      codigo(() =>
        imputarPartidas({
          disponible: 10,
          partidas,
          explicitas: [{ vencimientoId: 'c', importe: 1 }],
        }),
      ),
    ).toBe('AR_AP_ITEM_NOT_OPEN');
    expect(
      codigo(() =>
        imputarPartidas({
          disponible: 500,
          partidas,
          explicitas: [{ vencimientoId: 'b', importe: 41 }],
        }),
      ),
    ).toBe('AR_AP_ALLOCATION_EXCEEDS_ITEM');
    expect(
      codigo(() =>
        imputarPartidas({
          disponible: 50,
          partidas,
          explicitas: [
            { vencimientoId: 'a', importe: 30 },
            { vencimientoId: 'b', importe: 30 },
          ],
        }),
      ),
    ).toBe('AR_AP_ALLOCATION_EXCEEDS_AVAILABLE');
    expect(
      codigo(() =>
        imputarPartidas({
          disponible: 50,
          partidas,
          explicitas: [
            { vencimientoId: 'a', importe: 1 },
            { vencimientoId: 'a', importe: 1 },
          ],
        }),
      ),
    ).toBe('AR_AP_ALLOCATION_INVALID');
    expect(
      codigo(() => imputarPartidas({ disponible: 10, partidas: [] })),
    ).toBe('AR_AP_ITEM_NOT_OPEN');
  });

  it('compensación: por defecto el menor pendiente; ambos lados suman lo mismo', () => {
    const plan = planCompensacion({
      cobros: [{ id: 'v1', vencimiento: '2026-05-01', pendiente: '1160.00' }],
      pagos: [
        { id: 'p1', vencimiento: '2026-04-01', pendiente: 300 },
        { id: 'p2', vencimiento: '2026-06-01', pendiente: '280.25' },
      ],
    });
    expect(plan).toEqual({
      importe: 580.25,
      cobros: [{ vencimientoId: 'v1', importe: 580.25 }],
      pagos: [
        { vencimientoId: 'p1', importe: 300 },
        { vencimientoId: 'p2', importe: 280.25 },
      ],
    });
    expect(
      codigo(() =>
        planCompensacion({
          importe: 600,
          cobros: [{ id: 'v1', vencimiento: '2026-05-01', pendiente: 1000 }],
          pagos: [{ id: 'p1', vencimiento: '2026-04-01', pendiente: 580 }],
        }),
      ),
    ).toBe('AR_AP_ALLOCATION_EXCEEDS_AVAILABLE');
    expect(
      codigo(() =>
        planCompensacion({
          cobros: [],
          pagos: [{ id: 'p1', vencimiento: '2026-04-01', pendiente: 5 }],
        }),
      ),
    ).toBe('AR_AP_ITEM_NOT_OPEN');
    expect(
      codigo(() =>
        planCompensacion({
          importe: 100,
          cobros: [{ id: 'v1', vencimiento: '2026-05-01', pendiente: 1000 }],
          pagos: [{ id: 'p1', vencimiento: '2026-04-01', pendiente: 500 }],
          explicitasPagos: [{ vencimientoId: 'p1', importe: 90 }],
        }),
      ),
    ).toBe('AR_AP_NETTING_UNBALANCED');
  });

  it('conciliación por tercero: auxiliar neto de anticipos y fila sin tercero', () => {
    const r = conciliarTerceros(
      [
        {
          contactId: 'c1',
          contactName: 'Uno',
          ordinario: 660,
          retencion: 50,
          anticipos: 200,
        },
        {
          contactId: 'c2',
          contactName: 'Dos',
          ordinario: 100,
          retencion: 0,
          anticipos: 0,
        },
      ],
      [
        { contactId: 'c1', saldo: '510.00' },
        { contactId: 'c2', saldo: 90 },
        { contactId: null, saldo: 10 },
      ],
    );
    expect(
      r.terceros.map((t) => [
        t.contactName,
        t.auxiliar,
        t.mayor,
        t.diferencia,
        t.cuadra,
      ]),
    ).toEqual([
      ['Dos', 100, 90, -10, false],
      ['Uno', 510, 510, 0, true],
      ['Sin tercero (apuntes manuales)', 0, 10, 10, false],
    ]);
    expect(r.descuadres).toBe(2);
    expect(
      conciliarTerceros([], [{ contactId: null, saldo: 0 }]).terceros,
    ).toEqual([]);
  });
});

describe('asientos de anticipos, aplicaciones y compensaciones', () => {
  const lineas = (ls: { cuenta: string; debe: string; haber: string }[]) =>
    ls.map((l) => [l.cuenta, l.debe, l.haber]);

  it('anticipo de cliente y a proveedor', () => {
    expect(
      lineas(
        asientoAnticipo({
          direccion: 'cobro',
          importe: '200.00',
          contactName: 'Uno',
        }),
      ),
    ).toEqual([
      ['5720', '200.00', '0.00'],
      ['4380', '0.00', '200.00'],
    ]);
    expect(
      lineas(
        asientoAnticipo({
          direccion: 'pago',
          importe: '75.50',
          contactName: 'Prov',
        }),
      ),
    ).toEqual([
      ['4070', '75.50', '0.00'],
      ['5720', '0.00', '75.50'],
    ]);
  });

  it('aplicación de anticipo y compensación: contrapartida no monetaria', () => {
    const base = {
      kind: 'ordinario' as const,
      amount: '150.00',
      invoiceNumber: 'F-1',
      contactName: 'Uno',
    };
    expect(
      lineas(
        asientoDesdeVencimiento({
          ...base,
          direction: 'cobro',
          contrapartida: '4380',
        }),
      ),
    ).toEqual([
      ['4380', '150.00', '0.00'],
      ['4300', '0.00', '150.00'],
    ]);
    expect(
      lineas(
        asientoDesdeVencimiento({
          ...base,
          kind: 'retencion',
          direction: 'pago',
          contrapartida: '5550',
        }),
      ),
    ).toEqual([
      ['4001', '150.00', '0.00'],
      ['5550', '0.00', '150.00'],
    ]);
    // Sin contrapartida, el cobro de siempre contra bancos.
    expect(
      lineas(asientoDesdeVencimiento({ ...base, direction: 'cobro' }))[0][0],
    ).toBe('5720');
  });

  it('cuentas nuevas en el plan y cuentas de tercero', () => {
    const codigos = planContableBase().map((c) => c.codigo);
    expect(codigos).toEqual(expect.arrayContaining(['4070', '4380', '5550']));
    expect(
      ['4300', '4301', '4380', '4000', '4070', '5720', '4389'].map(
        esCuentaTercero,
      ),
    ).toEqual([true, true, true, true, true, false, true]);
  });

  it('detalle de cobros y pagos del EFE: suma exacta la variación de 57x', () => {
    const r = cobrosPagosEfe(
      [
        { origen: 'cobro', tipo: null, importe: '1210.00' },
        { origen: 'anticipo', tipo: 'cobro', importe: 200 },
        { origen: 'pago', tipo: null, importe: '-580.00' },
        { origen: 'anticipo', tipo: 'pago', importe: '-75.50' },
        { origen: 'manual', tipo: null, importe: '10000.00' },
      ],
      '10754.50',
    );
    expect(r).toEqual({
      cobrosClientes: 1410,
      pagosProveedores: -655.5,
      otros: 10000,
      total: 10754.5,
      cuadra: true,
    });
    expect(
      cobrosPagosEfe([{ origen: 'cobro', tipo: null, importe: 1 }], 2).cuadra,
    ).toBe(false);
  });
});

describe('permisos de interfaz de la cartera', () => {
  it('solo admin, gerente y administración operan la cartera; el resto consulta', () => {
    expect(can('administracion', 'crear', 'cartera')).toBe(true);
    expect(can('gerente', 'anular', 'cartera')).toBe(true);
    expect(can('obra', 'crear', 'cartera')).toBe(false);
    expect(can('lector', 'crear', 'cartera')).toBe(false);
    expect(can('lector', 'exportar', 'cartera')).toBe(true);
    expect(can('obra', 'crear', 'lote')).toBe(true);
  });
});

describe('lotes y números de serie', () => {
  it('entrada: obligatorios con seguimiento, suma exacta, serie de una unidad', () => {
    expect(validarLotesEntrada('ninguno', 5, undefined)).toEqual([]);
    expect(
      codigo(() =>
        validarLotesEntrada('ninguno', 5, [{ codigo: 'L1', cantidad: 5 }]),
      ),
    ).toBe('BATCH_SERIAL_NOT_TRACKED');
    expect(codigo(() => validarLotesEntrada('lote', 5, []))).toBe(
      'BATCH_SERIAL_REQUIRED',
    );
    expect(
      validarLotesEntrada('lote', '10.5', [
        { codigo: ' l-1 ', cantidad: 4, caducidad: '2027-01-31' },
        { codigo: 'L-2', cantidad: '6.5' },
      ]),
    ).toEqual([
      { codigo: 'L-1', cantidad: '4.000', caducidad: '2027-01-31' },
      { codigo: 'L-2', cantidad: '6.500', caducidad: null },
    ]);
    expect(
      codigo(() =>
        validarLotesEntrada('lote', 10, [{ codigo: 'L1', cantidad: 9.999 }]),
      ),
    ).toBe('BATCH_SERIAL_QUANTITY_MISMATCH');
    expect(
      codigo(() =>
        validarLotesEntrada('lote', 2, [
          { codigo: 'a', cantidad: 1 },
          { codigo: 'A', cantidad: 1 },
        ]),
      ),
    ).toBe('BATCH_SERIAL_INVALID');
    expect(
      codigo(() =>
        validarLotesEntrada('serie', 2, [{ codigo: 'S1', cantidad: 2 }]),
      ),
    ).toBe('BATCH_SERIAL_INVALID');
    expect(
      validarLotesEntrada('serie', 2, [
        { codigo: 'S1', cantidad: 1 },
        { codigo: 'S2', cantidad: 1 },
      ]),
    ).toHaveLength(2);
  });

  const disp = [
    {
      lotId: 'l3',
      codigo: 'L3',
      cantidad: '5.000',
      caducidad: null,
      alta: '2026-01-01',
    },
    {
      lotId: 'l2',
      codigo: 'L2',
      cantidad: '2.250',
      caducidad: '2026-12-31',
      alta: '2026-03-01',
    },
    {
      lotId: 'l1',
      codigo: 'L1',
      cantidad: '1.000',
      caducidad: '2026-12-31',
      alta: '2026-02-01',
    },
    {
      lotId: 'l0',
      codigo: 'L0',
      cantidad: 0,
      caducidad: '2026-01-01',
      alta: '2026-01-01',
    },
  ];

  it('salida FEFO: primero caduca, a igual caducidad el más antiguo, sin caducidad al final', () => {
    expect(
      asignarLotesSalida({
        seguimiento: 'lote',
        cantidad: '4.25',
        disponibles: disp,
      }),
    ).toEqual([
      { lotId: 'l1', codigo: 'L1', cantidad: '1.000', caducidad: '2026-12-31' },
      { lotId: 'l2', codigo: 'L2', cantidad: '2.250', caducidad: '2026-12-31' },
      { lotId: 'l3', codigo: 'L3', cantidad: '1.000', caducidad: null },
    ]);
    expect(
      codigo(() =>
        asignarLotesSalida({
          seguimiento: 'lote',
          cantidad: 9,
          disponibles: disp,
        }),
      ),
    ).toBe('BATCH_SERIAL_INSUFFICIENT');
    expect(
      codigo(() =>
        asignarLotesSalida({
          seguimiento: 'lote',
          cantidad: 9,
          disponibles: disp,
          devolucion: true,
        }),
      ),
    ).toBe('BATCH_SERIAL_RETURN_EXCEEDS');
    expect(
      asignarLotesSalida({
        seguimiento: 'ninguno',
        cantidad: 3,
        disponibles: [],
      }),
    ).toEqual([]);
  });

  it('salida explícita y series', () => {
    expect(
      asignarLotesSalida({
        seguimiento: 'lote',
        cantidad: 2,
        disponibles: disp,
        explicitos: [{ codigo: 'l3', cantidad: 2 }],
      }),
    ).toEqual([
      { lotId: 'l3', codigo: 'L3', cantidad: '2.000', caducidad: null },
    ]);
    expect(
      codigo(() =>
        asignarLotesSalida({
          seguimiento: 'lote',
          cantidad: 2,
          disponibles: disp,
          explicitos: [{ codigo: 'X', cantidad: 2 }],
        }),
      ),
    ).toBe('BATCH_SERIAL_NOT_FOUND');
    expect(
      codigo(() =>
        asignarLotesSalida({
          seguimiento: 'lote',
          cantidad: 3,
          disponibles: disp,
          explicitos: [{ codigo: 'L2', cantidad: 3 }],
        }),
      ),
    ).toBe('BATCH_SERIAL_INSUFFICIENT');
    expect(
      codigo(() =>
        asignarLotesSalida({
          seguimiento: 'lote',
          cantidad: 3,
          disponibles: disp,
          explicitos: [{ codigo: 'L3', cantidad: 2 }],
        }),
      ),
    ).toBe('BATCH_SERIAL_QUANTITY_MISMATCH');
    const series = [
      {
        lotId: 's1',
        codigo: 'SN-1',
        cantidad: 1,
        caducidad: null,
        alta: '2026-01-02',
      },
      {
        lotId: 's2',
        codigo: 'SN-2',
        cantidad: 1,
        caducidad: null,
        alta: '2026-01-01',
      },
    ];
    expect(
      asignarLotesSalida({
        seguimiento: 'serie',
        cantidad: 1,
        disponibles: series,
      }).map((a) => a.codigo),
    ).toEqual(['SN-2']);
    expect(
      codigo(() =>
        asignarLotesSalida({
          seguimiento: 'serie',
          cantidad: 1.5,
          disponibles: series,
        }),
      ),
    ).toBe('BATCH_SERIAL_INVALID');
    expect(
      lotesCaducados(
        [
          { codigo: 'L1', caducidad: '2026-01-31' },
          { codigo: 'L2', caducidad: null },
        ],
        '2026-02-01',
      ),
    ).toEqual(['L1']);
  });
});
