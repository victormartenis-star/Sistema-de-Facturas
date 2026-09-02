import { describe, expect, it } from 'vitest';
import {
  blockedSupplierWarning,
  buildOrderNumber,
  canReceiveDeliveries,
  deliveryNoteBlockReason,
  deriveOrderStatus,
  parseOrderSeq,
  pendingToDeliver,
  traceabilityReading,
} from './purchase-orders';

describe('numeración de pedidos', () => {
  it('compone el número con el código de obra y el correlativo', () => {
    expect(buildOrderNumber('OBR-045', 32)).toBe('OBR-045-PED-0032');
    expect(buildOrderNumber('OBR-045', 1)).toBe('OBR-045-PED-0001');
  });

  it('no trunca correlativos por encima de 9999', () => {
    expect(buildOrderNumber('OBR-045', 10_000)).toBe('OBR-045-PED-10000');
  });

  it('el número es reversible: se puede leer el correlativo', () => {
    expect(parseOrderSeq('OBR-045-PED-0032')).toBe(32);
    expect(parseOrderSeq(buildOrderNumber('OBR-007', 5))).toBe(5);
  });

  it('devuelve null si el número no tiene el formato', () => {
    expect(parseOrderSeq('PEDIDO 32')).toBeNull();
    expect(parseOrderSeq('OBR-045')).toBeNull();
  });
});

describe('regla de oro: sin pedido no hay albarán validado', () => {
  it('un albarán sin pedido no se valida, con el texto del manual', () => {
    expect(
      deliveryNoteBlockReason({ orderNumber: null, orderStatus: null }),
    ).toBe('Pendiente de validación. Falta número de pedido.');
  });

  it('un albarán con pedido vivo sí se valida', () => {
    expect(
      deliveryNoteBlockReason({
        orderNumber: 'OBR-045-PED-0032',
        orderStatus: 'emitido',
      }),
    ).toBeNull();
    expect(
      deliveryNoteBlockReason({
        orderNumber: 'OBR-045-PED-0032',
        orderStatus: 'servido_parcial',
      }),
    ).toBeNull();
  });

  it('un pedido cerrado o anulado no debería recibir material', () => {
    expect(
      deliveryNoteBlockReason({
        orderNumber: 'OBR-045-PED-0032',
        orderStatus: 'cerrado',
      }),
    ).toContain('no debería recibir más material');
    expect(canReceiveDeliveries('anulado')).toBe(false);
    expect(canReceiveDeliveries('cerrado')).toBe(false);
  });
});

describe('deriveOrderStatus', () => {
  it('sin albaranes el pedido sigue emitido', () => {
    expect(deriveOrderStatus('emitido', 18_500, 0)).toBe('emitido');
  });

  it('con parte servida pasa a servido parcialmente', () => {
    expect(deriveOrderStatus('emitido', 18_500, 10_000)).toBe(
      'servido_parcial',
    );
  });

  it('al completarse el importe pasa a servido', () => {
    expect(deriveOrderStatus('servido_parcial', 18_500, 18_500)).toBe(
      'servido',
    );
  });

  it('un céntimo de diferencia no impide darlo por servido', () => {
    expect(deriveOrderStatus('servido_parcial', 18_500, 18_500.01)).toBe(
      'servido',
    );
  });

  it('servir de más también deja el pedido servido', () => {
    expect(deriveOrderStatus('emitido', 18_500, 19_000)).toBe('servido');
  });

  it('los estados terminales no se recalculan solos', () => {
    // Facturado o cerrado son decisiones administrativas: que llegue un
    // albarán tardío no debe reabrir el pedido por su cuenta.
    expect(deriveOrderStatus('facturado', 18_500, 0)).toBe('facturado');
    expect(deriveOrderStatus('cerrado', 18_500, 5_000)).toBe('cerrado');
    expect(deriveOrderStatus('anulado', 18_500, 18_500)).toBe('anulado');
  });
});

describe('pendingToDeliver', () => {
  it('descuenta lo servido', () => {
    expect(pendingToDeliver(18_500, 10_000)).toBe(8_500);
  });

  it('nunca es negativo aunque se sirva de más', () => {
    expect(pendingToDeliver(18_500, 19_000)).toBe(0);
  });
});

describe('lectura del cuadro de trazabilidad', () => {
  it('pedido con albarán y factura: ciclo completo', () => {
    expect(
      traceabilityReading({
        hasDeliveryNote: true,
        hasInvoice: true,
        accrualAmount: 0,
      }),
    ).toBe('Ciclo completo');
  });

  it('recibido sin factura: avisa del coste oculto', () => {
    expect(
      traceabilityReading({
        hasDeliveryNote: true,
        hasInvoice: false,
        accrualAmount: 80_000,
      }),
    ).toContain('coste real oculto si no se provisiona');
  });

  it('facturado solo en parte se distingue del ciclo completo', () => {
    expect(
      traceabilityReading({
        hasDeliveryNote: true,
        hasInvoice: true,
        accrualAmount: 5_000,
      }),
    ).toContain('el resto sigue pendiente de factura');
  });

  it('factura sin albarán señala que no debió aprobarse', () => {
    expect(
      traceabilityReading({
        hasDeliveryNote: false,
        hasInvoice: true,
        accrualAmount: 0,
      }),
    ).toContain('no debería haberse aprobado');
  });

  it('sin albarán ni factura es riesgo de plazo', () => {
    expect(
      traceabilityReading({
        hasDeliveryNote: false,
        hasInvoice: false,
        accrualAmount: 0,
      }),
    ).toContain('riesgo de plazo');
  });
});

describe('blockedSupplierWarning', () => {
  const pedido = (
    contactName: string,
    amount: number,
    supplierBlocked: boolean,
  ) => ({
    contactName,
    amount,
    supplierBlocked,
  });

  it('avisa del importe comprometido con subcontratas bloqueadas', () => {
    // El caso real: 310.000 € pedidos a una empresa sin REA y 235.000 € a
    // otra con el seguro caducado. El ERP no dijo nada hasta la factura.
    const aviso = blockedSupplierWarning([
      pedido('Cerramientos Cordón S.L.', 310_000, true),
      pedido('Instalaciones Vallecas S.L.', 235_000, true),
      pedido('Derribos Rivas S.L.', 145_000, false),
    ]);
    expect(aviso).toContain('545.000,00 €');
    expect(aviso).toContain('Cerramientos Cordón S.L.');
    expect(aviso).toContain('Instalaciones Vallecas S.L.');
    expect(aviso).not.toContain('Rivas');
  });

  it('dice por qué avisar ahora y no al facturar', () => {
    const aviso = blockedSupplierWarning([
      pedido('Subcontrata S.L.', 1_000, true),
    ]);
    expect(aviso).toContain('el trabajo ya está hecho');
  });

  it('no repite la empresa que tiene varios pedidos', () => {
    const aviso = blockedSupplierWarning([
      pedido('Subcontrata S.L.', 1_000, true),
      pedido('Subcontrata S.L.', 2_000, true),
    ]);
    expect(aviso).toContain('3000,00 €');
    expect(aviso?.match(/Subcontrata S\.L\./g)).toHaveLength(1);
  });

  it('sin subcontratas bloqueadas no hay aviso', () => {
    expect(
      blockedSupplierWarning([pedido('Derribos Rivas S.L.', 145_000, false)]),
    ).toBeNull();
  });

  it('sin pedidos tampoco', () => {
    expect(blockedSupplierWarning([])).toBeNull();
  });
});
