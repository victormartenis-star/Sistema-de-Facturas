import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  PURCHASE_ORDER_STATUSES,
  purchaseOrderCreateSchema,
  type PurchaseOrderDto,
  type TraceabilityReportDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

export function registrarPedidos(server: McpServer) {
  server.registerTool(
    'listar_pedidos',
    {
      title: 'Listar pedidos de compra',
      description:
        'Pedidos de compra, con su numeracion por obra (OBR-045-PED-0032). ' +
        'Con receiving=true devuelve solo los pedidos abiertos que todavia ' +
        'esperan material, que son los que se pueden enlazar a un albaran.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Numero de pedido o descripcion'),
        status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
        projectId: z.string().uuid().optional().describe('Obra'),
        contactId: z.string().uuid().optional().describe('Proveedor'),
        receiving: z
          .boolean()
          .optional()
          .describe('true = solo pedidos pendientes de recibir'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ receiving, ...f }) =>
      ejecutar(() =>
        pedir<PurchaseOrderDto[]>(
          `/purchase-orders${query({ ...f, receiving: receiving ? 'true' : '' })}`,
        ),
      ),
  );

  server.registerTool(
    'pedido_detalle',
    {
      title: 'Detalle de pedido',
      description:
        'Un pedido con su importe comprometido y los albaranes recibidos contra el.',
      inputSchema: { id: z.string().uuid().describe('Identificador') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      ejecutar(() => pedir<PurchaseOrderDto>(`/purchase-orders/${id}`)),
  );

  server.registerTool(
    'crear_pedido',
    {
      title: 'Crear pedido de compra',
      description:
        'Crea un pedido. El numero no se envia: la API lo asigna con el ' +
        'correlativo propio de la obra (OBR-045-PED-0032), de modo que el ' +
        'numero identifica a que obra pertenece sin consultarlo en otro sitio.',
      // Lleva un .refine() sobre las fechas, asi que es un ZodEffects.
      inputSchema: purchaseOrderCreateSchema.innerType().shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (entrada) =>
      ejecutar(() =>
        pedir<PurchaseOrderDto>('/purchase-orders', {
          method: 'POST',
          body: JSON.stringify(entrada),
        }),
      ),
  );

  for (const t of [
    {
      nombre: 'cerrar_pedido',
      ruta: 'cerrar',
      titulo: 'Cerrar pedido',
      desc: 'Da el pedido por servido: deja de contar como coste comprometido pendiente.',
    },
    {
      nombre: 'anular_pedido',
      ruta: 'anular',
      titulo: 'Anular pedido',
      desc: 'Anula el pedido conservando su numero y su rastro.',
    },
  ] as const) {
    server.registerTool(
      t.nombre,
      {
        title: t.titulo,
        description: t.desc,
        inputSchema: { id: z.string().uuid().describe('Identificador') },
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async ({ id }) =>
        ejecutar(() =>
          pedir<PurchaseOrderDto>(`/purchase-orders/${id}/${t.ruta}`, {
            method: 'POST',
          }),
        ),
    );
  }

  server.registerTool(
    'trazabilidad',
    {
      title: 'Trazabilidad pedido-albaran-factura',
      description:
        'Cuadre a tres bandas: para cada pedido, que albaranes se recibieron ' +
        'contra el y que facturas los soportan. Es el informe que detecta ' +
        'material facturado sin albaran o albaranes sin pedido.',
      inputSchema: {
        projectId: z
          .string()
          .uuid()
          .optional()
          .describe('Limitar a una obra; si se omite, todas'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(() =>
        pedir<TraceabilityReportDto>(
          `/purchase-orders/trazabilidad${query({ projectId })}`,
        ),
      ),
  );
}
