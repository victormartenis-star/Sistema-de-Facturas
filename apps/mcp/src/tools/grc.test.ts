import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarGrc } from './grc';
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
  registrarGrc(server);
  registrarAprobaciones(server);
  return mapa;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const S = 'abababab-abab-4bab-8bab-abababababab';

describe('herramientas MCP de gobierno (GRC)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cambiar política: sin fila guardada no envía If-Match; con versión, sí', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json([{ conflicto: 'creador_aprueba', modo: 'auditar', version: 0 }]),
      )
      .mockResolvedValueOnce(
        json([
          { conflicto: 'creador_aprueba', modo: 'justificar', version: 1 },
        ]),
      )
      .mockResolvedValueOnce(
        json([
          { conflicto: 'creador_aprueba', modo: 'justificar', version: 1 },
        ]),
      )
      .mockResolvedValueOnce(
        json([{ conflicto: 'creador_aprueba', modo: 'bloquear', version: 2 }]),
      );
    const h = herramientas();
    await h.get('cambiar_politica_sod')!({
      conflicto: 'creador_aprueba',
      modo: 'justificar',
    });
    expect(
      (fetchMock.mock.calls[1][1] as RequestInit).headers,
    ).not.toHaveProperty('If-Match');
    const r = await h.get('cambiar_politica_sod')!({
      conflicto: 'creador_aprueba',
      modo: 'bloquear',
    });
    expect((fetchMock.mock.calls[3][1] as RequestInit).headers).toMatchObject({
      'If-Match': '"1"',
    });
    expect(r.structuredContent).toBeDefined();
  });

  it('decidir con justificación SoD y error con código', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: S, version: 3 }]))
      .mockResolvedValueOnce(
        json(
          {
            status: 422,
            errorCode: 'SOD_JUSTIFICATION_REQUIRED',
            detail: 'Indica una justificación',
          },
          422,
        ),
      );
    const r = await herramientas().get('decidir_aprobacion')!({
      id: S,
      decision: 'aprobar',
      justificacionSod: 'x',
    });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      justificacionSod: 'x',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'SOD_JUSTIFICATION_REQUIRED',
    });
  });

  it('bandeja dirigida y escalado devuelven structuredContent', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json([{ id: 'n1', type: 'aprobacion', dirigida: true, read: false }]),
      )
      .mockResolvedValueOnce(json([{ id: S, nivelActual: 1 }]));
    const h = herramientas();
    const n = await h.get('mis_notificaciones')!({ noLeidas: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/alerts/notifications?unread=true',
    );
    expect(n.structuredContent).toMatchObject({
      notificaciones: [{ dirigida: true }],
    });
    const e = await h.get('escalar_aprobaciones')!({});
    expect(e.structuredContent).toMatchObject({ escaladas: [{ id: S }] });
  });
});
