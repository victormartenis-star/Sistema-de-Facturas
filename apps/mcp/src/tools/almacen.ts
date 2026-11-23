import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  TIPOS_MOVIMIENTO_STOCK,
  consumoObraSchema,
  devolucionObraSchema,
  entradaStockSchema,
  regularizacionStockSchema,
  traspasoStockBaseSchema,
  type AlmacenDto,
  type ConsumoObraDto,
  type ExistenciaDto,
  type MovimientoStockDto,
  type PaginaDto,
  type ResumenAlmacenDto,
} from '@erp/shared';
import { ErrorApi, pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

/** POST con Idempotency-Key nueva: un reintento del agente no duplica stock. */
function post(cuerpo: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: { 'Idempotency-Key': randomUUID() },
  };
}

/** Versión del saldo de un artículo en un almacén (0 si aún no existe). */
async function versionSaldo(
  almacenId: string,
  articuloId: string,
): Promise<number | null> {
  const filas = await pedir<ExistenciaDto[]>(
    `/almacen/existencias${query({ almacenId, articuloId, conCero: 'true' })}`,
  );
  return filas[0]?.version ?? null;
}

/**
 * Almacén y stock: consulta de existencias valoradas a PMP y kárdex, y
 * operaciones (entrada, consumo a obra, devolución, traspaso y
 * regularización), todas por la API, que valora, contabiliza y audita.
 */
export function registrarAlmacen(server: McpServer) {
  server.registerTool(
    'resumen_almacen',
    {
      title: 'Resumen de almacén',
      description:
        'Valoración total del inventario a precio medio ponderado (PMP), ' +
        'número de almacenes, artículos con stock y alertas bajo mínimo, ' +
        'desglosado por almacén.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ejecutar(() => pedir<ResumenAlmacenDto>('/almacen/resumen')),
  );

  server.registerTool(
    'listar_almacenes',
    {
      title: 'Almacenes',
      description:
        'Almacenes centrales y acopios de obra con su valoración y alertas. ' +
        'Usa el id para las operaciones de stock.',
      inputSchema: { activo: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ activo }) =>
      ejecutar(() =>
        pedir<AlmacenDto[]>(
          `/almacen/almacenes${query({ activo: activo === undefined ? undefined : String(activo) })}`,
        ),
      ),
  );

  server.registerTool(
    'consultar_existencias',
    {
      title: 'Existencias',
      description:
        'Existencias por almacén y artículo: cantidad, reservada, disponible, ' +
        'PMP, valoración, stock mínimo y si está bajo mínimo. Filtra por ' +
        'almacén, artículo, texto o solo alertas (bajoMinimo).',
      inputSchema: {
        almacenId: z.string().uuid().optional(),
        articuloId: z.string().uuid().optional(),
        q: z
          .string()
          .max(80)
          .optional()
          .describe('Código o nombre de artículo'),
        bajoMinimo: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ bajoMinimo, ...f }) =>
      ejecutar(() =>
        pedir<ExistenciaDto[]>(
          `/almacen/existencias${query({ ...f, bajoMinimo: bajoMinimo ? 'true' : undefined })}`,
        ),
      ),
  );

  server.registerTool(
    'movimientos_stock',
    {
      title: 'Kárdex de movimientos',
      description:
        'Movimientos de stock (entradas, consumos a obra, traspasos, ' +
        'regularizaciones y devoluciones) con cantidad y valor con signo, ' +
        'saldo resultante y asiento. Paginado; filtra por almacén, artículo, ' +
        'obra, tipo y fechas (AAAA-MM-DD).',
      inputSchema: {
        almacenId: z.string().uuid().optional(),
        articuloId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        tipo: z.enum(TIPOS_MOVIMIENTO_STOCK).optional(),
        desde: z.string().optional(),
        hasta: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async (f) =>
      ejecutar(() =>
        pedir<PaginaDto<MovimientoStockDto>>(`/almacen/movimientos${query(f)}`),
      ),
  );

  server.registerTool(
    'consumos_material_obra',
    {
      title: 'Coste de material imputado a una obra',
      description:
        'Coste neto de material de almacén imputado a la obra (consumos − ' +
        'devoluciones), por artículo.',
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(() =>
        pedir<ConsumoObraDto>(`/almacen/obras/${projectId}/consumos`),
      ),
  );

  server.registerTool(
    'registrar_entrada_stock',
    {
      title: 'Registrar entrada en almacén',
      description:
        'Entrada de material (manual o recepción de un albarán con albaranId): ' +
        'recalcula el PMP y contabiliza 3000 a 6100. Un albarán solo se ' +
        'recepciona una vez (DELIVERY_NOTE_ALREADY_STOCKED) y por no más de su ' +
        'importe (DELIVERY_NOTE_AMOUNT_EXCEEDED).',
      inputSchema: entradaStockSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<MovimientoStockDto[]>('/almacen/entradas', post(body)),
      ),
  );

  server.registerTool(
    'imputar_consumo_obra',
    {
      title: 'Imputar consumo de material a obra',
      description:
        'Salida de material del almacén imputada a una obra, valorada al PMP ' +
        'vigente; asiento 6100 (obra) a 3000. Rechaza stock insuficiente ' +
        '(INSUFFICIENT_STOCK, con `disponible`), almacén inactivo ' +
        '(WAREHOUSE_INACTIVE) y período cerrado (FISCAL_PERIOD_CLOSED).',
      inputSchema: consumoObraSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<MovimientoStockDto[]>('/almacen/consumos', post(body)),
      ),
  );

  server.registerTool(
    'devolver_material_obra',
    {
      title: 'Devolución de material de obra',
      description:
        'Devuelve al almacén material sobrante de una obra al coste con que la ' +
        'obra lo consumió (revierte su imputación). No puede superar lo ' +
        'consumido (RETURN_EXCEEDS_CONSUMPTION).',
      inputSchema: devolucionObraSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<MovimientoStockDto[]>('/almacen/devoluciones', post(body)),
      ),
  );

  server.registerTool(
    'traspasar_stock',
    {
      title: 'Traspaso entre almacenes',
      description:
        'Traspaso atómico origen → destino: sale al PMP del origen y recalcula ' +
        'el del destino; sin asiento. Lee la versión del saldo de origen y ' +
        'envía If-Match (VERSION_CONFLICT si cambió).',
      inputSchema: traspasoStockBaseSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(async () => {
        const version = await versionSaldo(body.origenId, body.articuloId);
        if (version === null) {
          throw new ErrorApi(
            409,
            { errorCode: 'INSUFFICIENT_STOCK', disponible: 0 },
            'Stock insuficiente: el artículo no tiene existencias en el almacén de origen',
          );
        }
        return pedirVersionado<MovimientoStockDto>(
          '/almacen/traspasos',
          post(body),
          async () => version,
          'saldo de origen',
        );
      }),
  );

  server.registerTool(
    'regularizar_inventario',
    {
      title: 'Regularizar inventario',
      description:
        'Ajuste por recuento físico (cantidadContada) con motivo obligatorio: ' +
        'faltante 6100 a 3000, sobrante 3000 a 6100. Lee la versión del saldo ' +
        'y envía If-Match. STOCK_REGULARIZATION_NO_DIFFERENCE si coincide.',
      inputSchema: regularizacionStockSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(async () => {
        const version = await versionSaldo(body.almacenId, body.articuloId);
        const init = post(body);
        return version === null
          ? pedir<MovimientoStockDto>('/almacen/regularizaciones', init)
          : pedirVersionado<MovimientoStockDto>(
              '/almacen/regularizaciones',
              init,
              async () => version,
              'saldo',
            );
      }),
  );
}
