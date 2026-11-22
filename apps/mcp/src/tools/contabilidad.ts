import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ORIGENES_ASIENTO,
  asientoCreateSchema,
  type AsientoDto,
  type CuentaContableDto,
  type LibroMayorDto,
  type PeriodoContableDto,
  type ResultadoInterfazDto,
  type SumasSaldosDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

export function registrarContabilidad(server: McpServer) {
  server.registerTool(
    'plan_contable',
    {
      title: 'Plan de cuentas',
      description:
        'Cuentas del plan contable (PGC) de la empresa. Filtra por código o ' +
        'nombre. Solo las cuentas imputables (4+ dígitos) admiten apuntes.',
      inputSchema: {
        q: z.string().max(80).optional().describe('Código o parte del nombre'),
        imputables: z.boolean().optional().describe('Solo cuentas imputables'),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() =>
        pedir<CuentaContableDto[]>(`/contabilidad/cuentas${query(f)}`),
      ),
  );

  server.registerTool(
    'libro_diario',
    {
      title: 'Libro diario',
      description:
        'Asientos contables con sus líneas (debe/haber, cuenta, obra). ' +
        'Filtra por fechas, origen (manual, factura_venta, factura_compra, ' +
        'cobro, pago, anulacion) u obra.',
      inputSchema: {
        desde: fecha.optional(),
        hasta: fecha.optional(),
        origen: z.enum(ORIGENES_ASIENTO).optional(),
        projectId: z.string().uuid().optional().describe('Obra'),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() =>
        pedir<{ items: AsientoDto[]; total: number }>(
          `/contabilidad/asientos${query(f)}`,
        ),
      ),
  );

  server.registerTool(
    'libro_mayor',
    {
      title: 'Libro mayor de una cuenta',
      description:
        'Movimientos de una cuenta con saldo inicial, saldo acumulado y saldo ' +
        'final en el sentido natural de la cuenta. Opcionalmente por obra.',
      inputSchema: {
        cuenta: z
          .string()
          .regex(/^\d{3,12}$/)
          .describe('Código, p. ej. 4300'),
        desde: fecha.optional(),
        hasta: fecha.optional(),
        projectId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cuenta, ...f }) =>
      ejecutar(() =>
        pedir<LibroMayorDto>(`/contabilidad/mayor/${cuenta}${query(f)}`),
      ),
  );

  server.registerTool(
    'sumas_y_saldos',
    {
      title: 'Balance de sumas y saldos',
      description:
        'Totales debe/haber y saldo deudor/acreedor por cuenta en un rango ' +
        'de fechas; con projectId, la cuenta analítica de una obra. Incluye ' +
        'la comprobación de cuadre.',
      inputSchema: {
        desde: fecha.optional(),
        hasta: fecha.optional(),
        projectId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() =>
        pedir<SumasSaldosDto>(`/contabilidad/sumas-saldos${query(f)}`),
      ),
  );

  server.registerTool(
    'periodos_contables',
    {
      title: 'Períodos contables',
      description:
        'Estado (abierto/cerrado) y nº de asientos de cada mes del ejercicio.',
      inputSchema: { ejercicio: z.number().int().min(2000).max(2100) },
      annotations: { readOnlyHint: true },
    },
    async ({ ejercicio }) =>
      ejecutar(() =>
        pedir<PeriodoContableDto[]>(`/contabilidad/periodos/${ejercicio}`),
      ),
  );

  server.registerTool(
    'crear_asiento',
    {
      title: 'Crear asiento manual',
      description:
        'Contabiliza un asiento manual. Debe cuadrar al céntimo (Σ debe = Σ ' +
        'haber) y cada línea lleva importe en un solo lado. Rechaza períodos ' +
        'cerrados (FISCAL_PERIOD_CLOSED) y cuentas de agrupación ' +
        '(LEDGER_ACCOUNT_NOT_POSTABLE). Los asientos no se editan: se anulan.',
      inputSchema: asientoCreateSchema.innerType().shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<AsientoDto>('/contabilidad/asientos', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
  );

  server.registerTool(
    'anular_asiento',
    {
      title: 'Anular asiento (contra-asiento)',
      description:
        'Genera el contra-asiento de un asiento contabilizado y lo marca como ' +
        'anulado. Devuelve el contra-asiento.',
      inputSchema: {
        id: z.string().uuid(),
        motivo: z.string().min(3).max(240),
        fecha: fecha
          .optional()
          .describe('Por defecto, la del asiento original'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, ...body }) =>
      ejecutar(() =>
        pedir<AsientoDto>(`/contabilidad/asientos/${id}/anular`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
  );

  server.registerTool(
    'contabilizar_pendientes',
    {
      title: 'Interfaz contable',
      description:
        'Contabiliza las facturas aprobadas y los cobros/pagos liquidados ' +
        'que aún no tienen asiento, y anula los de documentos anulados o ' +
        'reabiertos. Idempotente. Informa de los omitidos y su motivo.',
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () =>
      ejecutar(() =>
        pedir<ResultadoInterfazDto>('/contabilidad/interfaz/contabilizar', {
          method: 'POST',
        }),
      ),
  );
}
