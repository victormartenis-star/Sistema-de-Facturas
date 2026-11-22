import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CATEGORIAS_ACTIVO,
  ESTADOS_ACTIVO,
  activoBajaSchema,
  amortizarSchema,
  type ActivoDetalleDto,
  type ActivoDto,
  type ResultadoAmortizacionDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

export function registrarActivos(server: McpServer) {
  server.registerTool(
    'listar_activos',
    {
      title: 'Activos fijos',
      description:
        'Inmovilizado material con coste, amortización acumulada, valor neto ' +
        'contable y último mes amortizado. Filtra por estado, categoría o texto.',
      inputSchema: {
        estado: z.enum(ESTADOS_ACTIVO).optional(),
        categoria: z.enum(CATEGORIAS_ACTIVO).optional(),
        q: z.string().max(80).optional().describe('Código o nombre'),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) => ejecutar(() => pedir<ActivoDto[]>(`/activos${query(f)}`)),
  );

  server.registerTool(
    'detalle_activo',
    {
      title: 'Detalle y cuadro de amortización',
      description:
        'Ficha del activo con su cuadro de amortización completo (cuota, ' +
        'acumulada y valor neto por mes) marcando lo ya contabilizado.',
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => ejecutar(() => pedir<ActivoDetalleDto>(`/activos/${id}`)),
  );

  server.registerTool(
    'amortizar_activos',
    {
      title: 'Ejecutar amortización',
      description:
        'Contabiliza las cuotas pendientes de todos los activos en uso hasta ' +
        'el mes indicado (AAAA-MM): una cuota por activo y mes, asiento 6810 ' +
        'a 281x imputado a la obra. Idempotente; informa de los omitidos ' +
        '(p. ej. FISCAL_PERIOD_CLOSED).',
      inputSchema: amortizarSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (body) =>
      ejecutar(() =>
        pedir<ResultadoAmortizacionDto>('/activos/amortizar', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
  );

  server.registerTool(
    'baja_activo',
    {
      title: 'Dar de baja un activo',
      description:
        'Baja por venta o desguace con su asiento de resultado (6710 pérdida ' +
        '/ 7710 beneficio). Exige la amortización contabilizada hasta el mes ' +
        'anterior (ASSET_DEPRECIATION_PENDING). Lee la versión y envía If-Match.',
      inputSchema: { id: z.string().uuid(), ...activoBajaSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, ...body }) =>
      ejecutar(() =>
        pedirVersionado<ActivoDetalleDto>(
          `/activos/${id}/baja`,
          {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Idempotency-Key': randomUUID() },
          },
          async () => (await pedir<ActivoDetalleDto>(`/activos/${id}`)).version,
          'activo',
        ),
      ),
  );
}
