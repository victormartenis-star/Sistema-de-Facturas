import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  miembroCreateSchema,
  miembroUpdateSchema,
  periodoConsolidacionSchema,
  sociedadCreateSchema,
  tipoCambioCreateSchema,
  tipoCambioUpdateSchema,
  type EstadosConsolidadosDto,
  type GrupoDto,
  type SociedadAccesibleDto,
  type SociedadDto,
  type TesoreriaGrupoDto,
  type TipoCambioDto,
} from '@erp/shared';
import { ErrorApi, pedir, query } from '../api';
import { ejecutar } from '../comun';

const idem = () => ({ 'Idempotency-Key': randomUUID() });

/** If-Match solo con versión entera positiva (nunca `"0"` ni `"undefined"`). */
const siVersion = (v: unknown): Record<string, string> =>
  typeof v === 'number' && Number.isInteger(v) && v > 0
    ? { 'If-Match': `"${v}"` }
    : {};

const noEncontrado = (codigo: string, mensaje: string) =>
  new ErrorApi(
    404,
    { status: 404, errorCode: codigo, detail: mensaje },
    mensaje,
  );

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

  /* ─────────────── Group Reporting (Fase 8): escritura ─────────────── */

  server.registerTool(
    'alta_sociedad_grupo',
    {
      title: 'Dar de alta una sociedad del grupo',
      description:
        'Solo admin. Crea una sociedad con NIF, moneda funcional (ISO 4217) y PGC base; ' +
        'concede permiso de consolidación a quien la crea y, opcionalmente, crea su ' +
        'primer admin (administrador) y la integra ya en un grupo (grupo: % de ' +
        'participación, método global/proporcional/puesta_equivalencia, fecha de alta y ' +
        'coste de la inversión para la eliminación inversión–PN). Errores: ' +
        'GROUP_COMPANY_NIF_DUPLICATE, USER_EMAIL_DUPLICATED, CONSOLIDATION_INVESTMENT_REQUIRED.',
      inputSchema: sociedadCreateSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<SociedadDto>('/holding/sociedades', {
          method: 'POST',
          body: JSON.stringify(sociedadCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'integrar_sociedad_grupo',
    {
      title: 'Integrar una sociedad existente en un grupo',
      description:
        'Admin o gerente. Exige permiso de consolidación sobre la sociedad ' +
        '(HOLDING_COMPANY_ACCESS_DENIED). Con costeInversion se elimina la inversión ' +
        'contra el patrimonio neto (fondo de comercio y socios externos); la puesta en ' +
        'equivalencia lo exige.',
      inputSchema: { grupoId: z.string().uuid(), ...miembroCreateSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ grupoId, ...body }) =>
      ejecutar(() =>
        pedir<GrupoDto>(`/holding/grupos/${grupoId}/miembros`, {
          method: 'POST',
          body: JSON.stringify(miembroCreateSchema.parse(body)),
          headers: idem(),
        }),
      ),
  );

  server.registerTool(
    'configurar_participacion',
    {
      title: 'Configurar participación e inversión de un miembro',
      description:
        'Admin o gerente. Cambia % de participación, método, baja, fecha de toma de ' +
        'control, coste y cuenta de la inversión o PN de adquisición (moneda funcional; ' +
        'null = del mayor). costeInversion=null desactiva la eliminación. Lee la versión ' +
        'del miembro y envía If-Match. La matriz no se modifica (HOLDING_PARENT_IMMUTABLE).',
      inputSchema: {
        grupoId: z.string().uuid(),
        companyId: z.string().uuid().describe('Sociedad miembro'),
        ...miembroUpdateSchema.innerType().shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ grupoId, companyId, ...cambios }) =>
      ejecutar(async () => {
        const g = await pedir<GrupoDto>(`/holding/grupos/${grupoId}`);
        const m = g.miembros.find(
          (x) => x.companyId === companyId && !x.fechaBaja,
        );
        if (!m) {
          throw noEncontrado(
            'HOLDING_MEMBER_NOT_FOUND',
            'La sociedad no es miembro activo del grupo',
          );
        }
        return pedir<GrupoDto>(`/holding/grupos/${grupoId}/miembros/${m.id}`, {
          method: 'PATCH',
          body: JSON.stringify(miembroUpdateSchema.parse(cambios)),
          headers: siVersion(m.version),
        });
      }),
  );

  server.registerTool(
    'tipos_cambio_grupo',
    {
      title: 'Tipos de cambio de consolidación',
      description:
        'Tipos del grupo por moneda: cierre (activo y pasivo), medio del periodo (PyG) ' +
        'e histórico (patrimonio neto), en unidades de la moneda de presentación por 1 ' +
        'de la moneda funcional.',
      inputSchema: { grupoId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ grupoId }) =>
      ejecutar(() =>
        pedir<TipoCambioDto[]>(`/holding/grupos/${grupoId}/tipos-cambio`).then(
          (tipos) => ({ tipos }),
        ),
      ),
  );

  server.registerTool(
    'registrar_tipo_cambio',
    {
      title: 'Registrar o corregir un tipo de cambio',
      description:
        'Admin o gerente. Si ya existe el mismo tipo, moneda y fechas, lo corrige con ' +
        'If-Match; si no, lo crea. Cierre e histórico: una fecha (desde); medio: desde–hasta. ' +
        'Errores: FX_SAME_CURRENCY, CONSOLIDATION_PERIOD_CLOSED.',
      inputSchema: {
        grupoId: z.string().uuid(),
        ...tipoCambioCreateSchema.innerType().shape,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ grupoId, ...body }) =>
      ejecutar(async () => {
        const d = tipoCambioCreateSchema.parse(body);
        const hasta = d.hasta ?? d.desde;
        const existente = (
          await pedir<TipoCambioDto[]>(
            `/holding/grupos/${grupoId}/tipos-cambio`,
          )
        ).find(
          (t) =>
            t.moneda === d.moneda &&
            t.tipo === d.tipo &&
            t.desde === d.desde &&
            t.hasta === hasta,
        );
        if (existente) {
          return pedir<TipoCambioDto>(
            `/holding/grupos/${grupoId}/tipos-cambio/${existente.id}`,
            {
              method: 'PATCH',
              body: JSON.stringify(
                tipoCambioUpdateSchema.parse({ tasa: d.tasa }),
              ),
              headers: siVersion(existente.version),
            },
          );
        }
        return pedir<TipoCambioDto>(`/holding/grupos/${grupoId}/tipos-cambio`, {
          method: 'POST',
          body: JSON.stringify(d),
          headers: idem(),
        });
      }),
  );

  server.registerTool(
    'group_reporting_detalle',
    {
      title: 'Detalle de Group Reporting del consolidado',
      description:
        'Del consolidado del periodo: conversión de moneda por sociedad (tipos y ' +
        'diferencia de conversión CTA), eliminación inversión–patrimonio neto con fondo ' +
        'de comercio, diferencia negativa, socios externos y puesta en equivalencia, con ' +
        'los asientos de consolidación generados. FX_RATE_MISSING lista los tipos que faltan.',
      inputSchema: periodo,
      annotations: { readOnlyHint: true },
    },
    async ({ grupoId, ...p }) =>
      ejecutar(async () => {
        const e = await pedir<EstadosConsolidadosDto>(
          `/holding/grupos/${grupoId}/estados${query(periodoConsolidacionSchema.parse(p))}`,
        );
        return {
          grupoId: e.grupoId,
          desde: e.desde,
          hasta: e.hasta,
          cerrado: e.cerrado,
          monedaPresentacion: e.monedaPresentacion ?? null,
          diferenciaConversion: e.diferenciaConversion ?? 0,
          conversion: e.conversion ?? [],
          fondoComercio: e.fondoComercio ?? 0,
          diferenciaNegativa: e.diferenciaNegativa ?? 0,
          inversionPatrimonio: e.inversionPatrimonio ?? [],
          sociosExternos: e.sociosExternos,
          resultadoAtribuidoDominante: e.resultadoAtribuidoDominante,
          descuadreBalance: e.totales.descuadreBalance,
        };
      }),
  );
}
