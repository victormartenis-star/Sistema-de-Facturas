import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CERT_STATUSES,
  certificationCreateSchema,
  certificationInvoiceSchema,
  type CertificationDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

export function registrarCertificaciones(server: McpServer) {
  server.registerTool(
    'listar_certificaciones',
    {
      title: 'Listar certificaciones',
      description:
        'Devuelve las certificaciones de obra, ordenadas por proyecto y número ' +
        'de secuencia. Una certificación representa el % ejecutado acumulado ' +
        'a origen: el importe del periodo es la diferencia frente a la ' +
        'certificación anterior. Filtra por obra con projectId.',
      inputSchema: {
        projectId: z
          .string()
          .uuid()
          .optional()
          .describe('Filtra por obra (recomendado)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(() =>
        pedir<CertificationDto[]>(`/certifications${query({ projectId })}`),
      ),
  );

  server.registerTool(
    'crear_certificacion',
    {
      title: 'Crear certificación',
      description:
        'Registra una nueva certificación a origen. El campo cumulativePct ' +
        'es el porcentaje total ejecutado HASTA AHORA (acumulado): si antes ' +
        'había un 30 % y ahora hay un 45 %, pasa cumulativePct=45. La API ' +
        'calcula el importe del periodo (45%-30% × contrato) y el de retención.\n' +
        'La obra debe tener contractAmount definido.\n' +
        'retentionPct es opcional: si no se indica, la API usa la retención ' +
        'configurada en la obra (por defecto 5 %).',
      inputSchema: certificationCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (entrada) =>
      ejecutar(() =>
        pedir<CertificationDto>('/certifications', {
          method: 'POST',
          body: JSON.stringify(entrada),
        }),
      ),
  );

  server.registerTool(
    'facturar_certificacion',
    {
      title: 'Emitir factura de venta desde certificación',
      description:
        'Genera una factura de venta a partir de una certificación aprobada. ' +
        'El importe de la factura es el del periodo menos la retención. ' +
        'Rellena isp=true si la empresa trabaja bajo inversión del sujeto pasivo ' +
        '(habitual en construcción B2B). La factura queda en estado borrador ' +
        'hasta que se apruebe con aprobar_factura.',
      inputSchema: {
        certificationId: z
          .string()
          .uuid()
          .describe('ID de la certificación aprobada'),
        ...certificationInvoiceSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ certificationId, ...body }) =>
      ejecutar(() =>
        pedir<CertificationDto>(`/certifications/${certificationId}/facturar`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
  );

  server.registerTool(
    'eliminar_certificacion',
    {
      title: 'Eliminar certificación',
      description:
        'Borra lógicamente una certificación en estado borrador. Las ' +
        'certificaciones facturadas no se pueden borrar para preservar la ' +
        'trazabilidad documental.',
      inputSchema: {
        certificationId: z.string().uuid().describe('Identificador'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ certificationId }) =>
      ejecutar(async () => {
        await pedir<void>(`/certifications/${certificationId}`, {
          method: 'DELETE',
        });
        return { ok: true, id: certificationId };
      }),
  );

  // ── Herramienta de resumen de avance ────────────────────────────────────────
  server.registerTool(
    'resumen_certificaciones',
    {
      title: 'Resumen de avance certificado de una obra',
      description:
        'Agrega todas las certificaciones de una obra y devuelve: total ' +
        'certificado a origen, retención acumulada, último % ejecutado, número ' +
        'de certificaciones y si la última está facturada. Útil para obtener ' +
        'el estado económico de la obra de un vistazo antes de emitir la ' +
        'siguiente certificación.',
      inputSchema: {
        projectId: z.string().uuid().describe('Identificador de la obra'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(async () => {
        const lista = await pedir<CertificationDto[]>(
          `/certifications${query({ projectId })}`,
        );
        if (!lista.length) {
          return {
            totalCertificado: 0,
            retencionAcumulada: 0,
            ultimoPct: 0,
            numCertificaciones: 0,
            ultimaFacturada: false,
          };
        }
        const ultima = lista[lista.length - 1];
        const totalCertificado = lista.reduce(
          (s, c) => s + c.periodAmount,
          0,
        );
        const retencionAcumulada = lista.reduce(
          (s, c) => s + c.retentionAmount,
          0,
        );
        return {
          totalCertificado: Math.round(totalCertificado * 100) / 100,
          retencionAcumulada: Math.round(retencionAcumulada * 100) / 100,
          ultimoPct: ultima.cumulativePct,
          numCertificaciones: lista.length,
          ultimaFacturada: ultima.status === 'facturada',
          ultimaCertificacion: ultima,
        };
      }),
  );
}
