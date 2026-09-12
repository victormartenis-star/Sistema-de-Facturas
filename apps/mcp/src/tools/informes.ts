import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pedir } from '../api';
import { ejecutar } from '../comun';

interface ObrasKpiRow {
  projectId: string;
  code: string;
  name: string;
  status: string;
  contractAmount: number;
  totalCertificado: number;
  pctCertificado: number;
  costReal: number;
  margenBruto: number;
  margenPct: number;
}

export function registrarInformes(server: McpServer) {
  /**
   * Ranking económico de todas las obras: margen bruto, % certificado,
   * coste real y comparación contra el contrato.
   */
  server.registerTool(
    'informe_obras',
    {
      title: 'Informe económico de todas las obras',
      description:
        'Devuelve los KPIs económicos de cada obra de la empresa: importe ' +
        'contratado, total certificado a origen, porcentaje de avance, coste ' +
        'real (facturas de compra aprobadas), margen bruto en € y en %. ' +
        'Permite detectar qué obras tienen sobrecoste o margen bajo. ' +
        'El resultado incluye todas las obras visibles para el usuario autenticado.',
      inputSchema: {
        soloEnCurso: z
          .boolean()
          .optional()
          .describe('Si true, filtra solo obras con estado en_curso'),
        ordenarPor: z
          .enum(['margenPct', 'contractAmount', 'pctCertificado'])
          .optional()
          .describe('Campo por el que ordenar el resultado (por defecto: contractAmount desc)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ soloEnCurso, ordenarPor }) =>
      ejecutar(async () => {
        const filas = await pedir<ObrasKpiRow[]>('/dashboard/obras');

        let resultado = soloEnCurso
          ? filas.filter((r) => r.status === 'en_curso')
          : filas;

        const campo = ordenarPor ?? 'contractAmount';
        resultado = [...resultado].sort((a, b) => b[campo] - a[campo]);

        const totContrato = resultado.reduce((s, r) => s + r.contractAmount, 0);
        const totCert = resultado.reduce((s, r) => s + r.totalCertificado, 0);
        const totCost = resultado.reduce((s, r) => s + r.costReal, 0);
        const totMargen = totCert - totCost;
        const margenGlobal = totCert > 0 ? Math.round((totMargen / totCert) * 10000) / 100 : 0;

        return {
          resumen: {
            numObras: resultado.length,
            contratadoTotal: Math.round(totContrato * 100) / 100,
            certificadoTotal: Math.round(totCert * 100) / 100,
            costeRealTotal: Math.round(totCost * 100) / 100,
            margenBrutoTotal: Math.round(totMargen * 100) / 100,
            margenGlobalPct: margenGlobal,
          },
          obras: resultado,
        };
      }),
  );

  /**
   * Alertas de obras con sobrecoste o margen muy bajo.
   */
  server.registerTool(
    'alertas_rentabilidad',
    {
      title: 'Alertas de rentabilidad por obra',
      description:
        'Lista obras en curso cuyo margen bruto es inferior al umbral ' +
        'indicado (por defecto 5%). Útil para detectar rápidamente qué ' +
        'obras están en riesgo económico.',
      inputSchema: {
        umbralPct: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('Umbral de margen % mínimo (default: 5)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ umbralPct }) =>
      ejecutar(async () => {
        const umbral = umbralPct ?? 5;
        const filas = await pedir<ObrasKpiRow[]>('/dashboard/obras');

        const enCurso = filas.filter((r) => r.status === 'en_curso');
        const riesgo = enCurso.filter((r) => r.totalCertificado > 0 && r.margenPct < umbral);
        const sobrecostro = enCurso.filter((r) => r.margenBruto < 0);

        return {
          umbralUsado: umbral,
          conRiesgo: riesgo.length,
          conSobrecoste: sobrecostro.length,
          obras: riesgo.sort((a, b) => a.margenPct - b.margenPct).map((r) => ({
            code: r.code,
            name: r.name,
            margenPct: r.margenPct,
            margenBruto: r.margenBruto,
            sobrecoste: r.margenBruto < 0,
          })),
        };
      }),
  );
}
