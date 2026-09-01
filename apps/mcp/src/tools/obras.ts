import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  PROJECT_STATUSES,
  projectCreateSchema,
  type DeviationReportDto,
  type PhaseDto,
  type ProjectDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

export function registrarObras(server: McpServer) {
  server.registerTool(
    'buscar_obras',
    {
      title: 'Buscar obras',
      description:
        'Lista las obras del ERP. Permite filtrar por texto (codigo o nombre) ' +
        'y por estado. Uselo antes de crear facturas o pedidos para localizar ' +
        'el projectId que piden el resto de herramientas.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Texto en el codigo o el nombre'),
        status: z
          .enum(PROJECT_STATUSES)
          .optional()
          .describe('Estado de la obra'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, status }) =>
      ejecutar(() =>
        pedir<ProjectDto[]>(`/projects${query({ search, status })}`),
      ),
  );

  server.registerTool(
    'obra_detalle',
    {
      title: 'Detalle de obra',
      description:
        'Devuelve una obra con sus datos economicos, sus partidas y el informe ' +
        'de desviacion (presupuestado frente a real por partida).',
      inputSchema: {
        projectId: z.string().uuid().describe('Identificador de la obra'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(async () => {
        // Tres llamadas porque la API las expone por separado; se agrupan aqui
        // para que el modelo no tenga que encadenarlas a mano.
        const [obra, partidas, desviacion] = await Promise.all([
          pedir<ProjectDto>(`/projects/${projectId}`),
          pedir<PhaseDto[]>(`/projects/${projectId}/phases`),
          pedir<DeviationReportDto>(`/projects/${projectId}/desvio`),
        ]);
        return { obra, partidas, desviacion };
      }),
  );

  server.registerTool(
    'crear_obra',
    {
      title: 'Crear obra',
      description:
        'Da de alta una obra nueva. El codigo debe ser unico; la API lo valida.',
      // projectCreateSchema lleva un .refine(), asi que es un ZodEffects:
      // hay que bajar al objeto interno para obtener la forma de los campos.
      inputSchema: projectCreateSchema.innerType().shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (entrada) =>
      ejecutar(() =>
        pedir<ProjectDto>('/projects', {
          method: 'POST',
          body: JSON.stringify(entrada),
        }),
      ),
  );
}
