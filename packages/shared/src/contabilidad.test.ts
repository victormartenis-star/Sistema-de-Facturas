import { describe, expect, it } from 'vitest';
import {
  asientoCreateSchema,
  asientoDesdeFactura,
  asientoDesdeVencimiento,
  errorCuadre,
  filasSumasSaldos,
  lineasContraAsiento,
  periodoDeFecha,
  planContableBase,
  saldoNatural,
  tipoCuentaPorCodigo,
  totalesAsiento,
  CUENTAS_INTERFAZ,
} from './contabilidad';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

describe('errorCuadre', () => {
  it('acepta un asiento cuadrado al céntimo', () => {
    expect(
      errorCuadre([
        { debe: 0.1, haber: 0 },
        { debe: 0.2, haber: 0 },
        { debe: 0, haber: 0.3 },
      ]),
    ).toBeNull();
  });

  it('rechaza un descuadre de un céntimo', () => {
    expect(
      errorCuadre([
        { debe: '100.00', haber: '0' },
        { debe: '0', haber: '99.99' },
      ]),
    ).toMatch(/no cuadra.*0\.01/);
  });

  it('rechaza líneas con ambos lados o ninguno, y asientos de una línea', () => {
    expect(
      errorCuadre([
        { debe: 5, haber: 5 },
        { debe: 0, haber: 0 },
      ]),
    ).toMatch(/Línea 1/);
    expect(errorCuadre([{ debe: 1, haber: 0 }])).toMatch(/dos líneas/);
  });

  it('el esquema Zod aplica el cuadre', () => {
    const r = asientoCreateSchema.safeParse({
      fecha: '2026-11-22',
      concepto: 'Ajuste',
      lineas: [
        { cuenta: '5720', debe: 100 },
        { cuenta: '1000', haber: 90 },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('asientoDesdeFactura', () => {
  it('venta con retención y dos obras: reparte la base por obra y cuadra', () => {
    const lineas = asientoDesdeFactura({
      kind: 'venta',
      invoiceNumber: 'V-1',
      contactName: 'Ayto.',
      baseAmount: '1000.00',
      vatAmount: '210.00',
      totalAmount: '1210.00',
      retentionAmount: '50.00',
      esSubcontrata: false,
      lineas: [
        { baseAmount: '600.00', projectId: P1 },
        { baseAmount: '400.00', projectId: P2 },
      ],
    });
    expect(errorCuadre(lineas)).toBeNull();
    const C = CUENTAS_INTERFAZ;
    const por = (c: string) => lineas.filter((l) => l.cuenta === c);
    expect(por(C.clientes)[0].debe).toBe('1160.00');
    expect(por(C.clientesRetencion)[0].debe).toBe('50.00');
    expect(por(C.ventasObra).map((l) => [l.projectId, l.haber])).toEqual([
      [P1, '600.00'],
      [P2, '400.00'],
    ]);
    expect(por(C.ivaRepercutido)[0].haber).toBe('210.00');
  });

  it('compra de subcontrata va a la 6070 y a proveedores', () => {
    const lineas = asientoDesdeFactura({
      kind: 'compra',
      invoiceNumber: 'C-7',
      contactName: 'Subcontrata SL',
      baseAmount: '500.00',
      vatAmount: '105.00',
      totalAmount: '605.00',
      retentionAmount: '0.00',
      esSubcontrata: true,
      lineas: [{ baseAmount: '500.00', projectId: P1 }],
    });
    expect(errorCuadre(lineas)).toBeNull();
    expect(lineas.map((l) => l.cuenta)).toEqual(['6070', '4720', '4000']);
  });

  it('rectificativa negativa invierte los lados', () => {
    const lineas = asientoDesdeFactura({
      kind: 'venta',
      invoiceNumber: 'R-1',
      contactName: 'Cliente',
      baseAmount: '-100.00',
      vatAmount: '-21.00',
      totalAmount: '-121.00',
      retentionAmount: '0.00',
      esSubcontrata: false,
      lineas: [{ baseAmount: '-100.00', projectId: P1 }],
    });
    expect(errorCuadre(lineas)).toBeNull();
    const clientes = lineas.find((l) => l.cuenta === '4300')!;
    expect(clientes.haber).toBe('121.00');
    expect(lineas.find((l) => l.cuenta === '7050')!.debe).toBe('100.00');
  });

  it('si las líneas no suman la base, la diferencia queda sin obra y cuadra', () => {
    const lineas = asientoDesdeFactura({
      kind: 'compra',
      invoiceNumber: 'C-8',
      contactName: 'Prov',
      baseAmount: '100.00',
      vatAmount: '21.00',
      totalAmount: '121.00',
      retentionAmount: '0.00',
      esSubcontrata: false,
      lineas: [{ baseAmount: '99.99', projectId: P1 }],
    });
    expect(errorCuadre(lineas)).toBeNull();
    expect(
      lineas.find((l) => l.cuenta === '6000' && l.projectId === null)!.debe,
    ).toBe('0.01');
  });

  it('total legado que no es base + IVA: ajusta la cuenta del tercero', () => {
    const lineas = asientoDesdeFactura({
      kind: 'venta',
      invoiceNumber: 'V-2',
      contactName: 'C',
      baseAmount: '100.00',
      vatAmount: '21.00',
      totalAmount: '121.01',
      retentionAmount: '0.00',
      esSubcontrata: false,
      lineas: [{ baseAmount: '100.00', projectId: null }],
    });
    expect(errorCuadre(lineas)).toBeNull();
  });
});

describe('asientoDesdeVencimiento', () => {
  it('cobro de retención: bancos a clientes por retenciones', () => {
    const l = asientoDesdeVencimiento({
      direction: 'cobro',
      kind: 'retencion',
      amount: '50.00',
      invoiceNumber: 'V-1',
      contactName: 'Ayto.',
    });
    expect(l.map((x) => [x.cuenta, x.debe, x.haber])).toEqual([
      ['5720', '50.00', '0.00'],
      ['4301', '0.00', '50.00'],
    ]);
  });

  it('pago ordinario: proveedores a bancos', () => {
    const l = asientoDesdeVencimiento({
      direction: 'pago',
      kind: 'ordinario',
      amount: '605.00',
      invoiceNumber: 'C-7',
      contactName: 'S',
    });
    expect(l.map((x) => x.cuenta)).toEqual(['4000', '5720']);
    expect(errorCuadre(l)).toBeNull();
  });
});

describe('utilidades', () => {
  it('contra-asiento intercambia lados y neutraliza', () => {
    const orig = [
      { cuenta: '5720', debe: '10.00', haber: '0.00' },
      { cuenta: '4300', debe: '0.00', haber: '10.00' },
    ];
    const contra = lineasContraAsiento(orig);
    expect(totalesAsiento([...orig, ...contra]).descuadre).toBe(0);
    expect(contra[0]).toEqual({ cuenta: '5720', debe: '0.00', haber: '10.00' });
  });

  it('saldo natural según el tipo de cuenta', () => {
    expect(saldoNatural('activo', '100', '30')).toBe(70);
    expect(saldoNatural('ingreso', '30', '100')).toBe(70);
  });

  it('plan base: códigos únicos y contiene las cuentas de la interfaz', () => {
    const plan = planContableBase();
    const codigos = plan.map((c) => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of Object.values(CUENTAS_INTERFAZ)) {
      expect(plan.find((p) => p.codigo === c)?.imputable).toBe(true);
    }
  });

  it('tipo por grupo PGC', () => {
    expect(tipoCuentaPorCodigo('4000')).toBe('pasivo');
    expect(tipoCuentaPorCodigo('4300')).toBe('activo');
    expect(tipoCuentaPorCodigo('6070')).toBe('gasto');
    expect(tipoCuentaPorCodigo('7050')).toBe('ingreso');
  });

  it('período de una fecha', () => {
    expect(periodoDeFecha('2026-02-28')).toEqual({ ejercicio: 2026, mes: 2 });
  });

  it('sumas y saldos cuadra y separa saldos deudores y acreedores', () => {
    const r = filasSumasSaldos([
      {
        codigo: '5720',
        nombre: 'B',
        tipo: 'activo',
        debe: '100.10',
        haber: '0',
      },
      {
        codigo: '4300',
        nombre: 'C',
        tipo: 'activo',
        debe: '0',
        haber: '100.10',
      },
    ]);
    expect(r.cuadra).toBe(true);
    expect(r.totalSaldoDeudor).toBe(100.1);
    expect(r.totalSaldoAcreedor).toBe(100.1);
  });
});
