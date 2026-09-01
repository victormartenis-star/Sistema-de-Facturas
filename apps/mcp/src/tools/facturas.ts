import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  INVOICE_KINDS,
  INVOICE_STATUSES,
  ISP_LEGEND,
  invoiceCreateSchema,
  type InvoiceDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

export function registrarFacturas(server: McpServer) {
  server.registerTool(
    'listar_facturas',
    {
      title: 'Listar facturas',
      description:
        'Facturas de compra y de venta, con filtro por tipo, estado y texto ' +
        '(numero de factura o nombre del contacto).',
      inputSchema: {
        kind: z.enum(INVOICE_KINDS).optional().describe('compra o venta'),
        status: z.enum(INVOICE_STATUSES).optional().describe('Estado'),
        search: z.string().optional().describe('Numero de factura o contacto'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ kind, status, search }) =>
      ejecutar(() =>
        pedir<InvoiceDto[]>(`/invoices${query({ kind, status, search })}`),
      ),
  );

  server.registerTool(
    'factura_detalle',
    {
      title: 'Detalle de factura',
      description:
        'Una factura con sus lineas, su imputacion analitica por obra y ' +
        'partida, los albaranes que la soportan y los importes calculados ' +
        '(base, IVA, retencion y liquido a cobrar o pagar).',
      inputSchema: { id: z.string().uuid().describe('Identificador') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => ejecutar(() => pedir<InvoiceDto>(`/invoices/${id}`)),
  );

  server.registerTool(
    'crear_factura',
    {
      title: 'Crear factura',
      description:
        'Crea una factura en estado borrador. Los importes NO se envian: la ' +
        'API calcula base, IVA, retencion y total a partir de las lineas.\n' +
        `Con isp=true la cuota de IVA es cero y la factura debe llevar la ` +
        `leyenda legal: "${ISP_LEGEND}"\n` +
        'retentionPct aplica la retencion por garantia sobre la base imponible. ' +
        'En facturas de compra, deliveryNoteIds enlaza albaranes ya validados.',
      inputSchema: invoiceCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (entrada) =>
      ejecutar(() =>
        pedir<InvoiceDto>('/invoices', {
          method: 'POST',
          body: JSON.stringify(entrada),
        }),
      ),
  );

  // Transiciones de estado. Van separadas y no como un "update status" generico
  // porque la API las expone asi y cada una tiene sus propias validaciones.
  const transiciones = [
    {
      nombre: 'aprobar_factura',
      ruta: 'aprobar',
      titulo: 'Aprobar factura',
      desc: 'Pasa la factura de borrador a aprobada y genera sus vencimientos en tesoreria.',
    },
    {
      nombre: 'pagar_factura',
      ruta: 'pagar',
      titulo: 'Marcar factura como pagada',
      desc: 'Marca una factura aprobada como pagada.',
    },
    {
      nombre: 'anular_factura',
      ruta: 'anular',
      titulo: 'Anular factura',
      desc: 'Anula la factura. No la borra: queda en estado anulada para conservar la trazabilidad.',
    },
  ] as const;

  for (const t of transiciones) {
    server.registerTool(
      t.nombre,
      {
        title: t.titulo,
        description: t.desc,
        inputSchema: { id: z.string().uuid().describe('Identificador') },
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async ({ id }) =>
        ejecutar(() =>
          pedir<InvoiceDto>(`/invoices/${id}/${t.ruta}`, { method: 'POST' }),
        ),
    );
  }
}
