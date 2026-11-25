import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  anticipoAplicarSchema,
  anticipoCreateSchema,
  carteraQuerySchema,
  compensacionCreateSchema,
  conciliacionCarteraQuerySchema,
  lotesQuerySchema,
  type AnticipoDto,
  type AntiguedadDto,
  type CompensacionDto,
  type ConciliacionCarteraDto,
  type LoteDto,
  type PartidasCarteraDto,
  type TrazaLoteDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const id = z.string().uuid();
const motivo = z.string().trim().min(3).max(240).describe('Motivo (auditado)');

/**
 * Cartera de clientes y proveedores (subledgers AR/AP) e inventario por lote
 * y número de serie. Todo pasa por la API (mismas reglas que la web).
 */
export function registrarCartera(server: McpServer) {
  server.registerTool(
    'partidas_abiertas',
    {
      title: 'Partidas abiertas de clientes o proveedores',
      description:
        'Vencimientos pendientes por tercero y factura a una fecha de corte ' +
        '(`fecha`, nunca futura), con días vencidos y tramo de antigüedad. ' +
        '`tipo`: clientes | proveedores; filtros `contactId`, `projectId`, ' +
        '`soloVencidas`. Error: AR_AP_DATE_INVALID.',
      inputSchema: {
        ...carteraQuerySchema.omit({ soloVencidas: true }).shape,
        soloVencidas: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ soloVencidas, ...q }) =>
      ejecutar(() =>
        pedir<PartidasCarteraDto>(
          `/cartera/partidas${query({ ...q, soloVencidas: soloVencidas ? 'true' : undefined })}`,
        ),
      ),
  );

  server.registerTool(
    'antiguedad_saldos',
    {
      title: 'Antigüedad de saldos (aging)',
      description:
        'Pendiente por tercero en tramos al corriente, 1–30, 31–60, 61–90 y ' +
        '> 90 días, con retención de garantía, vencido y total (céntimos ' +
        'exactos: los tramos suman el total).',
      inputSchema: carteraQuerySchema.omit({ soloVencidas: true }).shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<AntiguedadDto>(`/cartera/antiguedad${query(q)}`)),
  );

  server.registerTool(
    'conciliacion_cartera',
    {
      title: 'Conciliación por tercero (auxiliar ↔ mayor)',
      description:
        'Por cliente (430x + 438x) o proveedor (400x + 407x): auxiliar ' +
        '(ordinario + retención − anticipos pendientes) frente al mayor con ' +
        'ese tercero en la línea; los apuntes sin tercero salen en su fila.',
      inputSchema: conciliacionCarteraQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() =>
        pedir<ConciliacionCarteraDto>(`/cartera/conciliacion${query(q)}`),
      ),
  );

  server.registerTool(
    'anticipos_terceros',
    {
      title: 'Anticipos de clientes y a proveedores',
      description:
        'Lista los anticipos (importe, aplicado, disponible, aplicaciones).',
      inputSchema: {
        tipo: z.enum(['clientes', 'proveedores']).optional(),
        contactId: id.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<AnticipoDto[]>(`/cartera/anticipos${query(q)}`)),
  );

  server.registerTool(
    'registrar_anticipo',
    {
      title: 'Registrar un anticipo',
      description:
        'Cobro de un anticipo de cliente (5720 a 4380) o pago a proveedor ' +
        '(4070 a 5720), contabilizado al momento. Admin, gerente y ' +
        'administración.',
      inputSchema: anticipoCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<AnticipoDto>('/cartera/anticipos', {
          method: 'POST',
          body: JSON.stringify(anticipoCreateSchema.parse(body)),
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ),
  );

  server.registerTool(
    'aplicar_anticipo',
    {
      title: 'Aplicar un anticipo a facturas',
      description:
        'Liquida vencimientos del mismo tercero con el anticipo (4380 a ' +
        '4300 / 4000 a 4070): por antigüedad o con `imputaciones` ' +
        'explícitas, sin superar lo disponible. Lee la versión y envía ' +
        'If-Match. Errores: AR_AP_ALLOCATION_*, AR_AP_ADVANCE_APPLIED.',
      inputSchema: {
        id: id.describe('Id del anticipo'),
        ...anticipoAplicarSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id: anticipoId, ...body }) =>
      ejecutar(() =>
        pedirVersionado<AnticipoDto>(
          `/cartera/anticipos/${anticipoId}/aplicar`,
          {
            method: 'POST',
            body: JSON.stringify(anticipoAplicarSchema.parse(body)),
            headers: { 'Idempotency-Key': randomUUID() },
          },
          async () =>
            (await pedir<AnticipoDto>(`/cartera/anticipos/${anticipoId}`))
              .version,
          'anticipo',
        ),
      ),
  );

  server.registerTool(
    'anular_anticipo',
    {
      title: 'Desaplicar o anular un anticipo',
      description:
        '`accion`: desaplicar (anula sus aplicaciones y lo deja disponible) ' +
        'o anular (solo sin aplicaciones, con contra-asiento).',
      inputSchema: {
        id: id.describe('Id del anticipo'),
        accion: z.enum(['desaplicar', 'anular']),
        motivo,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id: anticipoId, accion, motivo: m }) =>
      ejecutar(() =>
        pedirVersionado<AnticipoDto>(
          `/cartera/anticipos/${anticipoId}/${accion}`,
          { method: 'POST', body: JSON.stringify({ motivo: m }) },
          async () =>
            (await pedir<AnticipoDto>(`/cartera/anticipos/${anticipoId}`))
              .version,
          'anticipo',
        ),
      ),
  );

  server.registerTool(
    'compensar_tercero',
    {
      title: 'Compensar cobros y pagos de un tercero',
      description:
        'Para un tercero cliente y proveedor: compensa lo que nos debe con lo ' +
        'que le debemos (5550 a 430x y 400x a 5550, mismo importe). Sin ' +
        '`importe`, el menor de los dos pendientes. Errores: ' +
        'AR_AP_ITEM_NOT_OPEN, AR_AP_NETTING_UNBALANCED.',
      inputSchema: compensacionCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<CompensacionDto>('/cartera/compensaciones', {
          method: 'POST',
          body: JSON.stringify(compensacionCreateSchema.parse(body)),
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ),
  );

  server.registerTool(
    'anular_compensacion',
    {
      title: 'Anular una compensación',
      description: 'Anula las liquidaciones de los dos lados (If-Match).',
      inputSchema: { id: id.describe('Id de la compensación'), motivo },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id: compId, motivo: m }) =>
      ejecutar(() =>
        pedirVersionado<CompensacionDto>(
          `/cartera/compensaciones/${compId}/anular`,
          { method: 'POST', body: JSON.stringify({ motivo: m }) },
          async () =>
            (await pedir<CompensacionDto>(`/cartera/compensaciones/${compId}`))
              .version,
          'compensación',
        ),
      ),
  );

  /* ─────────────── lotes y números de serie ─────────────── */

  server.registerTool(
    'lotes_almacen',
    {
      title: 'Lotes y números de serie del almacén',
      description:
        'Lotes / series con su caducidad y existencia por almacén visible. ' +
        'Filtros: articuloId, almacenId, q (código), conStock.',
      inputSchema: {
        ...lotesQuerySchema.omit({ conStock: true }).shape,
        conStock: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ conStock, ...q }) =>
      ejecutar(() =>
        pedir<LoteDto[]>(
          `/almacen/lotes${query({ ...q, conStock: conStock ? 'true' : undefined })}`,
        ),
      ),
  );

  server.registerTool(
    'trazabilidad_lote',
    {
      title: 'Trazabilidad de un lote o número de serie',
      description:
        'Movimientos del lote (entrada, traspasos, consumos, devoluciones, ' +
        'regularizaciones) y obras que lo consumieron. Error: ' +
        'BATCH_SERIAL_NOT_FOUND.',
      inputSchema: { id: id.describe('Id del lote o serie') },
      annotations: { readOnlyHint: true },
    },
    async ({ id: loteId }) =>
      ejecutar(() => pedir<TrazaLoteDto>(`/almacen/lotes/${loteId}`)),
  );
}
