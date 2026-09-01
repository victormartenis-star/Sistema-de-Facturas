import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CONTACT_KINDS,
  contactCreateSchema,
  type CategoryDto,
  type ContactDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

export function registrarContactos(server: McpServer) {
  server.registerTool(
    'buscar_contactos',
    {
      title: 'Buscar contactos',
      description:
        'Proveedores y clientes. Devuelve el contactId que necesitan las ' +
        'herramientas de facturas y albaranes.',
      inputSchema: {
        search: z.string().optional().describe('Nombre, NIF o texto libre'),
        kind: z
          .enum(CONTACT_KINDS)
          .optional()
          .describe('proveedor, cliente o ambos'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, kind }) =>
      ejecutar(() =>
        pedir<ContactDto[]>(`/contacts${query({ search, kind })}`),
      ),
  );

  server.registerTool(
    'crear_contacto',
    {
      title: 'Crear contacto',
      description: 'Da de alta un proveedor o cliente.',
      inputSchema: contactCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (entrada) =>
      ejecutar(() =>
        pedir<ContactDto>('/contacts', {
          method: 'POST',
          body: JSON.stringify(entrada),
        }),
      ),
  );

  server.registerTool(
    'listar_categorias',
    {
      title: 'Listar categorias de coste',
      description:
        'Categorias analiticas disponibles para imputar las lineas de factura.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ejecutar(() => pedir<CategoryDto[]>('/categories')),
  );
}
