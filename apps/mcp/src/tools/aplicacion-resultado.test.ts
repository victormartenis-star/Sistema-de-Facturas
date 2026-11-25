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

const AVAL = '44444444-4444-4444-8444-444444444444';
const cabeceras = (m: ReturnType<typeof vi.fn>, i: number) =>
  (m.mock.calls[i][1] as RequestInit).headers as Record<string, string>;

describe('herramientas MCP de aplicación del resultado, cuentas anuales y devengos', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cuentas anuales y aplicar el resultado con Idempotency-Key', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ ejercicio: 2025, balance: { cuadra: true } }),
      )
      .mockResolvedValueOnce(
        json({ ejercicio: 2025, estado: 'aplicado', version: 1 }),
      );
    const h = herramientas();
    const ca = await h.get('cuentas_anuales')!({ ejercicio: 2025 });
    expect(ca.structuredContent).toMatchObject({ balance: { cuadra: true } });
    const ap = await h.get('aplicar_resultado')!({
      ejercicio: 2025,
      fecha: '2026-06-30',
      acuerdo: 'Junta general',
      reparto: [{ cuenta: '1120', importe: 100 }],
    });
    expect(ap.structuredContent).toMatchObject({ estado: 'aplicado' });
    expect(String(fetchMock.mock.calls[1][0])).toMatch(
      /\/contabilidad\/ejercicios\/2025\/aplicar-resultado$/,
    );
    expect(cabeceras(fetchMock, 1)['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it('anular la aplicación: If-Match solo con versión positiva', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ aplicacionVigente: { version: 2 } }))
      .mockResolvedValueOnce(json({ estado: 'anulado' }))
      .mockResolvedValueOnce(json({ aplicacionVigente: null }))
      .mockResolvedValueOnce(
        json(
          {
            status: 404,
            title: 'Aplicación del resultado no encontrada',
            errorCode: 'RESULT_APPLICATION_NOT_FOUND',
          },
          404,
        ),
      );
    const h = herramientas();
    const r = await h.get('anular_aplicacion_resultado')!({
      ejercicio: 2025,
      motivo: 'Acuerdo rectificado',
    });
    expect(r.structuredContent).toMatchObject({ estado: 'anulado' });
    expect(cabeceras(fetchMock, 1)['If-Match']).toBe('"2"');
    const sin = await h.get('anular_aplicacion_resultado')!({
      ejercicio: 2025,
      motivo: 'Otra vez',
    });
    expect(cabeceras(fetchMock, 3)['If-Match']).toBeUndefined();
    expect(sin.isError).toBe(true);
    expect(sin.structuredContent).toMatchObject({
      errorCode: 'RESULT_APPLICATION_NOT_FOUND',
    });
  });

  it('devengos: listado en items y devengar un mes', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ avalId: AVAL, importe: 63.7 }]))
      .mockResolvedValueOnce(
        json({
          periodo: '2026-01',
          contabilizados: 1,
          importe: 63.7,
          omitidos: [],
        }),
      );
    const h = herramientas();
    const l = await h.get('devengos_avales')!({ periodo: '2026-01' });
    expect(l.structuredContent).toEqual({
      items: [{ avalId: AVAL, importe: 63.7 }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/avales/devengos?periodo=2026-01',
    );
    const d = await h.get('devengar_comisiones_avales')!({
      periodo: '2026-01',
    });
    expect(d.structuredContent).toMatchObject({ contabilizados: 1 });
    expect(
      JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)),
    ).toEqual({
      periodo: '2026-01',
    });
  });
});
