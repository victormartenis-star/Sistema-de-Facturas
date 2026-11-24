import { describe, expect, it } from 'vitest';
import { buildRectificationLines } from './calculo';
import {
  computeDesviacionPorPartida,
  computeIvaObra,
  computeMargenBrutoObra,
  computeRetencionesObra,
  prorratearRetencionesDeObra,
  computeSobrecostePorPartida,
} from './cost-control';

describe('computeMargenBrutoObra', () => {
  it('margen sobre certificado y sobre facturado, y pendiente de facturar', () => {
    const m = computeMargenBrutoObra({
      certificado: '100000.00',
      facturadoVenta: '80000.00',
      costes: {
        facturasCompra: '50000.10',
        partesPersonal: '10000.20',
        partesMaquinaria: '4999.70',
      },
      facturasCompraEnBorrador: '1000',
    });
    expect(m.costeReal).toBe(65000);
    expect(m.margenSobreCertificado).toBe(35000);
    expect(m.margenSobreCertificadoPct).toBe(35);
    expect(m.margenSobreFacturado).toBe(15000);
    expect(m.margenSobreFacturadoPct).toBe(18.75);
    expect(m.pendienteFacturar).toBe(20000);
    expect(m.facturasCompraEnBorrador).toBe(1000);
  });

  it('porcentajes nulos con divisor cero', () => {
    const m = computeMargenBrutoObra({
      certificado: 0,
      facturadoVenta: 0,
      costes: { facturasCompra: 10, partesPersonal: 0, partesMaquinaria: 0 },
    });
    expect(m.margenSobreCertificado).toBe(-10);
    expect(m.margenSobreCertificadoPct).toBeNull();
    expect(m.margenSobreFacturadoPct).toBeNull();
  });
});

describe('computeDesviacionPorPartida', () => {
  const rows = [
    {
      phaseId: 'a',
      code: '01',
      name: 'Cimentación',
      budget: 1000,
      facturasCompra: 800,
      partesPersonal: 300,
      partesMaquinaria: 0,
    },
    {
      phaseId: null,
      code: '',
      name: '',
      budget: 0,
      facturasCompra: 200,
      partesPersonal: 50.5,
      partesMaquinaria: 10,
    },
  ];

  it('desglosa por origen y marca el sobrecoste', () => {
    const [a] = computeDesviacionPorPartida(rows);
    expect(a.actual).toBe(1100);
    expect(a.costes).toEqual({
      facturasCompra: 800,
      partesPersonal: 300,
      partesMaquinaria: 0,
      almacen: 0,
      amortizacion: 0,
    });
    expect(a.deviation).toBe(100);
    expect(a.deviationPct).toBe(10);
    expect(a.overBudget).toBe(true);
  });

  it('almacén y amortización suman al coste real y van a "Sin partida"', () => {
    const r = computeDesviacionPorPartida([
      rows[0],
      { ...rows[1], almacen: '250.10', amortizacion: 200 },
    ]);
    const sin = r.find((f) => f.phaseId === null)!;
    expect(sin.costes).toMatchObject({ almacen: 250.1, amortizacion: 200 });
    expect(sin.actual).toBe(710.6);
    const m = computeMargenBrutoObra({
      certificado: 1000,
      facturadoVenta: 0,
      costes: {
        facturasCompra: 100,
        partesPersonal: 0,
        partesMaquinaria: 0,
        almacen: '0.10',
        amortizacion: '0.20',
      },
    });
    expect(m.costeReal).toBe(100.3);
    expect(m.costes).toMatchObject({ almacen: 0.1, amortizacion: 0.2 });
  });

  it('la fila "Sin partida" recoge el coste sin partida y la suma cuadra', () => {
    const result = computeDesviacionPorPartida(rows);
    const sin = result.find((r) => r.phaseId === null)!;
    expect(sin.name).toBe('Sin partida');
    expect(sin.actual).toBe(260.5);
    expect(sin.deviationPct).toBeNull();
    expect(result.reduce((s, r) => s + r.actual, 0)).toBe(1360.5);
  });

  it('sin coste ni presupuesto sin partida no añade fila', () => {
    const result = computeDesviacionPorPartida([
      { ...rows[1], facturasCompra: 0, partesPersonal: 0, partesMaquinaria: 0 },
    ]);
    expect(result).toEqual([]);
  });

  it('computeSobrecostePorPartida mantiene su contrato', () => {
    const [r] = computeSobrecostePorPartida([
      { phaseId: 'a', code: '01', name: 'X', budget: 100, actual: 90 },
    ]);
    expect(r).toEqual({
      phaseId: 'a',
      code: '01',
      name: 'X',
      budget: 100,
      actual: 90,
      deviation: -10,
      deviationPct: -10,
      overBudget: false,
    });
  });
});

describe('computeRetencionesObra', () => {
  it('retenido, liberado, pendiente y vencido por lado según hoy', () => {
    const r = computeRetencionesObra(
      [
        {
          direction: 'cobro',
          amount: '100.00',
          dueDate: '2026-01-01',
          status: 'previsto',
        },
        {
          direction: 'cobro',
          amount: '50.00',
          dueDate: '2026-12-01',
          status: 'previsto',
        },
        {
          direction: 'cobro',
          amount: '25.00',
          dueDate: '2025-06-01',
          status: 'pagado',
        },
        {
          direction: 'cobro',
          amount: '10.00',
          dueDate: '2027-03-01',
          status: 'previsto',
        },
        {
          direction: 'pago',
          amount: '40.00',
          dueDate: '2026-11-20',
          status: 'previsto',
        },
      ],
      '2026-06-01',
    );
    expect(r.aCobrarDeCliente).toEqual({
      retenido: 185,
      liberado: 25,
      pendiente: 160,
      vencido: 100,
      proximaLiberacion: '2026-12-01',
    });
    expect(r.aPagarAProveedores.pendiente).toBe(40);
    expect(r.aPagarAProveedores.vencido).toBe(0);
    expect(r.saldo).toBe(120);
  });

  it('sin movimientos todo es cero y sin próxima liberación', () => {
    const r = computeRetencionesObra([], '2026-06-01');
    expect(r.aCobrarDeCliente.proximaLiberacion).toBeNull();
    expect(r.saldo).toBe(0);
  });
});

describe('computeIvaObra', () => {
  it('compra con ISP no suma soportado pero sí la cuota autoliquidada', () => {
    const iva = computeIvaObra([
      { kind: 'compra', isp: true, lines: [{ baseAmount: 1000, vatPct: 21 }] },
      { kind: 'compra', isp: false, lines: [{ baseAmount: 100, vatPct: 21 }] },
      { kind: 'venta', isp: false, lines: [{ baseAmount: 500, vatPct: 10 }] },
      { kind: 'venta', isp: true, lines: [{ baseAmount: 300, vatPct: 21 }] },
    ]);
    expect(iva.totalSoportado).toBe(21);
    expect(iva.ispRecibidas).toEqual({
      baseAmount: 1000,
      selfAssessedVat: 210,
    });
    expect(iva.ispEmitidas.baseAmount).toBe(300);
    expect(iva.totalRepercutido).toBe(50);
    expect(iva.saldo).toBe(29);
    expect(iva.soportado).toEqual([
      { vatPct: 21, baseAmount: 100, vatAmount: 21 },
    ]);
  });

  it('original y rectificativa totales netean a cero', () => {
    const lines = [{ baseAmount: 20.1, vatPct: 21 }];
    const iva = computeIvaObra([
      { kind: 'venta', isp: false, lines },
      { kind: 'venta', isp: false, lines: buildRectificationLines(lines) },
    ]);
    expect(iva.totalRepercutido).toBe(0);
    expect(iva.repercutido).toEqual([
      { vatPct: 21, baseAmount: 0, vatAmount: 0 },
    ]);
  });
});

describe('computeIvaObra con obra', () => {
  const lineas = [
    { baseAmount: 100.07, vatPct: 21, projectId: 'A' },
    { baseAmount: 100.07, vatPct: 21, projectId: 'B' },
  ];
  const factura = { kind: 'venta' as const, isp: false, lines: lineas };

  it('reparte la cuota de la factura y cuadra al céntimo', () => {
    const a = computeIvaObra([factura], 'A');
    const b = computeIvaObra([factura], 'B');
    expect(a.totalRepercutido).toBe(21.02);
    expect(b.totalRepercutido).toBe(21.01);
    expect(a.repercutido[0].baseAmount).toBe(100.07);
    expect(b.repercutido[0].baseAmount).toBe(100.07);
    expect(computeIvaObra([factura]).totalRepercutido).toBe(42.03);
  });

  it('3 obras: 0,07 al 21 % reparte la cuota 0,04 como 0,02/0,01/0,01', () => {
    const f = {
      kind: 'venta' as const,
      isp: false,
      lines: ['A', 'B', 'C'].map((projectId) => ({
        baseAmount: 0.07,
        vatPct: 21,
        projectId,
      })),
    };
    expect(
      ['A', 'B', 'C'].map((p) => computeIvaObra([f], p).totalRepercutido),
    ).toEqual([0.02, 0.01, 0.01]);
  });

  it('una sola obra: igual con y sin projectId', () => {
    const f = {
      kind: 'venta' as const,
      isp: false,
      lines: [{ baseAmount: 100.07, vatPct: 21, projectId: 'A' }],
    };
    expect(computeIvaObra([f], 'A')).toEqual(computeIvaObra([f]));
  });

  it('ISP: la cuota autoliquidada también se reparte', () => {
    const f = { kind: 'compra' as const, isp: true, lines: lineas };
    const a = computeIvaObra([f], 'A');
    const b = computeIvaObra([f], 'B');
    expect(a.ispRecibidas.selfAssessedVat).toBe(21.02);
    expect(b.ispRecibidas.selfAssessedVat).toBe(21.01);
    expect(a.totalSoportado).toBe(0);
  });

  it('original y rectificativa netean a cero obra a obra', () => {
    const rect = {
      kind: 'venta' as const,
      isp: false,
      lines: buildRectificationLines(lineas),
    };
    for (const p of ['A', 'B']) {
      expect(computeIvaObra([factura, rect], p).totalRepercutido).toBe(0);
    }
  });

  it('una factura sin líneas en la obra no cuenta', () => {
    expect(computeIvaObra([factura], 'Z').totalRepercutido).toBe(0);
  });
});

describe('prorratearRetencionesDeObra', () => {
  const mov = (invoiceId: string, amount: number) => ({
    invoiceId,
    direction: 'cobro' as const,
    amount,
    dueDate: '2026-12-01',
    status: 'previsto' as const,
  });

  it('10,01 con bases 100,07/100,07 da 5,01 y 5,00 (suma 10,01)', () => {
    const bases = [
      { invoiceId: 'F', projectId: 'A', baseAmount: 100.07 },
      { invoiceId: 'F', projectId: 'B', baseAmount: 100.07 },
    ];
    const a = prorratearRetencionesDeObra([mov('F', 10.01)], bases, 'A');
    const b = prorratearRetencionesDeObra([mov('F', 10.01)], bases, 'B');
    expect(a.map((m) => m.amount)).toEqual([5.01]);
    expect(b.map((m) => m.amount)).toEqual([5]);
    expect(a[0]).toMatchObject({ direction: 'cobro', dueDate: '2026-12-01' });
  });

  it('3 obras iguales con 100,00: 33,34 / 33,33 / 33,33', () => {
    const bases = ['A', 'B', 'C'].map((projectId) => ({
      invoiceId: 'F',
      projectId,
      baseAmount: 50,
    }));
    expect(
      ['A', 'B', 'C'].map(
        (p) => prorratearRetencionesDeObra([mov('F', 100)], bases, p)[0].amount,
      ),
    ).toEqual([33.34, 33.33, 33.33]);
  });

  it('factura de una sola obra: importe intacto', () => {
    const bases = [{ invoiceId: 'F', projectId: 'A', baseAmount: 200 }];
    const r = prorratearRetencionesDeObra([mov('F', 10)], bases, 'A');
    expect(r.map((m) => m.amount)).toEqual([10]);
  });

  it('línea sin obra: retiene su parte y la obra no se la queda', () => {
    const bases = [
      { invoiceId: 'F', projectId: 'A', baseAmount: 100 },
      { invoiceId: 'F', projectId: null, baseAmount: 100 },
    ];
    const r = prorratearRetencionesDeObra([mov('F', 10)], bases, 'A');
    expect(r.map((m) => m.amount)).toEqual([5]);
  });
});
