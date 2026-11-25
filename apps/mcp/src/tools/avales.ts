import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DIRECCIONES_AVAL,
  ESTADOS_AVAL,
  TIPOS_AVAL,
  avalComisionSchema,
  avalCreateObjectSchema,
  avalCreateSchema,
  avalEjecutarSchema,
  avalLiberarSchema,
  avalProrrogaSchema,
  type AvalDetalleDto,
  type AvalDto,
  type ResumenAvalesDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('AAAA-MM-DD');
const id = z.string().uuid().describe('Id del aval');

/** POST de acción con Idempotency-Key e If-Match de la versión recién leída. */
const accion = (ruta: string, avalId: string, cuerpo: unknown) =>
  pedirVersionado<AvalDetalleDto>(
    `/avales/${avalId}/${ruta}`,
    {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: { 'Idempotency-Key': randomUUID() },
    },
    async () => (await pedir<AvalDetalleDto>(`/avales/${avalId}`)).version,
    'aval',
  );

export function registrarAvales(server: McpServer) {
  server.registerTool(
    'listar_avales',
    {
      title: 'Avales bancarios y garantías',
      description:
        'Avales emitidos (a nuestro cargo) y recibidos (de subcontratas y ' +
        'proveedores) con nominal, liberado, ejecutado, saldo vivo, ' +
        'vencimiento y días que faltan. Filtra por obra, contacto, estado, ' +
        'tipo, dirección, solo vivos o que vencen en N días (venceEnDias, ' +
        'incluye los ya vencidos sin cerrar).',
      inputSchema: {
        projectId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        estado: z.enum(ESTADOS_AVAL).optional(),
        tipo: z.enum(TIPOS_AVAL).optional(),
        direccion: z.enum(DIRECCIONES_AVAL).optional(),
        vivos: z.boolean().optional(),
        venceEnDias: z.number().int().min(0).max(3650).optional(),
        q: z.string().max(60).optional().describe('Referencia o entidad'),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) => ejecutar(() => pedir<AvalDto[]>(`/avales${query(f)}`)),
  );

  server.registerTool(
    'resumen_avales',
    {
      title: 'Exposición por avales',
      description:
        'Saldo vivo emitido y recibido, avales que vencen en los próximos ' +
        '`dias` (30 por defecto), vencidos sin cerrar y comisiones acumuladas. ' +
        'Opcionalmente de una obra.',
      inputSchema: {
        projectId: z.string().uuid().optional(),
        dias: z.number().int().min(0).max(3650).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() => pedir<ResumenAvalesDto>(`/avales/resumen${query(f)}`)),
  );

  server.registerTool(
    'detalle_aval',
    {
      title: 'Detalle de un aval',
      description:
        'Ficha del aval con su historial de movimientos (alta, liberaciones, ' +
        'ejecuciones, prórrogas, comisiones) y el asiento de cada uno.',
      inputSchema: { id },
      annotations: { readOnlyHint: true },
    },
    async ({ id: avalId }) =>
      ejecutar(() => pedir<AvalDetalleDto>(`/avales/${avalId}`)),
  );

  server.registerTool(
    'alta_aval',
    {
      title: 'Dar de alta un aval',
      description:
        'Registra un aval emitido o recibido, opcionalmente vinculado a obra, ' +
        'contacto, contrato, certificación y cuenta bancaria. No genera ' +
        'asiento (riesgo contingente). Errores: ' +
        'BANK_GUARANTEE_REFERENCE_DUPLICATE, BANK_GUARANTEE_LINK_INVALID.',
      inputSchema: avalCreateObjectSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<AvalDetalleDto>('/avales', {
          method: 'POST',
          body: JSON.stringify(avalCreateSchema.parse(body)),
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ),
  );

  server.registerTool(
    'liberar_aval',
    {
      title: 'Liberar un aval (total o parcial)',
      description:
        'Devolución del aval por el beneficiario. Sin importe libera todo el ' +
        'saldo vivo. Sin asiento. Errores: BANK_GUARANTEE_NOT_ACTIVE, ' +
        'BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE, BANK_GUARANTEE_DATE_INVALID.',
      inputSchema: { id, ...avalLiberarSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: avalId, ...body }) =>
      ejecutar(() => accion('liberar', avalId, avalLiberarSchema.parse(body))),
  );

  server.registerTool(
    'ejecutar_aval',
    {
      title: 'Ejecutar (incautar) un aval',
      description:
        'Ejecución total (sin importe) o parcial. Contabiliza en la fecha: ' +
        'emitido 6780 (obra) a 5720; recibido 5720 a 7780 (obra), y avisa en ' +
        'la bandeja. Errores: BANK_GUARANTEE_NOT_ACTIVE, ' +
        'BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE, FISCAL_PERIOD_CLOSED.',
      inputSchema: { id, ...avalEjecutarSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: avalId, ...body }) =>
      ejecutar(() =>
        accion('ejecutar', avalId, avalEjecutarSchema.parse(body)),
      ),
  );

  server.registerTool(
    'prorrogar_aval',
    {
      title: 'Prorrogar el vencimiento de un aval',
      description:
        'Amplía la fecha de vencimiento de un aval vivo. Error: ' +
        'BANK_GUARANTEE_EXTENSION_INVALID (fecha no posterior o aval indefinido).',
      inputSchema: {
        id,
        fecha,
        nuevaFechaVencimiento: fecha,
        motivo: z.string().min(3).max(240).optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: avalId, ...body }) =>
      ejecutar(() =>
        accion('prorrogar', avalId, avalProrrogaSchema.parse(body)),
      ),
  );

  server.registerTool(
    'registrar_comision_aval',
    {
      title: 'Registrar la comisión de un aval emitido',
      description:
        'Comisión liquidada por el banco (6260 obra a 5720). Sin importe se ' +
        'calcula con la tasa anual del aval sobre el saldo vivo por `meses` ' +
        '(por defecto, su periodicidad). Error: ' +
        'BANK_GUARANTEE_COMMISSION_NOT_APPLICABLE.',
      inputSchema: { id, ...avalComisionSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: avalId, ...body }) =>
      ejecutar(() =>
        accion('comision', avalId, avalComisionSchema.parse(body)),
      ),
  );
}
