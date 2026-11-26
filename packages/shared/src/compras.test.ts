import { describe, expect, it } from 'vitest';
import { can } from './capacidades';
import {
  ErrorCompras,
  SOLICITUD_COMPRA_TRANSITIONS,
  TOLERANCIAS_CUADRE_POR_DEFECTO,
  comparativaOfertas,
  cuadreFactura,
  cuadreTresBandas,
  ejecutadoPedido,
  estadoLineaPedido,
  importeLinea,
  totalLineas,
  validarLineasCompra,
  validarRecepcionLinea,
} from './compras';
import { comprometidoPendiente } from './calculo';
import { transicion } from './maquina-estados';

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ErrorCompras).codigo ?? (e as { codigo?: string }).codigo;
  }
  return null;
};

describe('importes de línea exactos', () => {
  it('cantidad (3 dec) × precio (4 dec) half-up al céntimo', () => {
    expect(importeLinea('2.5', '10.1234')).toBe(2531n); // 25,3085 → 25,31
    expect(importeLinea(3, '0.3333')).toBe(100n); // 0,9999 → 1,00
    expect(importeLinea('0.001', '4.9999')).toBe(0n);
    expect(
      totalLineas([
        { cantidad: 3, precioUnitario: '0.3333' },
        { cantidad: 1, precioUnitario: '0.005' },
      ]),
    ).toBe(1.01);
  });
});

describe('validación de líneas y estados', () => {
  it('líneas: cantidad positiva, artículo solo en material y sin repetir, precio exigido', () => {
    expect(codigo(() => validarLineasCompra([]))).toBe('P2P_LINES_REQUIRED');
    expect(
      codigo(() =>
        validarLineasCompra([
          { tipo: 'material', descripcion: 'x', cantidad: 0 },
        ]),
      ),
    ).toBe('P2P_LINE_INVALID');
    expect(
      codigo(() =>
        validarLineasCompra([
          { tipo: 'servicio', articuloId: 'a', descripcion: 'x', cantidad: 1 },
        ]),
      ),
    ).toBe('P2P_LINE_INVALID');
    expect(
      codigo(() =>
        validarLineasCompra([
          { tipo: 'material', articuloId: 'a', descripcion: 'x', cantidad: 1 },
          { tipo: 'material', articuloId: 'a', descripcion: 'y', cantidad: 2 },
        ]),
      ),
    ).toBe('P2P_LINE_INVALID');
    expect(
      codigo(() =>
        validarLineasCompra(
          [{ tipo: 'gasto', descripcion: 'x', cantidad: 1 }],
          { exigirPrecio: true },
        ),
      ),
    ).toBe('P2P_LINE_INVALID');
    expect(
      codigo(() =>
        validarLineasCompra(
          [{ tipo: 'gasto', descripcion: 'x', cantidad: 1, precioUnitario: 3 }],
          { exigirPrecio: true },
        ),
      ),
    ).toBeNull();
  });

  it('ciclo de la solicitud: rechazada vuelve a borrador; convertida es terminal', () => {
    expect(() =>
      transicion('purchase_requisition', 'solicitada', 'aprobada'),
    ).not.toThrow();
    expect(() =>
      transicion('purchase_requisition', 'rechazada', 'borrador'),
    ).not.toThrow();
    expect(() =>
      transicion('purchase_requisition', 'borrador', 'aprobada'),
    ).toThrow();
    expect(SOLICITUD_COMPRA_TRANSITIONS.convertida).toEqual([]);
    expect(() =>
      transicion('purchase_rfq', 'adjudicada', 'cancelada'),
    ).toThrow();
  });

  it('permisos de interfaz: el jefe de obra solicita y recibe; aprobar y adjudicar es de administración', () => {
    expect(can('obra', 'crear', 'solicitud_compra')).toBe(true);
    expect(can('obra', 'crear', 'recepcion')).toBe(true);
    expect(can('obra', 'cambiarEstado', 'compra')).toBe(false);
    expect(can('administracion', 'cambiarEstado', 'compra')).toBe(true);
    expect(can('lector', 'crear', 'solicitud_compra')).toBe(false);
  });
});

describe('recepción y pendientes por línea', () => {
  it('recepción parcial y total; no supera lo pedido', () => {
    expect(
      validarRecepcionLinea({
        cantidadPedida: 10,
        recibidaPrevia: 0,
        cantidad: 4,
        precioUnitario: '12.5',
      }),
    ).toBe(5000n);
    expect(
      validarRecepcionLinea({
        cantidadPedida: 10,
        recibidaPrevia: 4,
        cantidad: 6,
        precioUnitario: '12.5',
      }),
    ).toBe(7500n);
    expect(
      codigo(() =>
        validarRecepcionLinea({
          cantidadPedida: 10,
          recibidaPrevia: 4,
          cantidad: '6.001',
          precioUnitario: 1,
        }),
      ),
    ).toBe('P2P_RECEIPT_EXCEEDS_ORDER');
    expect(
      codigo(() =>
        validarRecepcionLinea({
          cantidadPedida: 10,
          recibidaPrevia: 0,
          cantidad: 0,
          precioUnitario: 1,
        }),
      ),
    ).toBe('P2P_RECEIPT_INVALID');
    // Con tolerancia de sobre-entrega del 10 %: hasta 11.
    expect(
      validarRecepcionLinea({
        cantidadPedida: 10,
        recibidaPrevia: 0,
        cantidad: 11,
        precioUnitario: 1,
        toleranciaPct: 10,
      }),
    ).toBe(1100n);
  });

  it('pendiente de recibir y de facturar; recibido sin facturar valorado', () => {
    expect(
      estadoLineaPedido({
        cantidad: 10,
        precioUnitario: '12.5',
        recibida: 4,
        facturada: 1,
        importeFacturado: '12.50',
        exigeRecepcion: true,
      }),
    ).toEqual({
      pedida: '10.000',
      recibida: '4.000',
      facturada: '1.000',
      importePedido: 125,
      importeRecibido: 50,
      importeFacturado: 12.5,
      pendienteRecibir: '6.000',
      pendienteFacturar: '3.000',
      recibidoSinFacturar: 37.5,
    });
    // Sin recepción exigida (servicio facturado contra pedido): facturable es lo pedido.
    expect(
      estadoLineaPedido({
        cantidad: 1,
        precioUnitario: 900,
        recibida: 0,
        facturada: 0,
        importeFacturado: 0,
        exigeRecepcion: false,
      }).pendienteFacturar,
    ).toBe('1.000');
  });
});

describe('cuadre a tres bandas por línea', () => {
  const T = TOLERANCIAS_CUADRE_POR_DEFECTO;
  const base = {
    lineaPedidoId: 'l1',
    cantidadPedida: 10,
    precioPedido: '12.50',
    cantidadRecibida: 4,
    facturadaPrevia: 0,
    exigeRecepcion: true,
    tolerancias: T,
  };

  it('cuadra con lo recibido y el precio del pedido', () => {
    expect(
      cuadreTresBandas({ ...base, cantidadFactura: 4, precioFactura: '12.50' }),
    ).toMatchObject({ estado: 'cuadra', motivos: [], sobreprecio: 0 });
    // Precio inferior: no bloquea.
    expect(
      cuadreTresBandas({ ...base, cantidadFactura: 4, precioFactura: 10 })
        .estado,
    ).toBe('cuadra');
  });

  it('bloquea por cantidad sobre lo recibido y sin recepción', () => {
    const r = cuadreTresBandas({
      ...base,
      cantidadFactura: 5,
      precioFactura: '12.50',
    });
    expect(r.estado).toBe('bloqueada');
    expect(r.motivos.map((m) => m.codigo)).toEqual([
      'P2P_MATCH_QUANTITY_VARIANCE',
    ]);
    expect(r.limiteCantidad).toBe('4.000');
    const sin = cuadreTresBandas({
      ...base,
      cantidadRecibida: 0,
      cantidadFactura: 1,
      precioFactura: '12.50',
    });
    expect(sin.motivos.map((m) => m.codigo)).toEqual([
      'P2P_MATCH_NOT_RECEIVED',
    ]);
    // Facturado previo suma: 3 antes + 2 ahora > 4 recibidos.
    expect(
      cuadreTresBandas({
        ...base,
        facturadaPrevia: 3,
        cantidadFactura: 2,
        precioFactura: '12.50',
      }).estado,
    ).toBe('bloqueada');
  });

  it('precio: tolerancia del 2 % y 50 €; se aplica la más estricta', () => {
    // +2 % exacto (12,75) sobre 4 ud = 1,00 € de sobreprecio: cuadra.
    expect(
      cuadreTresBandas({ ...base, cantidadFactura: 4, precioFactura: '12.75' }),
    ).toMatchObject({ estado: 'cuadra', sobreprecio: 1 });
    // +2,08 %: bloquea por porcentaje aunque el importe sea pequeño.
    expect(
      cuadreTresBandas({ ...base, cantidadFactura: 4, precioFactura: '12.76' })
        .motivos[0].codigo,
    ).toBe('P2P_MATCH_PRICE_VARIANCE');
    // Dentro del % pero > 50 € por la cantidad: bloquea por importe.
    const grande = cuadreTresBandas({
      ...base,
      cantidadPedida: 1000,
      cantidadRecibida: 1000,
      cantidadFactura: 1000,
      precioPedido: 100,
      precioFactura: '101',
    });
    expect(grande).toMatchObject({ estado: 'bloqueada', sobreprecio: 1000 });
  });

  it('factura directa contra pedido (sin recepción exigida) y tolerancia de cantidad', () => {
    const directa = { ...base, exigeRecepcion: false, cantidadRecibida: 0 };
    expect(
      cuadreTresBandas({
        ...directa,
        cantidadFactura: 10,
        precioFactura: '12.50',
      }).estado,
    ).toBe('cuadra');
    expect(
      cuadreTresBandas({
        ...directa,
        cantidadFactura: 11,
        precioFactura: '12.50',
      }).estado,
    ).toBe('bloqueada');
    expect(
      cuadreTresBandas({
        ...directa,
        cantidadFactura: 11,
        precioFactura: '12.50',
        tolerancias: { ...T, cantidadPct: 10 },
      }).estado,
    ).toBe('cuadra');
  });

  it('varias líneas de factura contra la misma línea de pedido se acumulan', () => {
    const r = cuadreFactura(
      [
        { ...base, cantidadFactura: 3, precioFactura: '12.50' },
        { ...base, cantidadFactura: 2, precioFactura: '12.50' },
      ],
      new Map([['l1', 0]]),
    );
    expect(r.lineas.map((l) => [l.facturadaPrevia, l.estado])).toEqual([
      ['0.000', 'cuadra'],
      ['3.000', 'bloqueada'],
    ]);
    expect(r.bloqueada).toBe(true);
  });
});

describe('comparativa de ofertas', () => {
  const lineas = [
    { id: 'a', descripcion: 'Cemento', cantidad: 100 },
    { id: 'b', descripcion: 'Arena', cantidad: '2.5' },
  ];
  it('mejor por línea, total por proveedor, oferta completa más baja y caducadas', () => {
    const r = comparativaOfertas({
      fecha: '2026-11-20',
      lineas,
      proveedores: [
        {
          contactId: 'p1',
          contactName: 'Uno',
          plazoDias: 5,
          validaHasta: null,
          precios: [
            { lineaId: 'a', precioUnitario: 6 },
            { lineaId: 'b', precioUnitario: 40 },
          ],
        },
        {
          contactId: 'p2',
          contactName: 'Dos',
          plazoDias: 3,
          validaHasta: '2026-12-31',
          precios: [{ lineaId: 'a', precioUnitario: '5.9' }],
        },
        {
          contactId: 'p3',
          contactName: 'Tres',
          plazoDias: 1,
          validaHasta: '2026-11-01',
          precios: [
            { lineaId: 'a', precioUnitario: 5 },
            { lineaId: 'b', precioUnitario: 30 },
          ],
        },
      ],
    });
    expect(r.lineas[0].ofertas.map((o) => o.contactId)).toEqual([
      'p3',
      'p2',
      'p1',
    ]);
    // p3 caducó: no es la mejor.
    expect(r.lineas[0].mejor).toEqual({
      contactId: 'p2',
      precioUnitario: '5.9000',
      importe: 590,
    });
    expect(r.lineas[1].mejor).toMatchObject({ contactId: 'p1', importe: 100 });
    expect(r.ofertas.map((o) => [o.contactId, o.total, o.completa])).toEqual(
      [
        ['p2', 590, false],
        ['p3', 575, true],
        ['p1', 700, true],
      ].sort((x, y) => (x[1] as number) - (y[1] as number)),
    );
    expect(r.mejorCompleta).toBe('p1');
    expect(r.totalMejorPorLinea).toBe(690);
  });
});

describe('comprometido sin duplicar', () => {
  it('lo facturado contra líneas del pedido descuenta el comprometido como los albaranes', () => {
    const ejecutado = ejecutadoPedido({
      albaranesFacturados: '100.00',
      lineasFacturadas: '250.50',
    });
    expect(ejecutado).toBe('350.50');
    expect(comprometidoPendiente([{ importe: 1000, ejecutado }])).toBe(649.5);
    // Sobreejecutado no resta.
    expect(
      comprometidoPendiente([
        {
          importe: 100,
          ejecutado: ejecutadoPedido({
            albaranesFacturados: 0,
            lineasFacturadas: 150,
          }),
        },
      ]),
    ).toBe(0);
  });
});
