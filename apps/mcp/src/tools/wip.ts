import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ESTADOS_WIP,
  provisionPerdidasCierreSchema,
  provisionPerdidasContabilizarSchema,
  wipContabilizarSchema,
  wipCierreSchema,
  type PropuestaProvisionPerdidasDto,
  type ProvisionPerdidasDto,
  type ResultadoCierreProvisionPerdidasDto,
  type PropuestaWipDto,
  type ResultadoCierreWipDto,
  type WipDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

const periodo = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('AAAA-MM');

const post = (cuerpo: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(cuerpo),
  headers: { 'Idempotency-Key': randomUUID() },
});

/**
 * Obra en curso (WIP) al cierre: cálculo por obra (grado de avance),
 * contabilización de la regularización y consulta de cierres.
 */
export function registrarWip(server: McpServer) {
  server.registerTool(
    'calcular_obra_en_curso',
    {
      title: 'Cálculo de obra en curso (borrador)',
      description:
        'Por obra y periodo (AAAA-MM), sin contabilizar: producción ejecutada ' +
        'y facturado a origen, obra en curso (producción − facturado), la del ' +
        'cierre anterior, la regularización a contabilizar, coste real y margen ' +
        'reconocido por grado de avance, y si el periodo ya está cerrado.',
      inputSchema: { periodo, projectId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<PropuestaWipDto[]>(`/wip/propuesta${query(q)}`)),
  );

  server.registerTool(
    'cierres_obra_en_curso',
    {
      title: 'Cierres de obra en curso',
      description:
        'Cierres contabilizados o anulados, con su asiento y contra-asiento. ' +
        'Filtra por periodo, obra y estado.',
      inputSchema: {
        periodo: periodo.optional(),
        projectId: z.string().uuid().optional(),
        estado: z.enum(ESTADOS_WIP).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (q) => ejecutar(() => pedir<WipDto[]>(`/wip${query(q)}`)),
  );

  server.registerTool(
    'contabilizar_obra_en_curso',
    {
      title: 'Contabilizar la obra en curso',
      description:
        'Con projectId, cierra esa obra; sin él, cierra el periodo para todas ' +
        'las obras con actividad (informa de las omitidas). Asiento de la ' +
        'regularización: 4309 / 4389 contra 7050 de la obra, fechado el último ' +
        'día del mes. Errores: WIP_ALREADY_POSTED, WIP_PERIOD_OUT_OF_ORDER, ' +
        'FISCAL_PERIOD_CLOSED.',
      inputSchema: { periodo, projectId: z.string().uuid().optional() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ periodo: p, projectId }) =>
      ejecutar((): Promise<WipDto | ResultadoCierreWipDto> =>
        projectId
          ? pedir<WipDto>(
              '/wip',
              post(wipContabilizarSchema.parse({ periodo: p, projectId })),
            )
          : pedir<ResultadoCierreWipDto>(
              '/wip/cierre',
              post(wipCierreSchema.parse({ periodo: p })),
            ),
      ),
  );

  /* ─────────── provisión por pérdidas previstas (contratos onerosos) ─────────── */

  server.registerTool(
    'calcular_provision_perdidas',
    {
      title: 'Cálculo de la provisión por pérdidas previstas (borrador)',
      description:
        'Por obra y periodo (AAAA-MM), sin contabilizar (NRV 14, contratos ' +
        'onerosos): contrato, coste estimado al cierre, pérdida total ' +
        '(coste estimado − contrato), pérdida ya reconocida por el grado de ' +
        'avance (coste real − producción), provisión necesaria, la anterior y ' +
        'el ajuste (dotación > 0, exceso < 0). Sin projectId, solo obras con ' +
        'pérdida prevista o provisión vigente.',
      inputSchema: { periodo, projectId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() =>
        pedir<PropuestaProvisionPerdidasDto[]>(
          `/provision-perdidas/propuesta${query(q)}`,
        ),
      ),
  );

  server.registerTool(
    'cierres_provision_perdidas',
    {
      title: 'Cierres de la provisión por pérdidas previstas',
      description:
        'Cierres de provisión contabilizados o anulados, con su asiento y ' +
        'contra-asiento. Filtra por periodo, obra y estado.',
      inputSchema: {
        periodo: periodo.optional(),
        projectId: z.string().uuid().optional(),
        estado: z.enum(ESTADOS_WIP).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() =>
        pedir<ProvisionPerdidasDto[]>(`/provision-perdidas${query(q)}`),
      ),
  );

  server.registerTool(
    'contabilizar_provision_perdidas',
    {
      title: 'Contabilizar la provisión por pérdidas previstas',
      description:
        'Con projectId, cierra esa obra; sin él, el periodo para todas las ' +
        'obras con pérdida prevista o provisión vigente (informa de las ' +
        'omitidas). Contabiliza solo el ajuste frente a la provisión vigente: ' +
        'dotación 6954 (obra) a 4994, o exceso 4994 a 7954 (obra), fechado el ' +
        'último día del mes. Errores: LOSS_PROVISION_ALREADY_POSTED, ' +
        'LOSS_PROVISION_PERIOD_OUT_OF_ORDER, FISCAL_PERIOD_CLOSED.',
      inputSchema: { periodo, projectId: z.string().uuid().optional() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ periodo: p, projectId }) =>
      ejecutar(
        (): Promise<
          ProvisionPerdidasDto | ResultadoCierreProvisionPerdidasDto
        > =>
          projectId
            ? pedir<ProvisionPerdidasDto>(
                '/provision-perdidas',
                post(
                  provisionPerdidasContabilizarSchema.parse({
                    periodo: p,
                    projectId,
                  }),
                ),
              )
            : pedir<ResultadoCierreProvisionPerdidasDto>(
                '/provision-perdidas/cierre',
                post(provisionPerdidasCierreSchema.parse({ periodo: p })),
              ),
      ),
  );
}
