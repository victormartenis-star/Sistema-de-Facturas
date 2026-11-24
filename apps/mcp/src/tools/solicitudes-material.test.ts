import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarSolicitudesMaterial } from './solicitudes-material';

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
  registrarSolicitudesMaterial(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SOL = '77777777-7777-4777-8777-777777777777';
const LIN = '88888888-8888-4888-8888-888888888888';

describe('herramientas MCP de solicitudes de material', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('listar con faltante: query y lista en structuredContent.items', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: SOL, conFaltante: true }]));
    const r = await herramientas().get('solicitudes_material')!({
      conFaltante: true,
    });
    expect(r.structuredContent).toEqual({
      items: [{ id: SOL, conFaltante: true }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('conFaltante=true');
  });

  it('servir: lee la versión y envía If-Match e Idempotency-Key', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: SOL, version: 4 }))
      .mockResolvedValueOnce(
        json({ solicitud: { id: SOL, estado: 'servida' }, movimientos: [] }),
      );
    const r = await herramientas().get('servir_solicitud_material')!({
      id: SOL,
      fecha: '2026-03-10',
      lineas: [{ lineaId: LIN, cantidad: 2 }],
    });
    expect(r.structuredContent).toMatchObject({
      solicitud: { estado: 'servida' },
    });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    const h = init.headers as Record<string, string>;
    expect(h['If-Match']).toBe('"4"');
    expect(h['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({
      fecha: '2026-03-10',
      lineas: [{ lineaId: LIN, cantidad: 2 }],
    });
  });

  it('BUDGET_EXCEEDED del pedido del faltante llega estructurado', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 422,
          errorCode: 'BUDGET_EXCEEDED',
          detail: 'La obra supera su presupuesto',
          exceso: 10,
        },
        422,
      ),
    );
    const r = await herramientas().get('pedir_faltante_material')!({
      id: SOL,
      contactId: LIN,
      fecha: '2026-03-02',
      lineas: [{ lineaId: LIN, costeUnitario: 10 }],
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ errorCode: 'BUDGET_EXCEEDED' });
  });
});
