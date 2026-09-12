import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pedir } from '../api';
import { ejecutar } from '../comun';

interface CertificationLineDto {
  id: string;
  certificationId: string;
  budgetItemId: string;
  cumulativePct: number;
  cumulativeAmount: number;
  periodAmount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function registrarLineasCertificacion(server: McpServer) {
  /**
   * Líneas de una certificación: avance a origen por partida de presupuesto.
   */
  server.registerTool(
    'lineas_certificacion',
    {
      title: 'Líneas de una certificación por partida',
      description:
        'Devuelve el desglose por partida de presupuesto de una certificación: ' +
        'para cada partida, el % acumulado a origen, el importe acumulado y el ' +
        'importe del periodo. Útil para ver qué partidas se han avanzado en una ' +
        'certificación concreta.',
      inputSchema: {
        certificationId: z
          .string()
          .uuid()
          .describe('ID de la certificación (uuid)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ certificationId }) =>
      ejecutar(async () => {
        const lineas = await pedir<CertificationLineDto[]>(
          `/certifications/${certificationId}/lines`,
        );
        const totalPeriodo = lineas.reduce((s, l) => s + l.periodAmount, 0);
        const totalAcumulado = lineas.reduce((s, l) => s + l.cumulativeAmount, 0);
        return {
          certificationId,
          numLineas: lineas.length,
          totalPeriodo: Math.round(totalPeriodo * 100) / 100,
          totalAcumulado: Math.round(totalAcumulado * 100) / 100,
          lineas,
        };
      }),
  );
}
