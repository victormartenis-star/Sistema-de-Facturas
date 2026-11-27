import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarHolding } from './holding';

type Resultado = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};
type Manejador = (args: Record<string, unknown>) => Promise<Resultado>;

function herramientas(): Map<string, Manejador> {
  const mapa = new Map<string, Manejador>();
  const server = {
    registerTool: (nombre: string, _cfg: unknown, fn: Manejador) =>
      mapa.set(nombre, fn),
  } as unknown as McpServer;
  registrarHolding(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const GRUPO = '66666666-6666-4666-8666-666666666666';

describe('herramientas MCP de consolidación', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('grupos: combina grupos y sociedades accesibles en structuredContent', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: GRUPO, nombre: 'Grupo' }]))
      .mockResolvedValueOnce(json([{ companyId: 'A', propia: true }]));
    const r = await herramientas().get('grupos_consolidacion')!({});
    expect(r.structuredContent).toEqual({
      grupos: [{ id: GRUPO, nombre: 'Grupo' }],
      sociedadesAccesibles: [{ companyId: 'A', propia: true }],
    });
  });

  it('estados: periodo en la query y objeto completo', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        grupoId: GRUPO,
        totales: { resultado: 0 },
        descuadreIntercompania: false,
      }),
    );
    const r = await herramientas().get('estados_consolidados')!({
      grupoId: GRUPO,
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
    expect(r.structuredContent).toMatchObject({
      descuadreIntercompania: false,
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`/holding/grupos/${GRUPO}/estados?`);
    expect(url).toContain('desde=2026-01-01');
  });

  it('periodo invertido: falla sin llamar a la API', async () => {
    const r = await herramientas().get('estados_consolidados')!({
      grupoId: GRUPO,
      desde: '2026-12-31',
      hasta: '2026-01-01',
    });
    expect(r.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const cabeceras = (i: number) =>
    (fetchMock.mock.calls[i][1] as RequestInit).headers as Record<
      string,
      string
    >;

  it('alta de sociedad: POST con Idempotency-Key y structuredContent completo', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          id: 'S1',
          nombre: 'Dintel USA Inc',
          monedaFuncional: 'USD',
          miembroId: 'M1',
          administrador: null,
        },
        201,
      ),
    );
    const r = await herramientas().get('alta_sociedad_grupo')!({
      nombre: 'Dintel USA Inc',
      nif: 'us-1234567',
      monedaFuncional: 'usd',
    });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({
      id: 'S1',
      monedaFuncional: 'USD',
      miembroId: 'M1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/holding/sociedades');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      nif: 'US-1234567',
      monedaFuncional: 'USD',
      inicializarPlan: true,
    });
    expect(cabeceras(0)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('registrar tipo: crea si no existe y corrige con If-Match si existe', async () => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 'T1', tasa: 0.9, version: 1 }, 201));
    const crear = await herramientas().get('registrar_tipo_cambio')!({
      grupoId: GRUPO,
      moneda: 'USD',
      tipo: 'cierre',
      desde: '2026-12-31',
      tasa: 0.9,
    });
    expect(crear.structuredContent).toMatchObject({ id: 'T1', version: 1 });
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
    expect(cabeceras(1)['If-Match']).toBeUndefined();

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        json([
          {
            id: 'T1',
            moneda: 'USD',
            tipo: 'cierre',
            desde: '2026-12-31',
            hasta: '2026-12-31',
            tasa: 0.9,
            version: 3,
          },
        ]),
      )
      .mockResolvedValueOnce(json({ id: 'T1', tasa: 0.92, version: 4 }));
    const corregir = await herramientas().get('registrar_tipo_cambio')!({
      grupoId: GRUPO,
      moneda: 'USD',
      tipo: 'cierre',
      desde: '2026-12-31',
      tasa: 0.92,
    });
    expect(corregir.structuredContent).toMatchObject({ version: 4 });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain(`/holding/grupos/${GRUPO}/tipos-cambio/T1`);
    expect(init.method).toBe('PATCH');
    expect(cabeceras(1)['If-Match']).toBe('"3"');
    expect(JSON.parse(String(init.body))).toEqual({ tasa: 0.92 });
  });

  it('tipo medio sin periodo: falla sin llamar a la API', async () => {
    const r = await herramientas().get('registrar_tipo_cambio')!({
      grupoId: GRUPO,
      moneda: 'USD',
      tipo: 'medio',
      desde: '2026-01-01',
      tasa: 0.95,
    });
    expect(r.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('configurar participación: busca el miembro activo y envía su versión', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          id: GRUPO,
          miembros: [
            { id: 'M0', companyId: 'B', fechaBaja: '2025-12-31', version: 9 },
            { id: 'M1', companyId: 'B', fechaBaja: null, version: 2 },
          ],
        }),
      )
      .mockResolvedValueOnce(json({ id: GRUPO, miembros: [] }));
    await herramientas().get('configurar_participacion')!({
      grupoId: GRUPO,
      companyId: 'B',
      costeInversion: 900,
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain(`/miembros/M1`);
    expect(init.method).toBe('PATCH');
    expect(cabeceras(1)['If-Match']).toBe('"2"');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json({ id: GRUPO, miembros: [] }));
    const nada = await herramientas().get('configurar_participacion')!({
      grupoId: GRUPO,
      companyId: 'B',
      costeInversion: 900,
    });
    expect(nada.isError).toBe(true);
    expect(nada.structuredContent).toMatchObject({
      errorCode: 'HOLDING_MEMBER_NOT_FOUND',
    });
  });

  it('detalle de Group Reporting: tolera snapshots sin campos nuevos', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        grupoId: GRUPO,
        desde: '2025-01-01',
        hasta: '2025-12-31',
        cerrado: true,
        totales: { descuadreBalance: 0 },
        sociosExternos: { patrimonio: 0, resultado: 0, porSociedad: [] },
        resultadoAtribuidoDominante: 10,
      }),
    );
    const r = await herramientas().get('group_reporting_detalle')!({
      grupoId: GRUPO,
      desde: '2025-01-01',
      hasta: '2025-12-31',
    });
    expect(r.structuredContent).toMatchObject({
      cerrado: true,
      diferenciaConversion: 0,
      conversion: [],
      inversionPatrimonio: [],
      fondoComercio: 0,
      descuadreBalance: 0,
    });
  });

  it('FX_RATE_MISSING llega estructurado', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 422,
          errorCode: 'FX_RATE_MISSING',
          detail:
            'Faltan tipos de cambio de consolidación: USD cierre (2026-12-31)',
        },
        422,
      ),
    );
    const r = await herramientas().get('group_reporting_detalle')!({
      grupoId: GRUPO,
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ errorCode: 'FX_RATE_MISSING' });
  });

  it('HOLDING_COMPANY_ACCESS_DENIED llega estructurado', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 403,
          errorCode: 'HOLDING_COMPANY_ACCESS_DENIED',
          detail: 'Sin permiso de consolidación',
          sociedades: ['B'],
        },
        403,
      ),
    );
    const r = await herramientas().get('tesoreria_grupo')!({
      grupoId: GRUPO,
      hasta: '2026-12-31',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'HOLDING_COMPANY_ACCESS_DENIED',
    });
  });
});
