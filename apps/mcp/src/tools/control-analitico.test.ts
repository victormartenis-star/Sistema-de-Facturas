import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarControlAnalitico } from './control-analitico';

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
  registrarControlAnalitico(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CICLO = '77777777-7777-4777-8777-777777777777';
const RUN = '88888888-8888-4888-8888-888888888888';
const ESC = '99999999-9999-4999-8999-999999999999';

describe('herramientas MCP de control analítico', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const cabeceras = (i: number) =>
    (fetchMock.mock.calls[i][1] as RequestInit).headers as Record<
      string,
      string
    >;

  it('centros con saldos del periodo en structuredContent', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 'C', codigo: 'ADM' }]))
      .mockResolvedValueOnce(json([{ centroId: 'C', saldo: 1200 }]));
    const r = await herramientas().get('centros_coste')!({
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
    expect(r.structuredContent).toEqual({
      centros: [{ id: 'C', codigo: 'ADM' }],
      saldos: [{ centroId: 'C', saldo: 1200 }],
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('desde=2026-01-01');
  });

  it('ejecutar reparto: POST con Idempotency-Key; periodo invertido no llama', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ id: RUN, total: 1200, version: 1 }, 201),
    );
    const r = await herramientas().get('ejecutar_reparto')!({
      cicloId: CICLO,
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
    expect(r.structuredContent).toMatchObject({ id: RUN, total: 1200 });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `/ciclos/${CICLO}/ejecutar`,
    );
    expect(cabeceras(0)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    fetchMock.mockReset();
    const mal = await herramientas().get('ejecutar_reparto')!({
      cicloId: CICLO,
      desde: '2026-12-31',
      hasta: '2026-01-01',
    });
    expect(mal.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('revertir: lee la versión y envía If-Match; errores con código', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: RUN, version: 3 }))
      .mockResolvedValueOnce(
        json(
          {
            status: 409,
            errorCode: 'ALLOCATION_NOT_LATEST',
            detail: 'Revierte antes la nº 4',
          },
          409,
        ),
      );
    const r = await herramientas().get('revertir_reparto')!({
      ejecucionId: RUN,
      motivo: 'Pesos mal',
    });
    expect(cabeceras(1)['If-Match']).toBe('"3"');
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'ALLOCATION_NOT_LATEST',
    });
  });

  it('rolling forecast: sin escenario lista escenarios; con él, la previsión', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: ESC, codigo: 'BASE' }]));
    const lista = await herramientas().get('rolling_forecast')!({});
    expect(lista.structuredContent).toEqual({
      escenarios: [{ id: ESC, codigo: 'BASE' }],
    });
    fetchMock.mockResolvedValueOnce(
      json({ totales: { margen: 19000 }, obras: [] }),
    );
    const r = await herramientas().get('rolling_forecast')!({
      escenarioId: ESC,
      fecha: '2026-06-30',
    });
    expect(r.structuredContent).toMatchObject({ totales: { margen: 19000 } });
    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain(`escenarioId=${ESC}`);
    expect(url).toContain('horizonte=12');
  });

  it('coste completo envuelve la lista en { obras }', async () => {
    fetchMock.mockResolvedValueOnce(
      json([{ projectId: 'P', costeCompleto: 10 }]),
    );
    const r = await herramientas().get('coste_completo_obras')!({
      hasta: '2026-12-31',
    });
    expect(r.structuredContent).toEqual({
      obras: [{ projectId: 'P', costeCompleto: 10 }],
    });
  });
});
