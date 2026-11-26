import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  deliveryNotes,
  invoiceLines,
  invoices,
  purchaseOrderLines,
  purchaseOrders,
  type DbOrTx,
  type Invoice,
} from '@erp/db';
import {
  cuadreFactura,
  importeLinea,
  toCents,
  type CuadreFacturaDto,
} from '@erp/shared';

/** Facturas que cuentan como facturado contra el pedido. */
export const FACTURAS_CON_EFECTO = ['aprobada', 'pagada'] as const;

/** Recibido (Σ recepciones) y facturado (Σ facturas con efecto) por línea de pedido. */
export async function cantidadesPorLinea(
  ex: DbOrTx,
  lineaIds: string[],
  excluirFacturaId?: string,
): Promise<
  Map<string, { recibida: string; facturada: string; importeFacturado: string }>
> {
  const out = new Map<
    string,
    { recibida: string; facturada: string; importeFacturado: string }
  >();
  if (lineaIds.length === 0) return out;
  for (const id of lineaIds) {
    out.set(id, { recibida: '0', facturada: '0', importeFacturado: '0' });
  }
  const recibido = await ex.execute(sql`
    select order_line_id as id, sum(quantity)::text as q
    from goods_receipt_lines
    where order_line_id in (${sql.join(
      lineaIds.map((i) => sql`${i}`),
      sql`, `,
    )})
    group by order_line_id`);
  for (const r of recibido.rows as { id: string; q: string }[]) {
    out.get(r.id)!.recibida = r.q;
  }
  const facturado = await ex.execute(sql`
    select il.purchase_order_line_id as id, sum(il.quantity)::text as q,
      sum(il.base_amount)::text as importe
    from invoice_lines il
    join invoices i on i.id = il.invoice_id
    where il.purchase_order_line_id in (${sql.join(
      lineaIds.map((i) => sql`${i}`),
      sql`, `,
    )})
      and i.status in ('aprobada', 'pagada') and i.deleted_at is null
      ${excluirFacturaId ? sql`and i.id <> ${excluirFacturaId}` : sql``}
    group by il.purchase_order_line_id`);
  for (const r of facturado.rows as {
    id: string;
    q: string;
    importe: string;
  }[]) {
    const f = out.get(r.id)!;
    f.facturada = r.q;
    f.importeFacturado = r.importe;
  }
  return out;
}

/**
 * Valida las líneas de una factura de compra enlazadas a líneas de pedido
 * (antes de guardarlas): cantidad y precio presentes y base = cantidad ×
 * precio; línea de pedido de la empresa y del mismo proveedor; sin mezclar
 * con albaranes. Devuelve el pedido común (o null si no hay enlaces).
 */
export async function validarLineasFacturaCompra(
  ex: DbOrTx,
  x: {
    companyId: string;
    kind: string;
    contactId: string;
    deliveryNoteIds: string[];
    lineas: {
      baseAmount: number;
      purchaseOrderLineId?: string | null;
      quantity?: number | null;
      unitPrice?: number | null;
    }[];
  },
): Promise<void> {
  const enlazadas = x.lineas.filter((l) => l.purchaseOrderLineId);
  if (enlazadas.length === 0) return;
  if (x.kind !== 'compra') {
    throw new UnprocessableEntityException({
      code: 'P2P_LINE_INVALID',
      message: 'Solo las facturas de compra se enlazan a líneas de pedido',
    });
  }
  if (enlazadas.length !== x.lineas.length) {
    throw new UnprocessableEntityException({
      code: 'P2P_MATCH_MIXED',
      message:
        'Una factura con cuadre por línea enlaza todas sus líneas a líneas de pedido',
    });
  }
  if (x.deliveryNoteIds.length > 0) {
    throw new UnprocessableEntityException({
      code: 'P2P_MATCH_MIXED',
      message:
        'La factura enlaza líneas de pedido: no vincules además albaranes (se contaría dos veces)',
    });
  }
  for (const l of enlazadas) {
    if (l.quantity == null || l.unitPrice == null) {
      throw new UnprocessableEntityException({
        code: 'P2P_LINE_INVALID',
        message:
          'Cada línea enlazada a pedido lleva cantidad y precio unitario',
      });
    }
    if (toCents(l.baseAmount) !== importeLinea(l.quantity, l.unitPrice)) {
      throw new UnprocessableEntityException({
        code: 'P2P_LINE_AMOUNT_MISMATCH',
        message: `La base de la línea (${l.baseAmount.toFixed(2)}) no es cantidad × precio`,
      });
    }
  }
  const ids = [...new Set(enlazadas.map((l) => l.purchaseOrderLineId!))];
  const filas = await ex
    .select({ id: purchaseOrderLines.id, contactId: purchaseOrders.contactId })
    .from(purchaseOrderLines)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, purchaseOrderLines.orderId),
    )
    .where(
      and(
        inArray(purchaseOrderLines.id, ids),
        eq(purchaseOrderLines.companyId, x.companyId),
        isNull(purchaseOrders.deletedAt),
      ),
    );
  if (filas.length !== ids.length) {
    throw new UnprocessableEntityException({
      code: 'P2P_LINE_NOT_FOUND',
      message: 'Alguna línea de pedido no existe',
    });
  }
  if (filas.some((f) => f.contactId !== x.contactId)) {
    throw new UnprocessableEntityException({
      code: 'P2P_MATCH_OTHER_SUPPLIER',
      message: 'La línea de pedido es de otro proveedor',
    });
  }
}

/**
 * Cuadre a tres bandas de una factura de compra (pedido ↔ recepción ↔
 * factura) por línea. `bloquear` toma los pedidos en `FOR UPDATE` (orden por
 * id) para que dos aprobaciones simultáneas no facturen dos veces lo mismo.
 * Devuelve null si la factura no tiene líneas enlazadas a pedido.
 */
export async function cuadreDeFactura(
  ex: DbOrTx,
  factura: Pick<Invoice, 'id' | 'invoiceNumber' | 'status'>,
  bloquear = false,
): Promise<CuadreFacturaDto | null> {
  const lineas = await ex
    .select({
      poLineId: invoiceLines.purchaseOrderLineId,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, factura.id))
    .orderBy(invoiceLines.sortOrder);
  const enlazadas = lineas.filter((l) => l.poLineId);
  if (enlazadas.length === 0) return null;
  const ids = [...new Set(enlazadas.map((l) => l.poLineId!))];
  const pedidos = await ex
    .select({
      line: purchaseOrderLines,
      order: purchaseOrders,
    })
    .from(purchaseOrderLines)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, purchaseOrderLines.orderId),
    )
    .where(inArray(purchaseOrderLines.id, ids));
  if (bloquear) {
    const orderIds = [...new Set(pedidos.map((p) => p.order.id))].sort();
    await ex
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, orderIds))
      .orderBy(purchaseOrders.id)
      .for('update');
  }
  const porLinea = new Map(pedidos.map((p) => [p.line.id, p]));
  const cantidades = await cantidadesPorLinea(ex, ids, factura.id);
  const r = cuadreFactura(
    enlazadas.map((l) => {
      const p = porLinea.get(l.poLineId!)!;
      return {
        lineaPedidoId: l.poLineId!,
        cantidadPedida: p.line.quantity,
        precioPedido: p.line.unitPrice,
        cantidadRecibida: cantidades.get(l.poLineId!)!.recibida,
        exigeRecepcion: p.line.requiresReceipt,
        cantidadFactura: l.quantity!,
        precioFactura: l.unitPrice!,
        tolerancias: {
          precioPct: p.order.priceTolerancePct,
          precioImporte: p.order.priceToleranceAmount,
          cantidadPct: p.order.quantityTolerancePct,
        },
      };
    }),
    new Map(ids.map((id) => [id, cantidades.get(id)!.facturada])),
  );
  return {
    invoiceId: factura.id,
    invoiceNumber: factura.invoiceNumber,
    pedidoId: pedidos[0].order.id,
    estadoFactura: factura.status,
    bloqueada: r.bloqueada,
    lineas: r.lineas,
  };
}

/**
 * En la aprobación de una factura de compra con líneas de pedido: aplica el
 * cuadre (bloqueando los pedidos) y rechaza la aprobación si alguna línea
 * queda fuera de tolerancia (bloqueo para pago). Devuelve true si la factura
 * se aprueba por cuadre por línea (sustituye a la regla de albaranes).
 */
export async function exigirCuadreEnAprobacion(
  ex: DbOrTx,
  factura: Pick<Invoice, 'id' | 'invoiceNumber' | 'status'>,
): Promise<boolean> {
  const c = await cuadreDeFactura(ex, factura, true);
  if (!c) return false;
  const [albaran] = await ex
    .select({ id: deliveryNotes.id })
    .from(deliveryNotes)
    .where(
      and(
        eq(deliveryNotes.invoiceId, factura.id),
        isNull(deliveryNotes.deletedAt),
      ),
    )
    .limit(1);
  if (albaran) {
    throw new UnprocessableEntityException({
      code: 'P2P_MATCH_MIXED',
      message:
        'La factura enlaza líneas de pedido y además albaranes: desvincula los albaranes',
    });
  }
  if (c.bloqueada) {
    throw new ConflictException({
      code: 'P2P_MATCH_BLOCKED',
      message: `La factura ${factura.invoiceNumber} no cuadra con el pedido y la recepción: ${c.lineas
        .flatMap((l) => l.motivos.map((m) => m.detalle))
        .join(' · ')}`,
      lineas: c.lineas.filter((l) => l.estado === 'bloqueada'),
    });
  }
  return true;
}

/** Facturado directamente contra líneas de cada pedido (para el comprometido). */
export async function facturadoPorLineasDePedidos(
  ex: DbOrTx,
  orderIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (orderIds.length === 0) return out;
  const r = await ex
    .select({
      orderId: purchaseOrderLines.orderId,
      importe: sql<string>`coalesce(sum(${invoiceLines.baseAmount}), 0)::text`,
    })
    .from(invoiceLines)
    .innerJoin(
      purchaseOrderLines,
      eq(purchaseOrderLines.id, invoiceLines.purchaseOrderLineId),
    )
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        inArray(purchaseOrderLines.orderId, orderIds),
        inArray(invoices.status, [...FACTURAS_CON_EFECTO]),
        isNull(invoices.deletedAt),
      ),
    )
    .groupBy(purchaseOrderLines.orderId);
  for (const f of r) out.set(f.orderId, f.importe);
  return out;
}
