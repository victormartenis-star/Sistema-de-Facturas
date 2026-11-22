import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CASHFLOW_GROUPINGS,
  ESTADOS_LIQUIDACION,
  MILESTONE_DIRECTIONS,
  MILESTONE_STATUSES,
  settlementCancelSchema,
  settlementCreateSchema,
  type CashflowReportDto,
  type MilestoneDetailDto,
  type MilestoneDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
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
        liquidacion: z
          .enum(ESTADOS_LIQUIDACION)
          .optional()
          .describe(
            'pendiente, parcial (cobrado o pagado en parte) o liquidado',
          ),
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
      description:
        'Liquida TODO el saldo pendiente de un vencimiento con fecha de hoy. ' +
        'Para cobros o pagos parciales usa registrar_cobro_pago.',
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

  server.registerTool(
    'detalle_vencimiento',
    {
      title: 'Detalle de un vencimiento',
      description:
        'Importe, liquidado, saldo pendiente, estado de liquidación ' +
        '(pendiente/parcial/liquidado) e historial de cobros o pagos, ' +
        'incluidos los anulados con su motivo.',
      inputSchema: { id: z.string().uuid().describe('Vencimiento') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      ejecutar(() => pedir<MilestoneDetailDto>(`/treasury/milestones/${id}`)),
  );

  server.registerTool(
    'registrar_cobro_pago',
    {
      title: 'Registrar cobro o pago (total o parcial)',
      description:
        'Registra un cobro o pago contra un vencimiento por el importe ' +
        'indicado (magnitud positiva). No admite sobrepago: si supera el ' +
        'saldo pendiente responde SETTLEMENT_EXCEEDS_OUTSTANDING. Lee antes ' +
        'la versión del vencimiento y la envía en If-Match. Devuelve el ' +
        'vencimiento actualizado con su historial.',
      inputSchema: {
        id: z.string().uuid().describe('Vencimiento'),
        ...settlementCreateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, ...body }) =>
      ejecutar(() =>
        pedirVersionado<MilestoneDetailDto>(
          `/treasury/milestones/${id}/liquidaciones`,
          {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Idempotency-Key': randomUUID() },
          },
          async () =>
            (await pedir<MilestoneDetailDto>(`/treasury/milestones/${id}`))
              .version,
          'vencimiento',
        ),
      ),
  );

  server.registerTool(
    'anular_cobro_pago',
    {
      title: 'Anular un cobro o pago',
      description:
        'Anula una liquidación (p. ej. una transferencia devuelta): deja de ' +
        'contar y el vencimiento recupera ese saldo pendiente. Exige motivo.',
      inputSchema: {
        liquidacionId: z.string().uuid().describe('Liquidación'),
        ...settlementCancelSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ liquidacionId, ...body }) =>
      ejecutar(() =>
        pedir<MilestoneDetailDto>(
          `/treasury/liquidaciones/${liquidacionId}/anular`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      ),
  );
}
