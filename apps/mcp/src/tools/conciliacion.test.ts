import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarCierre } from './cierre';

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
  registrarCierre(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('herramientas MCP de devengo automático y conciliación de cierre', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('devengo automático con hasta e Idempotency-Key; ejecuciones en items', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          desde: '2026-08',
          hasta: '2026-09',
          contabilizados: 2,
          importe: 78.09,
          periodos: [],
        }),
      )
      .mockResolvedValueOnce(
        json([{ periodo: '2026-09', disparo: 'automatico' }]),
      );
    const h = herramientas();
    const r = await h.get('devengo_automatico_avales')!({ hasta: '2026-09' });
    expect(r.structuredContent).toMatchObject({
      contabilizados: 2,
      importe: 78.09,
    });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/avales\/devengos\/automatico$/,
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ hasta: '2026-09' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    const e = await h.get('ejecuciones_devengo_avales')!({});
    expect(e.structuredContent).toEqual({
      items: [{ periodo: '2026-09', disparo: 'automatico' }],
    });
  });

  it('conciliación en vivo y registro; período abierto llega con código', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ id: null, cuadra: false, descuadres: 1, partidas: [] }),
      )
      .mockResolvedValueOnce(
        json({ id: 'c1', cuadra: false, descuadres: 1, partidas: [] }),
      )
      .mockResolvedValueOnce(
        json(
          {
            status: 422,
            title: 'El mes del devengo aún no ha terminado',
            errorCode: 'BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN',
          },
          422,
        ),
      );
    const h = herramientas();
    const vivo = await h.get('conciliacion_cierre')!({});
    expect(vivo.structuredContent).toMatchObject({ id: null, descuadres: 1 });
    const reg = await h.get('registrar_conciliacion_cierre')!({});
    expect(reg.structuredContent).toMatchObject({ id: 'c1' });
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
    const abierto = await h.get('devengo_automatico_avales')!({
      hasta: '2026-11',
    });
    expect(abierto.isError).toBe(true);
    expect(abierto.structuredContent).toMatchObject({
      errorCode: 'BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN',
    });
  });
});
