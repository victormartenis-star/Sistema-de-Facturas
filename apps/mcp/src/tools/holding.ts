import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  periodoConsolidacionSchema,
  type EstadosConsolidadosDto,
  type GrupoDto,
  type SociedadAccesibleDto,
  type TesoreriaGrupoDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('AAAA-MM-DD');
const periodo = {
  grupoId: z.string().uuid(),
  desde: fecha,
  hasta: fecha,
};

/**
 * Consolidación de grupo / holding (solo lectura): grupos y sociedades,
 * balance y PyG consolidados, tesorería del grupo y descuadres intercompañía.
 * La API exige permiso sobre cada sociedad (HOLDING_COMPANY_ACCESS_DENIED).
 */
export function registrarHolding(server: McpServer) {
  server.registerTool(
    'grupos_consolidacion',
    {
      title: 'Grupos y sociedades',
      description:
        'Grupos (holding) de la sociedad del usuario con sus sociedades ' +
        'miembro (% de participación, método global o proporcional, alta y ' +
        'baja, y si hay permiso de consolidación vigente), más las sociedades ' +
        'accesibles para integrar.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(async () => ({
        grupos: await pedir<GrupoDto[]>('/holding/grupos'),
        sociedadesAccesibles: await pedir<SociedadAccesibleDto[]>(
          '/holding/sociedades',
        ),
      })),
  );

  server.registerTool(
    'estados_consolidados',
    {
      title: 'Balance y PyG consolidados',
      description:
        'Balance y cuenta de resultados consolidados del periodo: por masa y ' +
        'por grupo PGC, con columnas por sociedad, agregado, eliminaciones y ' +
        'consolidado; socios externos, resultado atribuido a la dominante, ' +
        'conciliación intragrupo y si el periodo está cerrado.',
      inputSchema: periodo,
      annotations: { readOnlyHint: true },
    },
    async ({ grupoId, ...p }) =>
      ejecutar(() =>
        pedir<EstadosConsolidadosDto>(
          `/holding/grupos/${grupoId}/estados${query(periodoConsolidacionSchema.parse(p))}`,
        ),
      ),
  );

  server.registerTool(
    'tesoreria_grupo',
    {
      title: 'Tesorería y cartera del grupo',
      description:
        'Liquidez (57x), cobros y pagos pendientes con terceros (los recíprocos ' +
        'intragrupo se eliminan y se informan aparte), posición neta y cartera ' +
        'de obras por sociedad a una fecha.',
      inputSchema: { grupoId: z.string().uuid(), hasta: fecha },
      annotations: { readOnlyHint: true },
    },
    async ({ grupoId, hasta }) =>
      ejecutar(() =>
        pedir<TesoreriaGrupoDto>(
          `/holding/grupos/${grupoId}/tesoreria${query({ hasta })}`,
        ),
      ),
  );

  server.registerTool(
    'descuadres_intercompania',
    {
      title: 'Descuadres intercompañía',
      description:
        'Conciliación por pareja vendedor → comprador: ventas frente a compras ' +
        'y saldos a cobrar frente a pagar registrados por cada sociedad, con la ' +
        'diferencia. descuadre=true impide cerrar el periodo ' +
        '(INTERCOMPANY_MISMATCH) salvo forzándolo.',
      inputSchema: periodo,
      annotations: { readOnlyHint: true },
    },
    async ({ grupoId, ...p }) =>
      ejecutar(() =>
        pedir(
          `/holding/grupos/${grupoId}/intercompania${query(periodoConsolidacionSchema.parse(p))}`,
        ),
      ),
  );
}
