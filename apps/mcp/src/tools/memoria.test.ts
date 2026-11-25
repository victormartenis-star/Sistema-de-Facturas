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

const AVAL = '55555555-5555-4555-8555-555555555555';

describe('herramientas MCP de exportación, conciliación a fecha y cambio de tasa', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('exportar: JSON como objeto y CSV como texto, con la huella', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ejercicio: 2025, memoria: { coherente: true } }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Content-SHA256': 'a'.repeat(64),
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response('\uFEFFseccion;partida;concepto;importe\r\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'X-Content-SHA256': 'b'.repeat(64),
          },
        }),
      );
    const h = herramientas();
    const j = await h.get('exportar_cuentas_anuales')!({ ejercicio: 2025 });
    expect(j.structuredContent).toMatchObject({
      contenido: { ejercicio: 2025, memoria: { coherente: true } },
      sha256: 'a'.repeat(64),
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/contabilidad/ejercicios/2025/cuentas-anuales/exportar?formato=json',
    );
    const c = await h.get('exportar_cuentas_anuales')!({
      ejercicio: 2025,
      formato: 'csv',
    });
    expect(c.structuredContent).toMatchObject({
      contenido: 'seccion;partida;concepto;importe\r\n',
      sha256: 'b'.repeat(64),
    });
  });

  it('conciliación a fecha (query) y registro con fecha (cuerpo)', async () => {
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock
      .mockResolvedValueOnce(
        json({ id: null, fecha: '2026-03-10', partidas: [] }),
      )
      .mockResolvedValueOnce(
        json({ id: 'c1', fecha: '2026-03-10', partidas: [] }),
      );
    const h = herramientas();
    await h.get('conciliacion_cierre')!({ fecha: '2026-03-10' });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/contabilidad/conciliacion?fecha=2026-03-10',
    );
    await h.get('registrar_conciliacion_cierre')!({ fecha: '2026-03-10' });
    expect(
      JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)),
    ).toEqual({
      fecha: '2026-03-10',
    });
  });

  it('cambiar la tasa: lee la versión y envía PATCH con If-Match', async () => {
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock
      .mockResolvedValueOnce(json({ id: AVAL, version: 3 }))
      .mockResolvedValueOnce(json({ id: AVAL, version: 4, tasas: [] }));
    const r = await herramientas().get('cambiar_tasa_aval')!({
      id: AVAL,
      tasaComisionAnualPct: 1.25,
      tasaVigenteDesde: '2026-03-21',
    });
    expect(r.structuredContent).toMatchObject({ version: 4 });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"3"');
    expect(JSON.parse(String(init.body))).toEqual({
      tasaComisionAnualPct: 1.25,
      tasaVigenteDesde: '2026-03-21',
    });
  });
});
