import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ComplianceSummaryDto } from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

export function registrarCumplimiento(server: McpServer) {
  server.registerTool(
    'cumplimiento_subcontratas',
    {
      title: 'Cumplimiento de subcontratas',
      description:
        'Estado documental de las subcontratas (PRL, seguros, certificados). ' +
        'Por defecto solo devuelve las que tienen algo que revisar; con ' +
        'todos=true devuelve todas.',
      inputSchema: {
        todos: z
          .boolean()
          .optional()
          .describe('true para incluir tambien las que estan en regla'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ todos }) =>
      ejecutar(() =>
        pedir<unknown>(`/cumplimiento${query({ todos: todos ? 'true' : '' })}`),
      ),
  );

  server.registerTool(
    'cumplimiento_contacto',
    {
      title: 'Cumplimiento de un contacto',
      description:
        'Resumen documental de una subcontrata concreta: documentos aportados, ' +
        'caducidades y si esta bloqueada para operar.',
      inputSchema: {
        contactId: z.string().uuid().describe('Identificador del contacto'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ contactId }) =>
      ejecutar(() =>
        pedir<ComplianceSummaryDto>(`/contacts/${contactId}/cumplimiento`),
      ),
  );
}
