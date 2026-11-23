import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarAlmacen } from './almacen';

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
  registrarAlmacen(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'Content-Type':
        estado >= 400 ? 'application/problem+json' : 'application/json',
    },
  });
}

const ALM = '11111111-1111-4111-8111-111111111111';
const ALM2 = '22222222-2222-4222-8222-222222222222';
const ART = '33333333-3333-4333-8333-333333333333';
const OBRA = '44444444-4444-4444-8444-444444444444';

describe('herramientas MCP de almacén', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('imputar consumo: POST con Idempotency-Key y lista en structuredContent.items', async () => {
    fetchMock.mockResolvedValueOnce(
      json([{ id: 'm1', tipo: 'salida_obra', valor: -40 }], 201),
    );
    const r = await herramientas().get('imputar_consumo_obra')!({
      almacenId: ALM,
      projectId: OBRA,
      fecha: '2026-11-23',
      lineas: [{ articuloId: ART, cantidad: 4 }],
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({
      items: [{ id: 'm1', tipo: 'salida_obra', valor: -40 }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/almacen/consumos')).toBe(true);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stock insuficiente: isError con errorCode y disponible estructurados', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 409,
          errorCode: 'INSUFFICIENT_STOCK',
          detail: 'Stock insuficiente: disponible 2.000, solicitado 5.000',
          disponible: 2,
        },
        409,
      ),
    );
    const r = await herramientas().get('imputar_consumo_obra')!({
      almacenId: ALM,
      projectId: OBRA,
      fecha: '2026-11-23',
      lineas: [{ articuloId: ART, cantidad: 5 }],
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'INSUFFICIENT_STOCK',
    });
    expect(r.content[0].text).toContain('INSUFFICIENT_STOCK');
  });

  it('traspaso: lee la versión del saldo de origen y envía If-Match', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 's1', version: 7 }]))
      .mockResolvedValueOnce(json({ id: 'm2', tipo: 'traspaso' }, 201));
    const r = await herramientas().get('traspasar_stock')!({
      origenId: ALM,
      destinoId: ALM2,
      articuloId: ART,
      cantidad: 10,
      fecha: '2026-11-23',
    });
    expect(r.isError).toBeFalsy();
    const [urlLectura] = fetchMock.mock.calls[0];
    expect(String(urlLectura)).toContain(`almacenId=${ALM}`);
    const [, init] = fetchMock.mock.calls[1];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('"7"');
  });

  it('traspaso sin existencias en origen: no llama a la API de escritura', async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    const r = await herramientas().get('traspasar_stock')!({
      origenId: ALM,
      destinoId: ALM2,
      articuloId: ART,
      cantidad: 1,
      fecha: '2026-11-23',
    });
    expect(r.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
