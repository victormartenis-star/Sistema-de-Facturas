import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  BUDGET_STATUSES,
  budgetCreateSchema,
  budgetUpdateSchema,
  type BudgetDetailDto,
  type BudgetDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

export function registrarPresupuestos(server: McpServer) {
  server.registerTool(
    'listar_presupuestos',
    {
      title: 'Listar presupuestos de una obra',
      description:
        'Devuelve todos los presupuestos asociados a una obra: manuales e ' +
        'importados desde BC3 (FIEBDC-3 / Presto). Incluye estado, importe ' +
        'total y número de partidas. Usa este listado para obtener el id ' +
        'que necesitan las demás herramientas de presupuesto.',
      inputSchema: {
        projectId: z.string().uuid().describe('Identificador de la obra'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(() => pedir<BudgetDto[]>(`/projects/${projectId}/budgets`)),
  );

  server.registerTool(
    'presupuesto_detalle',
    {
      title: 'Detalle de presupuesto con partidas',
      description:
        'Devuelve la cabecera del presupuesto y el árbol completo de ' +
        'partidas/capítulos con código BC3, unidad, cantidad, precio unitario ' +
        'y total de cada línea. Útil para auditar qué hay en el presupuesto ' +
        'activo antes de crear certificaciones.',
      inputSchema: {
        budgetId: z.string().uuid().describe('Identificador del presupuesto'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ budgetId }) =>
      ejecutar(() => pedir<BudgetDetailDto>(`/budgets/${budgetId}`)),
  );

  server.registerTool(
    'crear_presupuesto',
    {
      title: 'Crear presupuesto manual',
      description:
        'Da de alta un presupuesto vacío (source=manual) vinculado a una ' +
        'obra. El estado inicial es borrador. Para importar un BC3 usa la ' +
        'herramienta importar_bc3, que acepta el fichero y crea presupuesto ' +
        'y partidas en una sola llamada.',
      inputSchema: {
        projectId: z.string().uuid().describe('Obra a la que pertenece'),
        ...budgetCreateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ projectId, ...body }) =>
      ejecutar(() =>
        pedir<BudgetDto>(`/projects/${projectId}/budgets`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
  );

  server.registerTool(
    'actualizar_presupuesto',
    {
      title: 'Actualizar o activar presupuesto',
      description:
        'Cambia nombre, notas o estado del presupuesto. Solo puede haber un ' +
        'presupuesto activo por obra: al pasar uno a activo, la API cierra el ' +
        'anterior automáticamente. El agente no tiene que hacerlo a mano.',
      inputSchema: {
        budgetId: z.string().uuid().describe('Identificador'),
        ...budgetUpdateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ budgetId, ...body }) =>
      ejecutar(() =>
        pedir<BudgetDto>(`/budgets/${budgetId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      ),
  );

  server.registerTool(
    'eliminar_presupuesto',
    {
      title: 'Eliminar presupuesto',
      description:
        'Borra lógicamente un presupuesto. Solo se pueden borrar presupuestos ' +
        'en estado borrador o cerrado; los activos deben cerrarse primero.',
      inputSchema: {
        budgetId: z.string().uuid().describe('Identificador'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ budgetId }) =>
      ejecutar(async () => {
        await pedir<void>(`/budgets/${budgetId}`, { method: 'DELETE' });
        return { ok: true, id: budgetId };
      }),
  );

  // ── Herramienta de consulta rápida de estado ────────────────────────────────
  server.registerTool(
    'presupuesto_activo',
    {
      title: 'Presupuesto activo de una obra',
      description:
        'Atajo que devuelve el presupuesto con estado=activo de la obra, o ' +
        'null si no hay ninguno. Útil para saber el importe contratado real ' +
        'antes de crear o revisar certificaciones.',
      inputSchema: {
        projectId: z.string().uuid().describe('Identificador de la obra'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(async () => {
        const lista = await pedir<BudgetDto[]>(
          `/projects/${projectId}/budgets`,
        );
        const activo = lista.find((b) => b.status === 'activo') ?? null;
        return { presupuesto_activo: activo };
      }),
  );
}
