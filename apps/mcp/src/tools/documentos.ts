import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

interface DocumentDto {
  id: string;
  fileName: string;
  mimeType: string;
  docType: string | null;
  status: string;
  projectId: string | null;
  contactId: string | null;
  notes: string | null;
  ocrText: string | null;
  extractedData: unknown;
  validationErrors: unknown;
  createdAt: string;
  updatedAt: string;
}

export function registrarDocumentos(server: McpServer) {
  /**
   * Lista documentos del ERP con filtros.
   */
  server.registerTool(
    'listar_documentos',
    {
      title: 'Listar documentos',
      description:
        'Lista documentos subidos al ERP. Permite filtrar por estado ' +
        '(pendiente, procesando, extraido, validado, rechazado), tipo de ' +
        'documento (factura_compra, factura_venta, albaran, contrato, otro) ' +
        'o por obra. Útil para ver qué documentos están pendientes de validar.',
      inputSchema: {
        status: z
          .enum(['pendiente', 'procesando', 'extraido', 'validado', 'rechazado'])
          .optional()
          .describe('Estado del documento en el pipeline OCR'),
        docType: z
          .enum(['factura_compra', 'factura_venta', 'albaran', 'contrato', 'otro'])
          .optional()
          .describe('Tipo de documento'),
        projectId: z
          .string()
          .uuid()
          .optional()
          .describe('Filtrar por obra (uuid)'),
        search: z.string().optional().describe('Búsqueda por nombre de archivo'),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) =>
      ejecutar(async () => {
        const docs = await pedir<DocumentDto[]>(
          `/documents${query(params)}`,
        );
        return {
          total: docs.length,
          pendientesValidar: docs.filter(
            (d) => d.status === 'extraido',
          ).length,
          documentos: docs.map((d) => ({
            id: d.id,
            fileName: d.fileName,
            docType: d.docType,
            status: d.status,
            projectId: d.projectId,
            contactId: d.contactId,
            createdAt: d.createdAt,
          })),
        };
      }),
  );

  /**
   * Detalle de un documento: OCR + extracción + errores de validación.
   */
  server.registerTool(
    'documento_detalle',
    {
      title: 'Detalle de un documento OCR',
      description:
        'Devuelve el detalle completo de un documento: texto extraído por ' +
        'OCR, campos estructurados extraídos (proveedor, importe, fecha, ' +
        'número de factura…) y errores de validación detectados. Úsala ' +
        'para revisar qué ha leído el sistema de un documento concreto o ' +
        'para diagnosticar por qué no ha podido validarse.',
      inputSchema: {
        documentId: z
          .string()
          .uuid()
          .describe('ID del documento (uuid)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ documentId }) =>
      ejecutar(async () => {
        const doc = await pedir<DocumentDto>(`/documents/${documentId}`);
        return {
          id: doc.id,
          fileName: doc.fileName,
          docType: doc.docType,
          status: doc.status,
          notes: doc.notes,
          ocrText: doc.ocrText
            ? doc.ocrText.slice(0, 2000) +
              (doc.ocrText.length > 2000 ? '\n…[truncado]' : '')
            : null,
          extractedData: doc.extractedData,
          validationErrors: doc.validationErrors,
          projectId: doc.projectId,
          contactId: doc.contactId,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };
      }),
  );

  /**
   * Estadísticas del pipeline OCR.
   */
  server.registerTool(
    'estadisticas_ocr',
    {
      title: 'Estadísticas del pipeline OCR',
      description:
        'Devuelve un resumen del estado del pipeline de extracción OCR: ' +
        'cuántos documentos hay en cada estado, cuántos están pendientes ' +
        'de revisión y cuántos han sido rechazados.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(async () => {
        const docs = await pedir<DocumentDto[]>('/documents');
        const porEstado = docs.reduce<Record<string, number>>((acc, d) => {
          acc[d.status] = (acc[d.status] ?? 0) + 1;
          return acc;
        }, {});
        return {
          total: docs.length,
          porEstado,
          pendientesDeRevision: docs.filter((d) => d.status === 'extraido').length,
          rechazados: docs.filter((d) => d.status === 'rechazado').length,
        };
      }),
  );
}
