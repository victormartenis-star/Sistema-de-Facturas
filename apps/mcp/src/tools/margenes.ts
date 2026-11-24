import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  controlPresupuestarioUpdateSchema,
  type ControlPresupuestarioDto,
  type CostControlDto,
  type CuadroMargenesDto,
  type MargenesObraDto,
  type ObraEconomicsDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe('AAAA-MM-DD');

/**
 * Cuadro de márgenes y control presupuestario activo por obra: solo lectura
 * salvo la configuración del control, que lee la versión y envía If-Match.
 */
export function registrarMargenes(server: McpServer) {
  server.registerTool(
    'cuadro_margenes',
    {
      title: 'Cuadro de márgenes de la cartera',
      description:
        'Por obra: presupuestado, comprometido (pedidos y subcontratas ' +
        'pendientes), coste real (facturas de compra, partes, almacén neto y ' +
        'amortización), consumo %, desviación, certificado, facturado, cobrado ' +
        '(en base), márgenes previsto/proyectado/real y estado del control ' +
        'presupuestario, con totales exactos. desde/hasta acotan los flujos; ' +
        'soloAlertas deja las obras en aviso o excedidas.',
      inputSchema: {
        estado: z.string().max(20).optional().describe('Estado de la obra'),
        q: z.string().max(80).optional().describe('Código o nombre de obra'),
        desde: fecha,
        hasta: fecha,
        soloAlertas: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ soloAlertas, ...f }) =>
      ejecutar(() =>
        pedir<CuadroMargenesDto>(
          `/cost-control/margenes${query({ ...f, soloAlertas: soloAlertas ? 'true' : undefined })}`,
        ),
      ),
  );

  server.registerTool(
    'margenes_obra',
    {
      title: 'Márgenes y desviaciones de una obra',
      description:
        'Cuadro de una obra con desglose por capítulo y partida ' +
        '(presupuestado, comprometido, real, consumo % y desviación; las ' +
        'partidas excedidas van marcadas).',
      inputSchema: { projectId: z.string().uuid(), desde: fecha, hasta: fecha },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, ...f }) =>
      ejecutar(() =>
        pedir<MargenesObraDto>(`/projects/${projectId}/margenes${query(f)}`),
      ),
  );

  server.registerTool(
    'economia_obra',
    {
      title: 'Economía de la obra',
      description:
        'Margen bruto sobre certificado y sobre facturado, coste real por ' +
        'origen (facturas de compra, partes, almacén y amortización), ' +
        'desviación por partida (con «Sin partida»), retenciones a cobrar y a ' +
        'pagar, IVA de la obra y margen previsto frente al actual.',
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(() =>
        pedir<ObraEconomicsDto>(`/projects/${projectId}/economics`),
      ),
  );

  server.registerTool(
    'control_costes_obra',
    {
      title: 'Valor ganado (BAC / AC / EV)',
      description:
        'Coste previsto (BAC), coste real imputado (AC, con su desglose) y ' +
        'producción certificada (EV) de la obra, margen actual, CPI, EAC, ' +
        'sobrecoste por partida y curva S mensual (real, ganado y planificado).',
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(() =>
        pedir<CostControlDto>(`/projects/${projectId}/cost-control`),
      ),
  );

  server.registerTool(
    'control_presupuestario',
    {
      title: 'Estado del control presupuestario',
      description:
        'Configuración (observación / aviso / bloqueo, tolerancia y umbral), ' +
        'evaluación actual (límite, disponible, exceso) y últimos avisos y ' +
        'bloqueos (BUDGET_EXCEEDED) de una obra.',
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(() =>
        pedir<ControlPresupuestarioDto>(
          `/projects/${projectId}/control-presupuestario`,
        ),
      ),
  );

  server.registerTool(
    'configurar_control_presupuestario',
    {
      title: 'Configurar el control presupuestario',
      description:
        'Fija el modo (observacion, aviso o bloqueo), la tolerancia sobre el ' +
        'presupuesto y el umbral de aviso de una obra. En bloqueo, los pedidos ' +
        'y consumos de almacén que excedan se rechazan con BUDGET_EXCEEDED. ' +
        'Solo admin y gerente. Lee la versión y envía If-Match.',
      inputSchema: {
        projectId: z.string().uuid(),
        ...controlPresupuestarioUpdateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ projectId, ...body }) =>
      ejecutar(async () => {
        const ruta = `/projects/${projectId}/control-presupuestario`;
        const actual = await pedir<ControlPresupuestarioDto>(ruta);
        const init: RequestInit = { method: 'PUT', body: JSON.stringify(body) };
        // Sin configuración previa (versión 0) no hay If-Match que enviar.
        return actual.config.version === 0
          ? pedir<ControlPresupuestarioDto>(ruta, init)
          : pedirVersionado<ControlPresupuestarioDto>(
              ruta,
              init,
              async () => actual.config.version,
              'control presupuestario',
            );
      }),
  );
}
