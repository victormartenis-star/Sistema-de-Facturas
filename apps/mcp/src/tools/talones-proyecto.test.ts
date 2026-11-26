import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarTalonesProyecto } from './talones-proyecto';

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
  registrarTalonesProyecto(server);
  return mapa;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const T = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('herramientas MCP de talones y Project System', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('acción sobre un talón: If-Match con la versión leída; transición inválida con código', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: T, version: 3 }))
      .mockResolvedValueOnce(
        json(
          {
            status: 409,
            errorCode: 'CHECK_INVALID_TRANSITION',
            detail: 'Un talón anulado no puede pasar a cobrado',
          },
          409,
        ),
      );
    const r = await herramientas().get('accion_talon')!({
      id: T,
      accion: 'cobrar',
      fecha: '2026-11-25',
    });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"3"');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      status: 409,
      errorCode: 'CHECK_INVALID_TRANSITION',
    });
  });

  it('emitir talón y listar retenciones devuelven structuredContent', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ id: T, numero: 'TAL0000001', estado: 'emitido' }),
      )
      .mockResolvedValueOnce(
        json({
          projectId: P,
          resumen: { pago: { sustituidoAval: 1250 } },
          retenciones: [],
        }),
      );
    const h = herramientas();
    const e = await h.get('emitir_talon')!({
      direccion: 'emitido',
      vencimientoId: V,
      importe: 1210,
      fechaEmision: '2026-11-20',
      talonarioId: T,
    });
    expect(e.structuredContent).toMatchObject({ numero: 'TAL0000001' });
    const r = await h.get('retenciones_obra')!({
      projectId: P,
      fecha: '2026-11-26',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `/project-system/obras/${P}/retenciones?fecha=2026-11-26`,
    );
    expect(r.structuredContent).toMatchObject({
      resumen: { pago: { sustituidoAval: 1250 } },
    });
  });

  it('sustituir retención por aval: cuerpo validado y error de aval insuficiente', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 422,
          errorCode: 'PS_GUARANTEE_INSUFFICIENT',
          detail: 'El aval cubre 1000',
        },
        422,
      ),
    );
    const r = await herramientas().get('liberar_retenciones')!({
      projectId: P,
      tipo: 'aval',
      fecha: '2026-11-25',
      vencimientoIds: [V],
      avalId: T,
      motivo: 'Sustitución por aval',
    });
    expect(
      JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)),
    ).toMatchObject({ tipo: 'aval', avalId: T });
    expect(r.structuredContent).toMatchObject({
      errorCode: 'PS_GUARANTEE_INSUFFICIENT',
    });
  });
});
