import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  INVOICE_KINDS,
  INVOICE_STATUSES,
  ISP_LEGEND,
  invoiceCancelSchema,
  invoiceCreateSchema,
  invoiceRectifySchema,
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

  // La API exige un cuerpo JSON en /anular: fuera de borrador, con `motivo`
  // (5-500 caracteres). Se envia siempre, aunque sea `{}`.
  server.registerTool(
    'anular_factura',
    {
      title: 'Anular factura',
      description:
        'Anula la factura. No la borra: queda en estado anulada para conservar ' +
        'la trazabilidad. Fuera de borrador el motivo es OBLIGATORIO. ' +
        'Una factura de VENTA aprobada no se anula: se corrige con ' +
        'rectificar_factura. Una de compra con algun vencimiento pagado tampoco.',
      inputSchema: {
        id: z.string().uuid().describe('Identificador'),
        ...invoiceCancelSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, motivo }) =>
      ejecutar(() =>
        pedir<InvoiceDto>(`/invoices/${id}/anular`, {
          method: 'POST',
          body: JSON.stringify(motivo ? { motivo } : {}),
        }),
      ),
  );

  server.registerTool(
    'rectificar_factura',
    {
      title: 'Rectificar factura',
      description:
        'Crea una factura RECTIFICATIVA en estado borrador de una factura ' +
        'aprobada o pagada (el numero lo asigna la API, serie R-AAAA-NNNN). ' +
        'clase="total" invierte todas las lineas y, al aprobar la rectificativa ' +
        '(aprobar_factura), la original pasa a rectificada, se eliminan sus ' +
        'vencimientos previstos, los albaranes quedan libres y, si venia de ' +
        'una certificacion, esta vuelve a borrador; NO se envian lineas. ' +
        'clase="diferencias" exige lines con el delta (positivo o negativo) y ' +
        'no cambia la original. Los importes los calcula la API. La Facturae ' +
        'y VeriFactu de rectificativas aun no estan soportados (409).',
      inputSchema: {
        id: z.string().uuid().describe('Factura que se rectifica'),
        ...invoiceRectifySchema.innerType().shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, ...cuerpo }) =>
      ejecutar(() =>
        pedir<InvoiceDto>(`/invoices/${id}/rectificar`, {
          method: 'POST',
          body: JSON.stringify(cuerpo),
        }),
      ),
  );
}
