import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CONFLICTOS_SOD,
  MODOS_SOD,
  delegacionCreateSchema,
  reasignarPasoSchema,
  type DelegacionDto,
  type NotificationDto,
  type PoliticaSodDto,
  type SolicitudAprobacionDto,
} from '@erp/shared';
import { pedir, pedirVersionado } from '../api';
import { ejecutar } from '../comun';

const idem = () => ({ 'Idempotency-Key': randomUUID() });

/**
 * Gobierno (GRC): políticas de segregación de funciones y su informe de
 * eventos, delegaciones, reasignación y escalado de aprobaciones, y la
 * bandeja de notificaciones dirigidas del usuario del token.
 */
export function registrarGrc(server: McpServer) {
  server.registerTool(
    'politicas_sod',
    {
      title: 'Políticas de segregación de funciones',
      description:
        'Por conflicto (solicitante que aprueba, mismo aprobador en dos niveles, creador que aprueba, aprobador que paga): bloquear, justificar o auditar. Los dos primeros siempre bloquean.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ejecutar(() => pedir<PoliticaSodDto[]>('/grc/sod/politicas')),
  );

  server.registerTool(
    'cambiar_politica_sod',
    {
      title: 'Cambiar una política de segregación de funciones',
      description:
        'Admin o gerente. Los conflictos fijos responden SOD_POLICY_LOCKED. Lee la versión y envía If-Match.',
      inputSchema: {
        conflicto: z.enum(CONFLICTOS_SOD),
        modo: z.enum(MODOS_SOD),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ conflicto, modo }) =>
      ejecutar(async () => {
        const actual = (
          await pedir<PoliticaSodDto[]>('/grc/sod/politicas')
        ).find((p) => p.conflicto === conflicto);
        const headers: Record<string, string> = { ...idem() };
        // Sin fila guardada (versión 0) no se envía If-Match.
        if (actual && actual.version > 0)
          headers['If-Match'] = `"${actual.version}"`;
        return pedir<PoliticaSodDto[]>(`/grc/sod/politicas/${conflicto}`, {
          method: 'PUT',
          body: JSON.stringify({ modo }),
          headers,
        });
      }),
  );

  server.registerTool(
    'eventos_sod',
    {
      title: 'Eventos de segregación de funciones',
      description:
        'Informe de riesgos: bloqueos y excepciones permitidas (con su justificación), con usuario, operación y documento.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(() =>
        pedir<unknown[]>('/grc/sod/eventos').then((eventos) => ({ eventos })),
      ),
  );

  server.registerTool(
    'delegaciones_aprobacion',
    {
      title: 'Delegaciones de aprobación',
      description:
        'Las del usuario (dadas o recibidas); con todas=true, las de la empresa (admin o gerente).',
      inputSchema: { todas: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ todas }) =>
      ejecutar(() =>
        pedir<DelegacionDto[]>(
          `/grc/delegaciones${todas ? '?todas=true' : ''}`,
        ).then((delegaciones) => ({ delegaciones })),
      ),
  );

  server.registerTool(
    'delegar_aprobaciones',
    {
      title: 'Delegar mis aprobaciones',
      description:
        'El delegado decide en nombre del usuario, con su rol, entre las dos fechas. Errores: APPROVAL_DELEGATION_INVALID, APPROVAL_DELEGATION_OVERLAP, APPROVAL_USER_INVALID.',
      inputSchema: delegacionCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<DelegacionDto>('/grc/delegaciones', {
          method: 'POST',
          body: JSON.stringify(delegacionCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'reasignar_aprobacion',
    {
      title: 'Reasignar el nivel activo de una aprobación',
      description:
        'Admin o gerente: a un usuario activo con el rol del nivel que no sea el solicitante (APPROVAL_USER_INVALID).',
      inputSchema: {
        id: z.string().uuid().describe('Id de la solicitud'),
        ...reasignarPasoSchema.shape,
      },
      annotations: { readOnlyHint: false },
    },
    async ({ id, ...body }) =>
      ejecutar(() =>
        pedirVersionado<SolicitudAprobacionDto>(
          `/aprobaciones/solicitudes/${id}/reasignar`,
          {
            method: 'POST',
            body: JSON.stringify(reasignarPasoSchema.parse(body)),
            headers: idem(),
          },
          async () => {
            const s = (
              await pedir<SolicitudAprobacionDto[]>(
                '/aprobaciones/solicitudes?estado=pendiente',
              )
            ).find((x) => x.id === id);
            // Sin versión no se envía If-Match "0": se informa.
            if (!s)
              throw new Error(
                'Solicitud pendiente no encontrada (APPROVAL_REQUEST_NOT_FOUND)',
              );
            return s.version;
          },
          'solicitud de aprobación',
        ),
      ),
  );

  server.registerTool(
    'escalar_aprobaciones',
    {
      title: 'Escalar aprobaciones vencidas',
      description:
        'Los niveles activos con el plazo vencido pasan al rol superior y se avisa solo a los nuevos decisores.',
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () =>
      ejecutar(() =>
        pedir<SolicitudAprobacionDto[]>('/aprobaciones/escalar', {
          method: 'POST',
          body: '{}',
          headers: idem(),
        }).then((escaladas) => ({ escaladas })),
      ),
  );

  server.registerTool(
    'mis_notificaciones',
    {
      title: 'Bandeja de notificaciones del usuario',
      description:
        'Las de empresa y las dirigidas a este usuario (lectura por usuario); con noLeidas, solo las pendientes.',
      inputSchema: { noLeidas: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ noLeidas }) =>
      ejecutar(() =>
        pedir<NotificationDto[]>(
          `/alerts/notifications${noLeidas ? '?unread=true' : ''}`,
        ).then((notificaciones) => ({
          notificaciones,
        })),
      ),
  );
}
