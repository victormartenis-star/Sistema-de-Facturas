import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  asignacionCreateSchema,
  explotacionQuerySchema,
  fichaEquipoSchema,
  lecturaContadorSchema,
  ordenAccionSchema,
  ordenCreateSchema,
  ordenesQuerySchema,
  planCreateSchema,
  type AsignacionDto,
  type EquipoEamDto,
  type ExplotacionDto,
  type OrdenTrabajoDto,
  type PlanMantenimientoDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const id = z.string().uuid();
const idem = () => ({ 'Idempotency-Key': randomUUID() });
const versionEquipo = (eid: string) => async () =>
  (await pedir<EquipoEamDto>(`/eam/equipos/${eid}`)).version;

/**
 * EAM de maquinaria: ficha y jerarquía, contadores, asignación a obra,
 * planes preventivos, órdenes de trabajo y explotación. Siempre por la API.
 */
export function registrarEam(server: McpServer) {
  server.registerTool(
    'equipos_eam',
    {
      title: 'Equipos con su ficha EAM',
      description:
        'Código, jerarquía, contadores, obra actual, activo fijo, estado del preventivo y órdenes abiertas. Con projectId, los asignados a esa obra.',
      inputSchema: { projectId: id.optional() },
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<EquipoEamDto[]>(`/eam/equipos${query(q)}`)),
  );

  server.registerTool(
    'ficha_equipo',
    {
      title: 'Actualizar la ficha de un equipo',
      description:
        'Código, nº de serie y conjunto del que es componente (sin ciclos: EAM_HIERARCHY_CYCLE). Lee la versión y envía If-Match.',
      inputSchema: {
        id: id.describe('Id del equipo'),
        ...fichaEquipoSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id: eid, ...body }) =>
      ejecutar(() =>
        pedirVersionado<EquipoEamDto>(
          `/eam/equipos/${eid}/ficha`,
          {
            method: 'PATCH',
            body: JSON.stringify(fichaEquipoSchema.parse(body)),
          },
          versionEquipo(eid),
          'equipo',
        ),
      ),
  );

  server.registerTool(
    'lectura_contador',
    {
      title: 'Registrar una lectura de horas o kilómetros',
      description:
        'Sin retroceso ni avance imposible (EAM_COUNTER_BACKWARDS, EAM_COUNTER_IMPLAUSIBLE) salvo corrección con motivo.',
      inputSchema: {
        id: id.describe('Id del equipo'),
        ...lecturaContadorSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: eid, ...body }) =>
      ejecutar(() =>
        pedirVersionado<EquipoEamDto>(
          `/eam/equipos/${eid}/lecturas`,
          {
            method: 'POST',
            body: JSON.stringify(lecturaContadorSchema.parse(body)),
            headers: idem(),
          },
          versionEquipo(eid),
          'equipo',
        ),
      ),
  );

  server.registerTool(
    'asignar_equipo_obra',
    {
      title: 'Asignar un equipo a una obra',
      description: 'Una obra a la vez: sin solapes (EAM_ASSIGNMENT_OVERLAP).',
      inputSchema: {
        id: id.describe('Id del equipo'),
        ...asignacionCreateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: eid, ...body }) =>
      ejecutar(() =>
        pedir<AsignacionDto>(`/eam/equipos/${eid}/asignaciones`, {
          method: 'POST',
          body: JSON.stringify(asignacionCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'planes_mantenimiento',
    {
      title: 'Planes preventivos de un equipo',
      description:
        'Con su próximo vencimiento por fecha, horas o km y estado (al día, próximo, vencido).',
      inputSchema: { id: id.describe('Id del equipo') },
      annotations: { readOnlyHint: true },
    },
    async ({ id: eid }) =>
      ejecutar(() =>
        pedir<PlanMantenimientoDto[]>(`/eam/equipos/${eid}/planes`),
      ),
  );

  server.registerTool(
    'crear_plan_mantenimiento',
    {
      title: 'Crear un plan preventivo',
      description:
        'Por días, horas y/o km, con avisos de proximidad (EAM_PLAN_INTERVAL_REQUIRED si no hay intervalo).',
      inputSchema: {
        id: id.describe('Id del equipo'),
        ...planCreateSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: eid, ...body }) =>
      ejecutar(() =>
        pedir<PlanMantenimientoDto>(`/eam/equipos/${eid}/planes`, {
          method: 'POST',
          body: JSON.stringify(planCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'generar_ordenes_preventivas',
    {
      title: 'Generar órdenes preventivas',
      description:
        'Una orden por plan activo vencido o próximo sin orden viva (idempotente).',
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () =>
      ejecutar(() =>
        pedir<OrdenTrabajoDto[]>('/eam/planes/generar-ordenes', {
          method: 'POST',
          body: '{}',
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'ordenes_trabajo',
    {
      title: 'Órdenes de trabajo de mantenimiento',
      description:
        'Preventivas, correctivas, ITV y revisiones con estado, parada y coste.',
      inputSchema: ordenesQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<OrdenTrabajoDto[]>(`/eam/ordenes${query(q)}`)),
  );

  server.registerTool(
    'crear_orden_trabajo',
    {
      title: 'Abrir una orden de trabajo o aviso de avería',
      description:
        'La obra es atribución analítica (el coste no se carga a la obra). Numeración OT-AAAA-0001.',
      inputSchema: ordenCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<OrdenTrabajoDto>('/eam/ordenes', {
          method: 'POST',
          body: JSON.stringify(ordenCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'accion_orden_trabajo',
    {
      title: 'Planificar, iniciar, cerrar o cancelar una orden',
      description:
        'Cerrar fija parada y coste (horas × tarifa + repuestos + externo), registra lecturas y actualiza el plan. Cancelar exige motivo. Error: EAM_WO_INVALID_TRANSITION. Lee la versión y envía If-Match.',
      inputSchema: {
        id: id.describe('Id de la orden'),
        ...ordenAccionSchema.shape,
      },
      annotations: { readOnlyHint: false },
    },
    async ({ id: oid, ...body }) =>
      ejecutar(() =>
        pedirVersionado<OrdenTrabajoDto>(
          `/eam/ordenes/${oid}/acciones`,
          {
            method: 'POST',
            body: JSON.stringify(ordenAccionSchema.parse(body)),
            headers: idem(),
          },
          async () =>
            (await pedir<OrdenTrabajoDto>(`/eam/ordenes/${oid}`)).version,
          'orden de trabajo',
        ),
      ),
  );

  server.registerTool(
    'explotacion_maquinaria',
    {
      title: 'Disponibilidad y coste de explotación',
      description:
        'Por equipo: disponibilidad, utilización, MTBF/MTTR, amortización contabilizada, mantenimiento, imputado a obras por partes, cobertura y €/h. Por obra: horas, imputado y mantenimiento atribuido.',
      inputSchema: explotacionQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<ExplotacionDto>(`/eam/explotacion${query(q)}`)),
  );
}
