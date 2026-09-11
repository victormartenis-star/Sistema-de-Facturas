import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviationReportDto } from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

interface DashboardResumenDto {
  obras: { total: number; enCurso: number; contratado: number };
  certificaciones: {
    totalCertificado: number;
    retencionAcumulada: number;
    certsPendientesFacturar: number;
  };
  tesoreria: {
    pendienteCobro: number;
    pendientePago: number;
    vencidoCobro: number;
    vencidoPago: number;
  };
  compras: { pedidosPendientes: number; importePedidosPendientes: number };
  facturas: { ventaBorradores: number; compraBorradores: number };
}

interface ProjectDto {
  id: string;
  code: string;
  name: string;
  status: string;
  contractAmount: number | null;
  startDate: string | null;
  endDate: string | null;
}

interface CertificationDto {
  id: string;
  projectId: string;
  seq: number;
  certDate: string;
  cumulativePct: number;
  cumulativeAmount: number;
  periodAmount: number;
  retentionAmount: number;
  status: string;
}

export function registrarDashboard(server: McpServer) {
  /**
   * Resumen global de la empresa: KPIs de obras, certificaciones,
   * tesorería y compras en un solo vistazo.
   */
  server.registerTool(
    'resumen_empresa',
    {
      title: 'Resumen global de la empresa',
      description:
        'Devuelve los KPIs más importantes de toda la empresa en tiempo ' +
        'real: obras en curso, volumen contratado, total certificado, ' +
        'retenciones acumuladas, pendiente de cobro y de pago (con ' +
        'importes vencidos), pedidos pendientes y facturas en borrador. ' +
        'Úsala como punto de partida de cualquier consulta de estado general.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(async () => {
        const r = await pedir<DashboardResumenDto>('/dashboard/resumen');
        return {
          obras: r.obras,
          certificaciones: r.certificaciones,
          tesoreria: r.tesoreria,
          compras: r.compras,
          facturas: r.facturas,
        };
      }),
  );

  /**
   * Ficha económica completa de una obra: contrato, certificaciones,
   * % ejecutado, retención y desvío por fase.
   */
  server.registerTool(
    'resumen_obra',
    {
      title: 'Ficha económica de una obra',
      description:
        'Devuelve la ficha económica completa de una obra: datos del ' +
        'contrato, histórico de certificaciones con % ejecutado acumulado, ' +
        'retención pendiente de liberar y desvío presupuesto vs. coste real ' +
        'por fase. Combina datos de presupuesto, certificaciones y facturas.',
      inputSchema: {
        projectId: z
          .string()
          .uuid()
          .describe('Identificador de la obra (uuid)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      ejecutar(async () => {
        // Datos de la obra
        const obra = await pedir<ProjectDto>(`/projects/${projectId}`);

        // Certificaciones de la obra
        const certs = await pedir<CertificationDto[]>(
          `/certifications${query({ projectId })}`,
        );

        // Desvío por fase
        const desvio = await pedir<DeviationReportDto>(
          `/projects/${projectId}/desvio`,
        );

        const ultima = certs.at(-1);
        const totalCertificado = certs.reduce(
          (s, c) => s + c.periodAmount,
          0,
        );
        const retencionAcumulada = certs.reduce(
          (s, c) => s + c.retentionAmount,
          0,
        );
        const certsPendientesFacturar = certs.filter(
          (c) => c.status === 'borrador',
        ).length;

        const pctEjecutado = ultima?.cumulativePct ?? 0;
        const importeEjecutado = ultima?.cumulativeAmount ?? 0;

        return {
          obra: {
            id: obra.id,
            code: obra.code,
            name: obra.name,
            status: obra.status,
            contractAmount: obra.contractAmount,
            startDate: obra.startDate,
            endDate: obra.endDate,
          },
          certificaciones: {
            total: certs.length,
            ultimaFecha: ultima?.certDate ?? null,
            pctEjecutado,
            importeEjecutado,
            totalCertificado,
            retencionAcumulada,
            certsPendientesFacturar,
          },
          desvioTotal: {
            presupuestado: desvio.budgetTotal,
            real: desvio.actualTotal,
            desvio: desvio.deviation,
            desvioEsPositivo: desvio.deviation > 0, // true = sobrecoste
          },
          fasesDesvio: desvio.rows.map((r) => ({
            fase: r.name,
            presupuestado: r.budget,
            real: r.actual,
            desvio: r.deviation,
            desvioPct: r.deviationPct,
          })),
        };
      }),
  );
}
