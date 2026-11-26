import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  adjudicarPeticionSchema,
  convertirEnPedidoSchema,
  convertirEnPeticionSchema,
  facturaPedidoCreateSchema,
  ofertaRegistrarSchema,
  pedidoLineasCreateSchema,
  recepcionCreateSchema,
  solicitudCompraCreateSchema,
  type CuadreFacturaDto,
  type InvoiceDto,
  type PedidoCompraDetalleDto,
  type PeticionOfertaDto,
  type SolicitudCompraDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const id = z.string().uuid();
const idem = () => ({ 'Idempotency-Key': randomUUID() });

/**
 * Procure-to-Pay por la API: solicitudes de compra, peticiones de ofertas
 * (comparativa y adjudicación), pedidos con líneas, recepciones y
 * verificación de facturas con cuadre a tres bandas por línea.
 */
export function registrarCompras(server: McpServer) {
  server.registerTool(
    'solicitudes_compra',
    {
      title: 'Solicitudes de compra',
      description:
        'Lista las solicitudes (estado, líneas, importe estimado y documento al que se convirtieron).',
      inputSchema: { projectId: id.optional(), estado: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() =>
        pedir<SolicitudCompraDto[]>(`/compras/solicitudes${query(q)}`),
      ),
  );

  server.registerTool(
    'crear_solicitud_compra',
    {
      title: 'Crear una solicitud de compra',
      description:
        'Solicitud por obra con líneas (material de almacén, servicio, subcontrata o gasto). Con `enviar` queda solicitada para aprobación. También el jefe de obra (en sus obras).',
      inputSchema: solicitudCompraCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<SolicitudCompraDto>('/compras/solicitudes', {
          method: 'POST',
          body: JSON.stringify(solicitudCompraCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'decidir_solicitud_compra',
    {
      title: 'Enviar, aprobar o rechazar una solicitud',
      description:
        'Segregación: quien solicita no aprueba (P2P_SOD_SELF_APPROVAL). Rechazar exige motivo. Lee la versión y envía If-Match.',
      inputSchema: {
        id: id.describe('Id de la solicitud'),
        accion: z.enum(['enviar', 'aprobar', 'rechazar']),
        motivo: z.string().trim().min(3).max(240).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ id: sid, accion, motivo }) =>
      ejecutar(() =>
        pedirVersionado<SolicitudCompraDto>(
          `/compras/solicitudes/${sid}/${accion}`,
          {
            method: 'POST',
            body: JSON.stringify(accion === 'rechazar' ? { motivo } : {}),
          },
          async () =>
            (await pedir<SolicitudCompraDto>(`/compras/solicitudes/${sid}`))
              .version,
          'solicitud',
        ),
      ),
  );

  server.registerTool(
    'convertir_solicitud_compra',
    {
      title: 'Convertir una solicitud aprobada',
      description:
        '`destino: pedido` emite el pedido a un proveedor (precios por línea o el estimado); `destino: peticion` pide ofertas a varios proveedores. Error: P2P_REQUISITION_NOT_APPROVED.',
      inputSchema: {
        id: id.describe('Id de la solicitud'),
        destino: z.enum(['pedido', 'peticion']),
        pedido: convertirEnPedidoSchema.optional(),
        peticion: convertirEnPeticionSchema.optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: sid, destino, pedido, peticion }) =>
      ejecutar(() =>
        pedirVersionado<PedidoCompraDetalleDto | PeticionOfertaDto>(
          `/compras/solicitudes/${sid}/${destino}`,
          {
            method: 'POST',
            body: JSON.stringify(
              destino === 'pedido'
                ? convertirEnPedidoSchema.parse(pedido)
                : convertirEnPeticionSchema.parse(peticion),
            ),
            headers: idem(),
          },
          async () =>
            (await pedir<SolicitudCompraDto>(`/compras/solicitudes/${sid}`))
              .version,
          'solicitud',
        ),
      ),
  );

  server.registerTool(
    'peticiones_ofertas',
    {
      title: 'Peticiones de ofertas con su comparativa',
      description:
        'Cada petición con proveedores invitados, ofertas por línea y comparativa (mejor por línea, total por proveedor, oferta completa más baja; las caducadas no cuentan).',
      inputSchema: { id: id.optional().describe('Una petición concreta') },
      annotations: { readOnlyHint: true },
    },
    async ({ id: pid }) =>
      ejecutar<PeticionOfertaDto | PeticionOfertaDto[]>(() =>
        pid
          ? pedir<PeticionOfertaDto>(`/compras/peticiones/${pid}`)
          : pedir<PeticionOfertaDto[]>('/compras/peticiones'),
      ),
  );

  server.registerTool(
    'registrar_oferta',
    {
      title: 'Registrar la oferta de un proveedor',
      description:
        'Precio por línea, plazo, validez y condiciones de un proveedor invitado (sustituye su oferta anterior).',
      inputSchema: {
        id: id.describe('Id de la petición'),
        ...ofertaRegistrarSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id: pid, ...body }) =>
      ejecutar(() =>
        pedir<PeticionOfertaDto>(`/compras/peticiones/${pid}/ofertas`, {
          method: 'POST',
          body: JSON.stringify(ofertaRegistrarSchema.parse(body)),
        }),
      ),
  );

  server.registerTool(
    'adjudicar_peticion',
    {
      title: 'Adjudicar una petición de ofertas',
      description:
        'Todo a un proveedor (`contactId`) o por línea (`porLinea`); emite un pedido por proveedor con sus precios. Errores: P2P_RFQ_QUOTE_MISSING, P2P_RFQ_QUOTE_EXPIRED.',
      inputSchema: {
        id: id.describe('Id de la petición'),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        contactId: id.optional(),
        porLinea: z.array(z.object({ lineaId: id, contactId: id })).optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: pid, ...body }) =>
      ejecutar(() =>
        pedirVersionado<PeticionOfertaDto>(
          `/compras/peticiones/${pid}/adjudicar`,
          {
            method: 'POST',
            body: JSON.stringify(adjudicarPeticionSchema.parse(body)),
            headers: idem(),
          },
          async () =>
            (await pedir<PeticionOfertaDto>(`/compras/peticiones/${pid}`))
              .version,
          'petición',
        ),
      ),
  );

  server.registerTool(
    'pedido_compra',
    {
      title: 'Pedido de compra con líneas',
      description:
        'Líneas con pedido, recibido, facturado, pendientes y recibido sin facturar; recepciones y facturas. Sin `id`, los pedidos con líneas.',
      inputSchema: { id: id.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ id: oid }) =>
      ejecutar<PedidoCompraDetalleDto | PedidoCompraDetalleDto[]>(() =>
        oid
          ? pedir<PedidoCompraDetalleDto>(`/compras/pedidos/${oid}`)
          : pedir<PedidoCompraDetalleDto[]>('/compras/pedidos'),
      ),
  );

  server.registerTool(
    'crear_pedido_compra',
    {
      title: 'Emitir un pedido directo con líneas',
      description:
        'Pedido sin solicitud previa, con tolerancias opcionales del cuadre. Control presupuestario por el importe.',
      inputSchema: pedidoLineasCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<PedidoCompraDetalleDto>('/compras/pedidos', {
          method: 'POST',
          body: JSON.stringify(pedidoLineasCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'registrar_recepcion',
    {
      title: 'Registrar la recepción de un pedido',
      description:
        'Recepción parcial o total por línea con el albarán del proveedor; el material de stock entra en `almacenId` (lotes o series si el artículo los exige). Error: P2P_RECEIPT_EXCEEDS_ORDER.',
      inputSchema: {
        id: id.describe('Id del pedido'),
        ...recepcionCreateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: oid, ...body }) =>
      ejecutar(() =>
        pedir<PedidoCompraDetalleDto>(`/compras/pedidos/${oid}/recepciones`, {
          method: 'POST',
          body: JSON.stringify(recepcionCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'verificar_factura_pedido',
    {
      title: 'Verificar la factura del proveedor contra el pedido',
      description:
        'Crea la factura de compra en borrador enlazada a las líneas del pedido y devuelve el cuadre a tres bandas. Se aprueba con `POST /invoices/:id/aprobar`; si no cuadra, la aprobación responde P2P_MATCH_BLOCKED.',
      inputSchema: {
        id: id.describe('Id del pedido'),
        ...facturaPedidoCreateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: oid, ...body }) =>
      ejecutar(() =>
        pedir<{ factura: InvoiceDto; cuadre: CuadreFacturaDto | null }>(
          `/compras/pedidos/${oid}/factura`,
          {
            method: 'POST',
            body: JSON.stringify(facturaPedidoCreateSchema.parse(body)),
            headers: idem(),
          },
        ),
      ),
  );

  server.registerTool(
    'cuadre_factura',
    {
      title: 'Cuadre a tres bandas de una factura',
      description:
        'Por línea: pedido, recibido, facturado previo, límite, sobreprecio, estado y motivos de bloqueo.',
      inputSchema: { invoiceId: id },
      annotations: { readOnlyHint: true },
    },
    async ({ invoiceId }) =>
      ejecutar(
        async () =>
          (await pedir<CuadreFacturaDto | null>(
            `/compras/facturas/${invoiceId}/cuadre`,
          )) ?? { sinCuadre: true },
      ),
  );
}
