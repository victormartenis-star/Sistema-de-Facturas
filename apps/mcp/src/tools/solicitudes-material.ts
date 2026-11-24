import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ESTADOS_SOLICITUD_MATERIAL,
  pedidoFaltanteSchema,
  servirSolicitudSchema,
  solicitudMaterialCreateSchema,
  type MovimientoStockDto,
  type PurchaseOrderDto,
  type SolicitudMaterialDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const post = (cuerpo: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(cuerpo),
  headers: { 'Idempotency-Key': randomUUID() },
});

/**
 * Solicitudes de material de obra: reserva de stock por obra, faltante,
 * servicio (consumo a obra a PMP) y pedido de compra del faltante.
 */
export function registrarSolicitudesMaterial(server: McpServer) {
  server.registerTool(
    'solicitudes_material',
    {
      title: 'Solicitudes de material',
      description:
        'Solicitudes de material de las obras con sus líneas: solicitada, ' +
        'reservada en almacén, servida, faltante (a comprar) y pedido que lo ' +
        'cubre. conFaltante=true deja las que tienen faltante sin pedido.',
      inputSchema: {
        estado: z.enum(ESTADOS_SOLICITUD_MATERIAL).optional(),
        projectId: z.string().uuid().optional(),
        almacenId: z.string().uuid().optional(),
        conFaltante: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ conFaltante, ...f }) =>
      ejecutar(() =>
        pedir<SolicitudMaterialDto[]>(
          `/almacen/solicitudes${query({ ...f, conFaltante: conFaltante ? 'true' : undefined })}`,
        ),
      ),
  );

  server.registerTool(
    'crear_solicitud_material',
    {
      title: 'Solicitar material para una obra',
      description:
        'Pide material de un almacén para una obra: lo disponible queda ' +
        'reservado (otras obras ya no pueden consumirlo) y el resto queda como ' +
        'faltante. Devuelve la solicitud con lo reservado y el faltante.',
      inputSchema: solicitudMaterialCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<SolicitudMaterialDto>('/almacen/solicitudes', post(body)),
      ),
  );

  server.registerTool(
    'servir_solicitud_material',
    {
      title: 'Servir una solicitud de material',
      description:
        'Consume a la obra lo indicado (sin líneas: todo lo reservado), ' +
        'liberando primero la reserva; se valora a precio medio y se ' +
        'contabiliza 6100 (obra) a 3000. Lee la versión y envía If-Match. ' +
        'Errores: MATERIAL_REQUEST_OVER_SERVED, INSUFFICIENT_STOCK, ' +
        'BUDGET_EXCEEDED, MATERIAL_REQUEST_CLOSED.',
      inputSchema: { id: z.string().uuid(), ...servirSolicitudSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, ...body }) =>
      ejecutar(() =>
        pedirVersionado<{
          solicitud: SolicitudMaterialDto;
          movimientos: MovimientoStockDto[];
        }>(
          `/almacen/solicitudes/${id}/servir`,
          post(body),
          async () =>
            (await pedir<SolicitudMaterialDto>(`/almacen/solicitudes/${id}`))
              .version,
          'solicitud de material',
        ),
      ),
  );

  server.registerTool(
    'pedir_faltante_material',
    {
      title: 'Pedido de compra del faltante',
      description:
        'Convierte el faltante de las líneas indicadas en un pedido de compra ' +
        'al proveedor (faltante × coste unitario, exacto al céntimo). Pasa por ' +
        'el control presupuestario de la obra (BUDGET_EXCEEDED) y por las ' +
        'aprobaciones de compras. MATERIAL_REQUEST_LINE_ORDERED si ya tiene pedido.',
      inputSchema: { id: z.string().uuid(), ...pedidoFaltanteSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, ...body }) =>
      ejecutar(() =>
        pedir<{ solicitud: SolicitudMaterialDto; pedido: PurchaseOrderDto }>(
          `/almacen/solicitudes/${id}/pedido`,
          post(body),
        ),
      ),
  );
}
