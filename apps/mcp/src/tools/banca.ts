import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ESTADOS_REMESA,
  TIPOS_CONCILIACION,
  TIPOS_REMESA,
  liquidezQuerySchema,
  remesaCreateSchema,
  type BankTransactionDto,
  type LiquidezDto,
  type RemesaDto,
  type SugerenciasMovimientoDto,
} from '@erp/shared';
import { pedir, pedirExportacion, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

const id = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idem = () => ({ 'Idempotency-Key': randomUUID() });
const versionRemesa = (rid: string) => async () =>
  (await pedir<RemesaDto>(`/tesoreria/remesas/${rid}`)).version;
const versionMovimiento = (mid: string) => async () => {
  const m = await pedir<BankTransactionDto>(
    `/bank-reconciliation/transacciones/${mid}`,
  );
  // Sin versión no se envía If-Match "0" (la API lo rechazaría).
  if (!m.version) throw new Error('El movimiento no informa su versión');
  return m.version;
};

/**
 * Bank Accounting: remesas SEPA XML, conciliación bancaria asistida y
 * previsión de liquidez. Todo por la API HTTP (validaciones, numeración,
 * contabilidad y auditoría las aplica el ERP).
 */
export function registrarBanca(server: McpServer) {
  server.registerTool(
    'remesas_sepa',
    {
      title: 'Remesas SEPA',
      description:
        'Transferencias (pain.001) y adeudos directos CORE (pain.008) con su estado, partidas, hash del XML y conciliación.',
      inputSchema: {
        estado: z.enum(ESTADOS_REMESA).optional(),
        tipo: z.enum(TIPOS_REMESA).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<RemesaDto[]>(`/tesoreria/remesas${query(q)}`)),
  );

  server.registerTool(
    'crear_remesa_sepa',
    {
      title: 'Crear una remesa SEPA',
      description:
        'Desde vencimientos vivos de facturas aprobadas: pagos para transferencias, cobros para adeudos. Un vencimiento no va en dos remesas vivas (SEPA_DUE_IN_REMITTANCE).',
      inputSchema: remesaCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<RemesaDto>('/tesoreria/remesas', {
          method: 'POST',
          body: JSON.stringify(remesaCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'accion_remesa_sepa',
    {
      title: 'Generar, remitir o anular una remesa',
      description:
        'generar: valida los datos SEPA (SEPA_DATA_INVALID con error por campo) y guarda el XML. remitir (con fecha): liquida y contabiliza los vencimientos. anular (con motivo): solo borrador o generada. Lee la versión y envía If-Match.',
      inputSchema: {
        id: id.describe('Id de la remesa'),
        accion: z.enum(['generar', 'remitir', 'anular']),
        fecha: fecha.optional(),
        motivo: z.string().min(3).max(240).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ id: rid, accion, fecha: f, motivo }) =>
      ejecutar(() =>
        pedirVersionado<RemesaDto>(
          `/tesoreria/remesas/${rid}/${accion}`,
          {
            method: 'POST',
            body: JSON.stringify(
              accion === 'remitir'
                ? { fecha: f }
                : accion === 'anular'
                  ? { motivo }
                  : {},
            ),
            headers: idem(),
          },
          versionRemesa(rid),
          'remesa',
        ),
      ),
  );

  server.registerTool(
    'devolver_partida_remesa',
    {
      title: 'Registrar la devolución de una partida remitida',
      description:
        'Código R (AC04, MD06…) o motivo: anula la liquidación y su asiento a la fecha; el vencimiento vuelve a estar vivo.',
      inputSchema: {
        id: id.describe('Id de la remesa'),
        partidaId: id,
        fecha,
        motivo: z.string().min(3).max(240),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id: rid, partidaId, ...body }) =>
      ejecutar(() =>
        pedirVersionado<RemesaDto>(
          `/tesoreria/remesas/${rid}/partidas/${partidaId}/devolver`,
          { method: 'POST', body: JSON.stringify(body), headers: idem() },
          versionRemesa(rid),
          'remesa',
        ),
      ),
  );

  server.registerTool(
    'xml_remesa_sepa',
    {
      title: 'Fichero SEPA XML de una remesa',
      description: 'El XML guardado al generar (idéntico en cada descarga).',
      inputSchema: { id: id.describe('Id de la remesa') },
      annotations: { readOnlyHint: true },
    },
    async ({ id: rid }) =>
      ejecutar(async () => {
        const r = await pedirExportacion(`/tesoreria/remesas/${rid}/xml`);
        return { xml: r.contenido };
      }),
  );

  server.registerTool(
    'sugerencias_conciliacion',
    {
      title: 'Sugerencias de conciliación bancaria',
      description:
        'Por movimiento pendiente de la cuenta: candidatos puntuados (0-100) entre vencimientos, cobros/pagos registrados, remesas, devoluciones y talones, con la comisión implícita.',
      inputSchema: { bankAccountId: id },
      annotations: { readOnlyHint: true },
    },
    async ({ bankAccountId }) =>
      ejecutar(() =>
        pedir<SugerenciasMovimientoDto[]>(
          `/bank-reconciliation/asistida/sugerencias${query({ bankAccountId })}`,
        ),
      ),
  );

  server.registerTool(
    'conciliar_movimiento',
    {
      title: 'Conciliar un movimiento del extracto',
      description:
        'Con un vencimiento (liquida por el bruto y lo contabiliza), una liquidación, una remesa, una devolución, un talón (lo compensa) o como comisión (6260 a 5720). `comision` cuadra la diferencia. Errores: BANK_DIFFERENCE_MISMATCH, BANK_RECON_TARGET_TAKEN, FISCAL_PERIOD_CLOSED.',
      inputSchema: {
        movimientoId: id,
        tipo: z.enum(TIPOS_CONCILIACION),
        id: id.optional().describe('Documento que concilia (no en comisión)'),
        comision: z.number().min(0).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ movimientoId, ...body }) =>
      ejecutar(() =>
        pedirVersionado<BankTransactionDto>(
          `/bank-reconciliation/transacciones/${movimientoId}/conciliacion`,
          { method: 'POST', body: JSON.stringify(body), headers: idem() },
          versionMovimiento(movimientoId),
          'movimiento',
        ),
      ),
  );

  server.registerTool(
    'desconciliar_movimiento',
    {
      title: 'Desconciliar un movimiento',
      description:
        'Revierte la comisión y, con `anularLiquidacion` en un vencimiento, el cobro o pago creado, a la fecha del movimiento (período cerrado → FISCAL_PERIOD_CLOSED).',
      inputSchema: {
        movimientoId: id,
        anularLiquidacion: z.boolean().optional(),
        motivo: z.string().max(240).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ movimientoId, ...body }) =>
      ejecutar(() =>
        pedirVersionado<BankTransactionDto>(
          `/bank-reconciliation/transacciones/${movimientoId}/desconciliacion`,
          { method: 'POST', body: JSON.stringify(body), headers: idem() },
          versionMovimiento(movimientoId),
          'movimiento',
        ),
      ),
  );

  server.registerTool(
    'prevision_liquidez',
    {
      title: 'Previsión de liquidez',
      description:
        'Por horizontes (p. ej. 7,30,60,90) y semanas: saldo de bancos (572x sin 5729), cartera, talones en tránsito, certificaciones por facturar, pedidos comprometidos y comisiones de avales; tensión si el saldo baja de cero.',
      inputSchema: liquidezQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<LiquidezDto>(`/tesoreria/liquidez${query(q)}`)),
  );
}
