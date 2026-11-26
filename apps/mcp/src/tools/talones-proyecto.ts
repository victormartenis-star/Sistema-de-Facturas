import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  liberacionRetencionSchema,
  modificadoSubcontrataSchema,
  talonAccionSchema,
  talonarioCreateSchema,
  talonesQuerySchema,
  type LiberacionRetencionDto,
  type ModificadoSubcontrataDto,
  type RetencionesProyectoDto,
  type TalonDto,
  type TalonarioDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const id = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idem = () => ({ 'Idempotency-Key': randomUUID() });

/**
 * Talones y cheques bancarios, y Project System (retenciones de obra,
 * liberación por hito o sustitución por aval, modificados de subcontrata).
 */
export function registrarTalonesProyecto(server: McpServer) {
  server.registerTool(
    'talonarios',
    {
      title: 'Talonarios por cuenta bancaria',
      description:
        'Rango, siguiente número, disponibles y estado (activo, agotado, anulado).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ejecutar(() => pedir<TalonarioDto[]>('/tesoreria/talonarios')),
  );

  server.registerTool(
    'crear_talonario',
    {
      title: 'Dar de alta un talonario',
      description:
        'Rango de números de una cuenta sin solaparse con otros (CHECK_BOOK_OVERLAP).',
      inputSchema: talonarioCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<TalonarioDto>('/tesoreria/talonarios', {
          method: 'POST',
          body: JSON.stringify(talonarioCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'talones',
    {
      title: 'Talones y cheques',
      description:
        'Talones emitidos y cheques recibidos con estado, fechas y vencimiento que liquidan.',
      inputSchema: talonesQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<TalonDto[]>(`/tesoreria/talones${query(q)}`)),
  );

  server.registerTool(
    'emitir_talon',
    {
      title: 'Emitir un talón o registrar un cheque recibido',
      description:
        'Emitido (pago): del talonario, contra un vencimiento de pago. Recibido (cobro): cuenta de depósito y número, contra un vencimiento de cobro. Liquida el vencimiento contra 5729 y se contabiliza al momento. Errores: CHECK_BOOK_EXHAUSTED, CHECK_NUMBER_DUPLICATE, CHECK_DIRECTION_MISMATCH, FISCAL_PERIOD_CLOSED.',
      inputSchema: {
        direccion: z.enum(['emitido', 'recibido']),
        vencimientoId: id,
        importe: z.number().positive(),
        fechaEmision: fecha,
        fechaVencimiento: fecha.optional(),
        talonarioId: id.optional(),
        bankAccountId: id.optional(),
        numero: z.string().max(30).optional(),
        concepto: z.string().max(240).optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<TalonDto>('/tesoreria/talones', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'accion_talon',
    {
      title: 'Entregar, cobrar, anular, detener o devolver un talón',
      description:
        'Cobrar compensa 5729 ↔ 5720; anular, detener o devolver (con motivo) revierte la liquidación y, si estaba cobrado, la compensación. Lee la versión y envía If-Match. Error: CHECK_INVALID_TRANSITION.',
      inputSchema: {
        id: id.describe('Id del talón'),
        ...talonAccionSchema.shape,
      },
      annotations: { readOnlyHint: false },
    },
    async ({ id: tid, ...body }) =>
      ejecutar(() =>
        pedirVersionado<TalonDto>(
          `/tesoreria/talones/${tid}/acciones`,
          {
            method: 'POST',
            body: JSON.stringify(talonAccionSchema.parse(body)),
            headers: idem(),
          },
          async () =>
            (await pedir<TalonDto>(`/tesoreria/talones/${tid}`)).version,
          'talón',
        ),
      ),
  );

  server.registerTool(
    'retenciones_obra',
    {
      title: 'Retenciones de garantía de una obra',
      description:
        'Las que nos retiene el cliente (4301) y las que retenemos a subcontratas (4001): pendiente, liberable, sustituido por aval y en garantía, con cada vencimiento y su liberación.',
      inputSchema: { projectId: id, fecha: fecha.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, fecha: f }) =>
      ejecutar(() =>
        pedir<RetencionesProyectoDto>(
          `/project-system/obras/${projectId}/retenciones${query({ fecha: f })}`,
        ),
      ),
  );

  server.registerTool(
    'liberar_retenciones',
    {
      title: 'Liberar retenciones por hito o sustituirlas por aval',
      description:
        'Adelanta el vencimiento de retenciones del mismo tercero y lado. Con `tipo: aval`, el aval debe ser de retención de garantía, del tercero, vivo, con la dirección adecuada y cubrir lo sustituido. Errores: PS_GUARANTEE_INVALID, PS_GUARANTEE_INSUFFICIENT, PS_RETENTION_ALREADY_RELEASED.',
      inputSchema: {
        projectId: id,
        ...liberacionRetencionSchema.innerType().shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ projectId, ...body }) =>
      ejecutar(() =>
        pedir<LiberacionRetencionDto>(
          `/project-system/obras/${projectId}/liberaciones`,
          {
            method: 'POST',
            body: JSON.stringify(liberacionRetencionSchema.parse(body)),
            headers: idem(),
          },
        ),
      ),
  );

  server.registerTool(
    'anular_liberacion_retenciones',
    {
      title: 'Deshacer una liberación de retenciones',
      description:
        'Devuelve los vencimientos a su fecha si aún no se han cobrado ni pagado (PS_RELEASE_SETTLED).',
      inputSchema: {
        projectId: id,
        id: id.describe('Id de la liberación'),
        motivo: z.string().min(3).max(240),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ projectId, id: lid, motivo }) =>
      ejecutar(() =>
        pedirVersionado<LiberacionRetencionDto>(
          `/project-system/liberaciones/${lid}/anular`,
          { method: 'POST', body: JSON.stringify({ motivo }) },
          async () => {
            const l = (
              await pedir<LiberacionRetencionDto[]>(
                `/project-system/obras/${projectId}/liberaciones`,
              )
            ).find((x) => x.id === lid);
            // Sin versión no se envía If-Match "0" (la API lo rechaza): se informa.
            if (!l)
              throw new Error(
                'Liberación no encontrada en esa obra (PS_RELEASE_NOT_FOUND)',
              );
            return l.version;
          },
          'liberación',
        ),
      ),
  );

  server.registerTool(
    'modificado_subcontrata',
    {
      title: 'Registrar un modificado del contrato de subcontrata',
      description:
        'Importe con signo; el contrato no baja de lo certificado a origen (PS_CHANGE_BELOW_CERTIFIED). Devuelve el historial de modificados.',
      inputSchema: { contratoId: id, ...modificadoSubcontrataSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ contratoId, ...body }) =>
      ejecutar(() =>
        pedir<ModificadoSubcontrataDto[]>(
          `/project-system/subcontratas/${contratoId}/modificados`,
          {
            method: 'POST',
            body: JSON.stringify(modificadoSubcontrataSchema.parse(body)),
            headers: idem(),
          },
        ),
      ),
  );
}
