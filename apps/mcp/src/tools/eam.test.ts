import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarEam } from './eam';

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
  registrarEam(server);
  return mapa;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const O = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('herramientas MCP de EAM', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cerrar una orden: If-Match con la versión leída, Idempotency-Key y costes', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: O, version: 4 }))
      .mockResolvedValueOnce(
        json({ id: O, estado: 'cerrada', costeTotal: 267.93 }),
      );
    const r = await herramientas().get('accion_orden_trabajo')!({
      id: O,
      accion: 'cerrar',
      fecha: '2026-10-11',
      horasParada: 16,
      horasManoObra: 3.5,
      tarifaManoObra: 42.15,
      costeRepuestos: 120.4,
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain(`/eam/ordenes/${O}/acciones`);
    const h = init.headers as Record<string, string>;
    expect(h['If-Match']).toBe('"4"');
    expect(h['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toMatchObject({
      accion: 'cerrar',
      horasParada: 16,
    });
    expect(r.structuredContent).toMatchObject({
      estado: 'cerrada',
      costeTotal: 267.93,
    });
  });

  it('lectura que retrocede: error con código', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: E, version: 2 }))
      .mockResolvedValueOnce(
        json(
          {
            status: 422,
            errorCode: 'EAM_COUNTER_BACKWARDS',
            detail: 'El contador no puede retroceder',
          },
          422,
        ),
      );
    const r = await herramientas().get('lectura_contador')!({
      id: E,
      tipo: 'horas',
      fecha: '2026-10-04',
      valor: 900,
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'EAM_COUNTER_BACKWARDS',
    });
  });

  it('explotación con structuredContent y query', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        desde: '2026-10-01',
        hasta: '2026-10-31',
        equipos: [{ equipoId: E, disponibilidadPct: 91.94 }],
        obras: [],
      }),
    );
    const r = await herramientas().get('explotacion_maquinaria')!({
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/eam/explotacion?desde=2026-10-01&hasta=2026-10-31',
    );
    expect(r.structuredContent).toMatchObject({
      equipos: [{ disponibilidadPct: 91.94 }],
    });
  });
});
