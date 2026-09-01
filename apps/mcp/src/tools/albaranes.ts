import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DELIVERY_NOTE_STATUSES,
  deliveryNoteCreateSchema,
  type DeliveryNoteDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

export function registrarAlbaranes(server: McpServer) {
  server.registerTool(
    'listar_albaranes',
    {
      title: 'Listar albaranes',
      description:
        'Albaranes de proveedor. Con availableForContact se obtienen los ' +
        'albaranes validados de ese proveedor que aun no estan en ninguna ' +
        'factura, que son los que se pueden enlazar al crear una factura de compra.',
      inputSchema: {
        search: z.string().optional().describe('Numero de albaran'),
        status: z.enum(DELIVERY_NOTE_STATUSES).optional(),
        contactId: z.string().uuid().optional().describe('Proveedor'),
        availableForContact: z
          .string()
          .uuid()
          .optional()
          .describe('Solo albaranes validados y sin facturar de ese proveedor'),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() => pedir<DeliveryNoteDto[]>(`/delivery-notes${query(f)}`)),
  );

  server.registerTool(
    'crear_albaran',
    {
      title: 'Crear albaran',
      description: 'Registra un albaran de proveedor pendiente de validar.',
      inputSchema: deliveryNoteCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (entrada) =>
      ejecutar(() =>
        pedir<DeliveryNoteDto>('/delivery-notes', {
          method: 'POST',
          body: JSON.stringify(entrada),
        }),
      ),
  );

  server.registerTool(
    'validar_albaran',
    {
      title: 'Validar albaran',
      description:
        'Marca el albaran como validado, que es el paso previo a poder ' +
        'incluirlo en una factura de compra. ' +
        'REGLA DE ORO: un albaran sin numero de pedido no se valida. La API ' +
        'responde 422 con el texto que el procedimiento manda anotar en el ' +
        'albaran; ese texto se devuelve tal cual, no lo reformules.',
      inputSchema: { id: z.string().uuid().describe('Identificador') },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id }) =>
      ejecutar(() =>
        pedir<DeliveryNoteDto>(`/delivery-notes/${id}/validar`, {
          method: 'POST',
        }),
      ),
  );
}
