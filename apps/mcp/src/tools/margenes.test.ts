import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarMargenes } from './margenes';

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
  registrarMargenes(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OBRA = '44444444-4444-4444-8444-444444444444';

describe('herramientas MCP de márgenes y control presupuestario', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cuadro_margenes: filtros en la query y objeto en structuredContent', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ obras: [], totales: { consumido: 0 }, desde: '2026-01-01' }),
    );
    const r = await herramientas().get('cuadro_margenes')!({
      desde: '2026-01-01',
      soloAlertas: true,
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      obras: [],
      desde: '2026-01-01',
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/cost-control/margenes?');
    expect(url).toContain('desde=2026-01-01');
    expect(url).toContain('soloAlertas=true');
  });

  it('configurar: con versión previa envía If-Match', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ config: { version: 3 } }))
      .mockResolvedValueOnce(json({ config: { version: 4, modo: 'bloqueo' } }));
    const r = await herramientas().get('configurar_control_presupuestario')!({
      projectId: OBRA,
      modo: 'bloqueo',
      toleranciaPct: 5,
      umbralAvisoPct: 90,
    });
    expect(r.isError).toBeFalsy();
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"3"');
    expect(JSON.parse(String(init.body))).toEqual({
      modo: 'bloqueo',
      toleranciaPct: 5,
      umbralAvisoPct: 90,
    });
  });

  it('configurar: sin configuración previa (versión 0) no envía If-Match', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ config: { version: 0 } }))
      .mockResolvedValueOnce(json({ config: { version: 1 } }));
    await herramientas().get('configurar_control_presupuestario')!({
      projectId: OBRA,
      modo: 'aviso',
      toleranciaPct: 0,
      umbralAvisoPct: 90,
    });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['If-Match']).toBeUndefined();
  });

  it('un rechazo RFC 7807 de la API llega estructurado al agente', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 403,
          errorCode: 'PERMISSION_DENIED',
          detail: 'No tienes permiso',
        },
        403,
      ),
    );
    const r = await herramientas().get('control_presupuestario')!({
      projectId: OBRA,
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'PERMISSION_DENIED',
    });
  });
});
