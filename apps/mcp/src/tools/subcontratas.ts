import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  certSubcontrataCreateSchema,
  contratosSubcontrataQuerySchema,
  type CertSubcontrataDto,
  type ContratoSubcontrataResumenDto,
  type RetencionGarantiaDto,
} from '@erp/shared';
import { pedir, pedirVersionado, query } from '../api';
import { ejecutar } from '../comun';

/**
 * Certificaciones de subcontrata y retención de garantía.
 *
 * Deliberadamente NO se exponen `pagar` ni la devolución de garantía: son
 * salidas de dinero y quedan para una persona en la interfaz. El agente puede
 * consultar, medir (crear borradores) y aprobar.
 */
export function registrarSubcontratas(server: McpServer) {
  server.registerTool(
    'listar_contratos_subcontrata',
    {
      title: 'Listar contratos de subcontrata',
      description:
        'Contratos de subcontrata con su situación: importe, producción ' +
        'ejecutada a origen (importe y %), % de retención de garantía, ' +
        'retención pendiente de devolver, nº de certificaciones vigentes y si ' +
        'hay un borrador abierto. Filtra por obra (proyectoId) o subcontrata ' +
        '(proveedorId).',
      inputSchema: contratosSubcontrataQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (filtros) =>
      ejecutar(() =>
        pedir<ContratoSubcontrataResumenDto[]>(
          `/subcontratas/contratos${query(filtros)}`,
        ),
      ),
  );

  server.registerTool(
    'listar_certificaciones_subcontrata',
    {
      title: 'Listar certificaciones de un contrato de subcontrata',
      description:
        'Certificaciones de un contrato de subcontrata por orden de número, ' +
        'con importe a origen, anterior, del periodo, retención, líquido y ' +
        'estado (borrador, aprobada, pagada, anulada).',
      inputSchema: {
        contratoId: z.string().uuid().describe('Contrato de subcontrata'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ contratoId }) =>
      ejecutar(() =>
        pedir<CertSubcontrataDto[]>(
          `/subcontratas/contratos/${contratoId}/certificaciones`,
        ),
      ),
  );

  server.registerTool(
    'crear_certificacion_subcontrata',
    {
      title: 'Crear certificación de subcontrata (borrador)',
      description:
        'Registra la medición de un subcontratista A ORIGEN: importeOrigen es ' +
        'la producción ACUMULADA desde el inicio del contrato, no la del mes. ' +
        'La API calcula el periodo (a origen − ya certificado), retiene el % ' +
        'de garantía del contrato y el líquido a pagar. Queda en borrador. ' +
        'Errores habituales: 422 si supera el importe del contrato o es menor ' +
        'que lo ya certificado; 409 si el contrato no está activo o ya tiene ' +
        'un borrador.',
      inputSchema: {
        contratoId: z.string().uuid().describe('Contrato de subcontrata'),
        ...certSubcontrataCreateSchema.innerType().shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ contratoId, ...cuerpo }) =>
      ejecutar(() =>
        pedir<CertSubcontrataDto>(
          `/subcontratas/contratos/${contratoId}/certificaciones`,
          { method: 'POST', body: JSON.stringify(cuerpo) },
        ),
      ),
  );

  server.registerTool(
    'aprobar_certificacion_subcontrata',
    {
      title: 'Aprobar certificación de subcontrata',
      description:
        'Aprueba una certificación de subcontrata en borrador: la recalcula ' +
        'con el contrato vigente y actualiza la producción ejecutada del ' +
        'contrato. Exige que la subcontrata esté apta por PRL (409 si tiene ' +
        'documentación bloqueante vencida o a punto de vencer). Requiere rol ' +
        'admin, gerente o administración.',
      inputSchema: {
        id: z.string().uuid().describe('Certificación de subcontrata'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id }) =>
      ejecutar(() =>
        pedirVersionado<CertSubcontrataDto>(
          `/subcontratas/certificaciones/${id}/aprobar`,
          { method: 'POST' },
          async () =>
            (
              await pedir<CertSubcontrataDto>(
                `/subcontratas/certificaciones/${id}`,
              )
            ).version,
          'certificación de subcontrata',
        ),
      ),
  );

  server.registerTool(
    'consultar_retencion_garantia',
    {
      title: 'Consultar retención de garantía de un contrato',
      description:
        'Saldo de la retención de garantía de un contrato de subcontrata: ' +
        'retenido por certificaciones aprobadas o pagadas, devuelto y ' +
        'pendiente, con el detalle de las devoluciones.',
      inputSchema: {
        contratoId: z.string().uuid().describe('Contrato de subcontrata'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ contratoId }) =>
      ejecutar(() =>
        pedir<RetencionGarantiaDto>(
          `/subcontratas/contratos/${contratoId}/retenciones`,
        ),
      ),
  );
}
