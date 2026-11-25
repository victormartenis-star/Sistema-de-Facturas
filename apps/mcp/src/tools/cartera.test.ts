import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarCartera } from './cartera';

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
  registrarCartera(server);
  return mapa;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const ANT = '66666666-6666-4666-8666-666666666666';
const CLI = '77777777-7777-4777-8777-777777777777';

describe('herramientas MCP de cartera y lotes', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('antigüedad: query con tipo y fecha, structuredContent completo', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        tipo: 'clientes',
        fecha: '2026-10-31',
        terceros: [],
        totales: { total: 0 },
      }),
    );
    const r = await herramientas().get('antiguedad_saldos')!({
      tipo: 'clientes',
      fecha: '2026-10-31',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/cartera/antiguedad?tipo=clientes&fecha=2026-10-31',
    );
    expect(r.structuredContent).toMatchObject({
      tipo: 'clientes',
      totales: { total: 0 },
    });
  });

  it('partidas solo vencidas y lotes con existencias: booleanos a query', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ partidas: [] }))
      .mockResolvedValueOnce(json([]));
    const h = herramientas();
    await h.get('partidas_abiertas')!({
      tipo: 'proveedores',
      soloVencidas: true,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/cartera/partidas?tipo=proveedores&soloVencidas=true',
    );
    const l = await h.get('lotes_almacen')!({ conStock: true, q: 'L1' });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/almacen/lotes?q=L1&conStock=true',
    );
    expect(l.structuredContent).toEqual({ items: [] });
  });

  it('aplicar anticipo: lee la versión, envía If-Match e Idempotency-Key', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: ANT, version: 2 }))
      .mockResolvedValueOnce(json({ id: ANT, version: 3, aplicado: 300 }));
    const r = await herramientas().get('aplicar_anticipo')!({
      id: ANT,
      fecha: '2026-10-20',
    });
    expect(r.structuredContent).toMatchObject({ aplicado: 300 });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('"2"');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({ fecha: '2026-10-20' });
  });

  it('compensar: error RFC 7807 con código en structuredContent', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 422,
          errorCode: 'AR_AP_ITEM_NOT_OPEN',
          detail:
            'El tercero no tiene a la vez partidas a cobrar y a pagar abiertas',
        },
        422,
      ),
    );
    const r = await herramientas().get('compensar_tercero')!({
      contactId: CLI,
      fecha: '2026-10-25',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      status: 422,
      errorCode: 'AR_AP_ITEM_NOT_OPEN',
    });
  });
});
