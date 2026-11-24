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
