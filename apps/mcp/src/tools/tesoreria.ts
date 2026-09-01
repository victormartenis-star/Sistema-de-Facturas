import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CASHFLOW_GROUPINGS,
  MILESTONE_DIRECTIONS,
  MILESTONE_STATUSES,
  type CashflowReportDto,
  type MilestoneDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

export function registrarTesoreria(server: McpServer) {
  server.registerTool(
    'vencimientos',
    {
      title: 'Calendario de vencimientos',
      description:
        'Cobros y pagos previstos. Incluye tanto los vencimientos ordinarios ' +
        'como las retenciones por garantia, que vencen en su propia fecha de ' +
        'liberacion.',
      inputSchema: {
        direction: z
          .enum(MILESTONE_DIRECTIONS)
          .optional()
          .describe('cobro o pago'),
        status: z
          .enum(MILESTONE_STATUSES)
          .optional()
          .describe('previsto o pagado'),
        from: fecha.optional().describe('Desde (AAAA-MM-DD)'),
        to: fecha.optional().describe('Hasta (AAAA-MM-DD)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() => pedir<MilestoneDto[]>(`/treasury/milestones${query(f)}`)),
  );

  server.registerTool(
    'prevision_caja',
    {
      title: 'Prevision de flujo de caja',
      description:
        'Agrega cobros y pagos previstos por semana o por mes para ver el ' +
        'saldo esperado en cada periodo.',
      inputSchema: {
        from: fecha.optional(),
        to: fecha.optional(),
        groupBy: z
          .enum(CASHFLOW_GROUPINGS)
          .optional()
          .describe('semana (por defecto) o mes'),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() => pedir<CashflowReportDto>(`/treasury/cashflow${query(f)}`)),
  );

  server.registerTool(
    'marcar_vencimiento_pagado',
    {
      title: 'Marcar vencimiento como pagado',
      description: 'Da por cobrado o pagado un vencimiento del calendario.',
      inputSchema: { id: z.string().uuid().describe('Identificador') },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id }) =>
      ejecutar(async () => {
        // Responde 204 sin cuerpo; se devuelve una confirmacion explicita para
        // que el modelo no interprete el vacio como un fallo.
        await pedir<void>(`/treasury/milestones/${id}/pagar`, {
          method: 'POST',
        });
        return { ok: true, id, estado: 'pagado' };
      }),
  );
}
