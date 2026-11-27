import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ESTADOS_SOLICITUD_APROBACION,
  OPERACIONES_APROBACION,
  decisionMotivoSchema,
  estadoAprobacionQuerySchema,
  reglaAprobacionCreateSchema,
  solicitudAprobacionCreateSchema,
  type EstadoAprobacionDto,
  type ReglaAprobacionDto,
  type SolicitudAprobacionDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const post = (cuerpo: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(cuerpo),
  headers: { 'Idempotency-Key': randomUUID() },
});

/** Versión actual de una solicitud (para If-Match). */
async function versionSolicitud(id: string): Promise<number> {
  const todas = await pedir<SolicitudAprobacionDto[]>(
    '/aprobaciones/solicitudes',
  );
  const s = todas.find((x) => x.id === id);
  return s?.version ?? 1;
}

/**
 * Flujos de aprobación por umbral: consultar pendientes y estado de un
 * documento, solicitar, aprobar o rechazar (con motivo) y gestionar reglas.
 * La API aplica la segregación (SELF_APPROVAL_FORBIDDEN) y el nivel.
 */
export function registrarAprobaciones(server: McpServer) {
  server.registerTool(
    'aprobaciones_pendientes',
    {
      title: 'Solicitudes de aprobación',
      description:
        'Solicitudes de aprobación por umbral (pedidos, facturas de compra y ' +
        'certificaciones de subcontrata). paraMi=true deja solo las pendientes ' +
        'que el usuario puede decidir (puedoDecidir).',
      inputSchema: {
        paraMi: z.boolean().optional(),
        estado: z.enum(ESTADOS_SOLICITUD_APROBACION).optional(),
        operacion: z.enum(OPERACIONES_APROBACION).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ paraMi, ...f }) =>
      ejecutar(() =>
        pedir<SolicitudAprobacionDto[]>(
          `/aprobaciones/solicitudes${query({ ...f, paraMi: paraMi ? 'true' : undefined })}`,
        ),
      ),
  );

  server.registerTool(
    'estado_aprobacion',
    {
      title: 'Estado de aprobación de un documento',
      description:
        'Regla aplicable, última solicitud y evaluación (errorCode ' +
        'APPROVAL_REQUIRED / APPROVAL_PENDING / APPROVAL_REJECTED o null si ' +
        'puede continuar) de un pedido, factura de compra o certificación.',
      inputSchema: estadoAprobacionQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() =>
        pedir<EstadoAprobacionDto>(`/aprobaciones/estado${query(q)}`),
      ),
  );

  server.registerTool(
    'solicitar_aprobacion',
    {
      title: 'Solicitar aprobación',
      description:
        'Pide la aprobación de un documento que alcanza un umbral ' +
        '(APPROVAL_NOT_REQUIRED si no lo alcanza; APPROVAL_ALREADY_REQUESTED ' +
        'si ya hay una viva). Quien la solicita no podrá decidirla.',
      inputSchema: solicitudAprobacionCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<SolicitudAprobacionDto>('/aprobaciones/solicitudes', post(body)),
      ),
  );

  server.registerTool(
    'decidir_aprobacion',
    {
      title: 'Aprobar o rechazar una solicitud',
      description:
        'Aprueba o rechaza (motivo obligatorio al rechazar) el nivel activo ' +
        'de una solicitud pendiente; en una cadena multinivel, aprobar pasa ' +
        'al siguiente nivel. Lee la versión y envía If-Match. Errores: ' +
        'SELF_APPROVAL_FORBIDDEN, APPROVAL_ROLE_INSUFFICIENT, ' +
        'APPROVAL_NOT_ASSIGNEE, SOD_CONFLICT, SOD_JUSTIFICATION_REQUIRED ' +
        '(envía justificacionSod), APPROVAL_STALE.',
      inputSchema: {
        id: z.string().uuid(),
        decision: z.enum(['aprobar', 'rechazar']),
        motivo: z.string().trim().max(500).optional(),
        justificacionSod: z.string().trim().max(500).optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, decision, motivo, justificacionSod }) =>
      ejecutar(async () => {
        const cuerpo =
          decision === 'rechazar'
            ? decisionMotivoSchema.parse({ motivo: motivo ?? '' })
            : {
                comentario: motivo ?? null,
                justificacionSod: justificacionSod ?? null,
              };
        return pedirVersionado<SolicitudAprobacionDto>(
          `/aprobaciones/solicitudes/${id}/${decision}`,
          post(cuerpo),
          () => versionSolicitud(id),
          'solicitud de aprobación',
        );
      }),
  );

  server.registerTool(
    'listar_reglas_aprobacion',
    {
      title: 'Reglas de umbral',
      description:
        'Reglas de aprobación por operación: importe mínimo (inclusive), nivel ' +
        'que aprueba (administracion < gerente < admin), alcance y si está activa.',
      inputSchema: { operacion: z.enum(OPERACIONES_APROBACION).optional() },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() =>
        pedir<ReglaAprobacionDto[]>(`/aprobaciones/reglas${query(f)}`),
      ),
  );

  server.registerTool(
    'crear_regla_aprobacion',
    {
      title: 'Crear regla de umbral',
      description:
        'Nueva regla: desde qué importe una operación requiere aprobación y de ' +
        'qué nivel; opcionalmente solo para una obra. Solo admin y gerente. ' +
        'APPROVAL_RULE_DUPLICATE si ya hay ese tramo activo.',
      inputSchema: reglaAprobacionCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<ReglaAprobacionDto>('/aprobaciones/reglas', post(body)),
      ),
  );
}
