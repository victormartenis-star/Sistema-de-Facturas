import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  centroCosteCreateSchema,
  fotoPrevisionCreateSchema,
  periodoRepartoSchema,
  previsionQuerySchema,
  revertirRepartoSchema,
  type CentroCosteDto,
  type CicloRepartoDto,
  type CosteCompletoObraDto,
  type EjecucionRepartoDto,
  type EscenarioDto,
  type FotoPrevisionDto,
  type PrevisionDto,
  type SaldoCentroDto,
  type SimulacionRepartoDto,
} from '@erp/shared';
import { pedir, query } from '../api';
import { ejecutar } from '../comun';

const idem = () => ({ 'Idempotency-Key': randomUUID() });

/** If-Match solo con versión entera positiva. */
const siVersion = (v: unknown): Record<string, string> =>
  typeof v === 'number' && Number.isInteger(v) && v > 0
    ? { 'If-Match': `"${v}"` }
    : {};

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('AAAA-MM-DD');

/**
 * Control analítico (SAP CO-OM / Oracle Cost Management y EPM): centros de
 * coste y su saldo, ciclos de reparto con simulación, ejecución y reversión,
 * coste completo por obra y rolling forecast por escenario.
 */
export function registrarControlAnalitico(server: McpServer) {
  server.registerTool(
    'centros_coste',
    {
      title: 'Centros de coste y su saldo',
      description:
        'Centros de coste de la empresa (código, tipo, jerarquía, responsable, cuentas de ' +
        'gasto asignadas) y, con desde/hasta, su saldo analítico: coste primario del mayor, ' +
        'recibido y repartido por ciclos vigentes y pendiente de repartir, por cuenta.',
      inputSchema: { desde: fecha.optional(), hasta: fecha.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ desde, hasta }) =>
      ejecutar(async () => {
        const centros = await pedir<CentroCosteDto[]>(
          '/control-analitico/centros',
        );
        const saldos =
          desde && hasta
            ? await pedir<SaldoCentroDto[]>(
                `/control-analitico/centros/saldos${query(periodoRepartoSchema.parse({ desde, hasta }))}`,
              )
            : null;
        return { centros, saldos };
      }),
  );

  server.registerTool(
    'crear_centro_coste',
    {
      title: 'Crear un centro de coste',
      description:
        'Admin o gerente. Código único (COST_CENTER_CODE_DUPLICATE), padre opcional sin ' +
        'ciclos, responsable y prefijos de cuentas de gasto (un prefijo pertenece a un solo ' +
        'centro: COST_CENTER_ACCOUNT_TAKEN).',
      inputSchema: centroCosteCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<CentroCosteDto>('/control-analitico/centros', {
          method: 'POST',
          body: JSON.stringify(centroCosteCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'ciclos_reparto',
    {
      title: 'Ciclos de reparto y ejecuciones',
      description:
        'Ciclos de distribución e imputación con emisores, receptores (obras o centros), ' +
        'criterio (porcentaje, presupuesto, producción, horas) y sus ejecuciones con estado.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(async () => ({
        ciclos: await pedir<CicloRepartoDto[]>('/control-analitico/ciclos'),
        ejecuciones: await pedir<EjecucionRepartoDto[]>(
          '/control-analitico/ejecuciones',
        ),
      })),
  );

  const periodoCiclo = {
    cicloId: z.string().uuid(),
    desde: fecha,
    hasta: fecha,
  };

  server.registerTool(
    'simular_reparto',
    {
      title: 'Simular un ciclo de reparto',
      description:
        'Previsualiza el reparto del periodo sin escribir: bases y cuotas de cada receptor, ' +
        'líneas por emisor y cuenta con el céntimo de resto asignado y total (siempre igual ' +
        'al saldo de los emisores). ALLOCATION_NO_BASE si ningún receptor tiene base.',
      inputSchema: periodoCiclo,
      annotations: { readOnlyHint: true },
    },
    async ({ cicloId, ...p }) =>
      ejecutar(() =>
        pedir<SimulacionRepartoDto>(
          `/control-analitico/ciclos/${cicloId}/simular`,
          {
            method: 'POST',
            body: JSON.stringify(periodoRepartoSchema.parse(p)),
          },
        ),
      ),
  );

  server.registerTool(
    'ejecutar_reparto',
    {
      title: 'Ejecutar un ciclo de reparto',
      description:
        'Admin o gerente. Contabiliza el reparto en el mayor analítico (no genera asientos). ' +
        'Errores: ALLOCATION_ALREADY_POSTED, ALLOCATION_PERIOD_CLOSED, ' +
        'ALLOCATION_NOTHING_TO_ALLOCATE, ALLOCATION_CYCLE_INACTIVE.',
      inputSchema: periodoCiclo,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ cicloId, ...p }) =>
      ejecutar(() =>
        pedir<EjecucionRepartoDto>(
          `/control-analitico/ciclos/${cicloId}/ejecutar`,
          {
            method: 'POST',
            body: JSON.stringify(periodoRepartoSchema.parse(p)),
            headers: idem(),
          },
        ),
      ),
  );

  server.registerTool(
    'revertir_reparto',
    {
      title: 'Revertir una ejecución de reparto',
      description:
        'Admin o gerente. Solo la última vigente de la empresa (ALLOCATION_NOT_LATEST) y en ' +
        'periodo abierto. Lee la versión y envía If-Match.',
      inputSchema: {
        ejecucionId: z.string().uuid(),
        ...revertirRepartoSchema.shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ ejecucionId, ...body }) =>
      ejecutar(async () => {
        const actual = await pedir<EjecucionRepartoDto>(
          `/control-analitico/ejecuciones/${ejecucionId}`,
        );
        return pedir<EjecucionRepartoDto>(
          `/control-analitico/ejecuciones/${ejecucionId}/revertir`,
          {
            method: 'POST',
            body: JSON.stringify(revertirRepartoSchema.parse(body)),
            headers: { ...idem(), ...siVersion(actual.version) },
          },
        );
      }),
  );

  server.registerTool(
    'coste_completo_obras',
    {
      title: 'Coste completo por obra',
      description:
        'Coste directo del cuadro de márgenes más indirectos recibidos por repartos ' +
        'vigentes hasta la fecha, con desglose por centro emisor. Solo obras accesibles.',
      inputSchema: { hasta: fecha },
      annotations: { readOnlyHint: true },
    },
    async ({ hasta }) =>
      ejecutar(() =>
        pedir<CosteCompletoObraDto[]>(
          `/control-analitico/coste-obras${query({ hasta })}`,
        ).then((obras) => ({ obras })),
      ),
  );

  server.registerTool(
    'rolling_forecast',
    {
      title: 'Rolling forecast por escenario',
      description:
        'Previsión por obra y total a una fecha de corte: real + indirectos + coste ' +
        'pendiente del escenario (EAC), ingresos previstos, margen, desviación frente al ' +
        'presupuesto, serie mensual exacta, alertas (pérdida, sobrecoste, sin presupuesto, ' +
        'plazo vencido) y varianza frente a la última foto (o baselineId). Sin escenarioId ' +
        'devuelve los escenarios disponibles.',
      inputSchema: {
        escenarioId: z.string().uuid().optional(),
        fecha: fecha.optional(),
        projectId: z.string().uuid().optional(),
        horizonte: z.number().int().min(1).max(36).optional(),
        baselineId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ escenarioId, fecha: f, ...resto }) =>
      ejecutar(async () => {
        if (!escenarioId || !f) {
          return {
            escenarios: await pedir<EscenarioDto[]>(
              '/control-analitico/escenarios',
            ),
          };
        }
        return pedir<PrevisionDto>(
          `/control-analitico/forecast${query(previsionQuerySchema.parse({ escenarioId, fecha: f, ...resto }))}`,
        );
      }),
  );

  server.registerTool(
    'foto_forecast',
    {
      title: 'Guardar foto del forecast',
      description:
        'Admin, gerente o administración. Congela la previsión del escenario a la fecha: ' +
        'será la línea base de las varianzas siguientes.',
      inputSchema: fotoPrevisionCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<FotoPrevisionDto>('/control-analitico/fotos', {
          method: 'POST',
          body: JSON.stringify(fotoPrevisionCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );
}
