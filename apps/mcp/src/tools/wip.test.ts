import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarWip } from './wip';

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
  registrarWip(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OBRA = '99999999-9999-4999-8999-999999999999';

describe('herramientas MCP de obra en curso', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('calcular: periodo en la query y lista en structuredContent.items', async () => {
    fetchMock.mockResolvedValueOnce(json([{ projectId: OBRA, wip: 5000 }]));
    const r = await herramientas().get('calcular_obra_en_curso')!({
      periodo: '2026-01',
    });
    expect(r.structuredContent).toEqual({
      items: [{ projectId: OBRA, wip: 5000 }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/wip/propuesta?periodo=2026-01',
    );
  });

  it('contabilizar: con obra va a /wip; sin obra, al cierre del periodo', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'w1', regularizacion: 5000 }, 201))
      .mockResolvedValueOnce(json({ contabilizados: 2, omitidos: [] }));
    const h = herramientas();
    await h.get('contabilizar_obra_en_curso')!({
      periodo: '2026-01',
      projectId: OBRA,
    });
    const r = await h.get('contabilizar_obra_en_curso')!({
      periodo: '2026-01',
    });
    expect(r.structuredContent).toMatchObject({ contabilizados: 2 });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/wip$/);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/wip\/cierre$/);
    const h0 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(h0['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('FISCAL_PERIOD_CLOSED llega estructurado', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 409,
          errorCode: 'FISCAL_PERIOD_CLOSED',
          detail: 'El período 04/2026 está cerrado',
        },
        409,
      ),
    );
    const r = await herramientas().get('contabilizar_obra_en_curso')!({
      periodo: '2026-04',
      projectId: OBRA,
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'FISCAL_PERIOD_CLOSED',
    });
  });
});
