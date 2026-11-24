import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarAprobaciones } from './aprobaciones';

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
  registrarAprobaciones(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SOL = '55555555-5555-4555-8555-555555555555';

describe('herramientas MCP de aprobaciones', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pendientes para mí: lista en structuredContent.items', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: SOL, puedoDecidir: true }]));
    const r = await herramientas().get('aprobaciones_pendientes')!({
      paraMi: true,
    });
    expect(r.structuredContent).toEqual({
      items: [{ id: SOL, puedoDecidir: true }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('paraMi=true');
  });

  it('rechazar: lee la versión, envía If-Match e Idempotency-Key y el motivo', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: SOL, version: 2 }]))
      .mockResolvedValueOnce(json({ id: SOL, estado: 'rechazada' }));
    const r = await herramientas().get('decidir_aprobacion')!({
      id: SOL,
      decision: 'rechazar',
      motivo: 'Precio fuera de mercado',
    });
    expect(r.isError).toBeFalsy();
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain(`/aprobaciones/solicitudes/${SOL}/rechazar`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('"2"');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      motivo: 'Precio fuera de mercado',
    });
  });

  it('rechazar sin motivo falla antes de llamar a la API de escritura', async () => {
    const r = await herramientas().get('decidir_aprobacion')!({
      id: SOL,
      decision: 'rechazar',
    });
    expect(r.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SELF_APPROVAL_FORBIDDEN llega estructurado', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: SOL, version: 1 }]))
      .mockResolvedValueOnce(
        json(
          {
            status: 403,
            errorCode: 'SELF_APPROVAL_FORBIDDEN',
            detail: 'Quien solicita la aprobación no puede decidirla',
          },
          403,
        ),
      );
    const r = await herramientas().get('decidir_aprobacion')!({
      id: SOL,
      decision: 'aprobar',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'SELF_APPROVAL_FORBIDDEN',
    });
  });
});
