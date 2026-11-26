import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarBanca } from './banca';

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
  registrarBanca(server);
  return mapa;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const R = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('herramientas MCP de banca', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('remitir una remesa: If-Match con la versión leída, Idempotency-Key y cuerpo con la fecha', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: R, version: 2 }))
      .mockResolvedValueOnce(json({ id: R, estado: 'remitida', version: 3 }));
    const r = await herramientas().get('accion_remesa_sepa')!({
      id: R,
      accion: 'remitir',
      fecha: '2026-11-26',
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain(`/tesoreria/remesas/${R}/remitir`);
    const h = init.headers as Record<string, string>;
    expect(h['If-Match']).toBe('"2"');
    expect(h['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({ fecha: '2026-11-26' });
    expect(r.structuredContent).toMatchObject({ estado: 'remitida' });
  });

  it('datos SEPA no válidos: error con código y errores por campo', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: R, version: 1 }))
      .mockResolvedValueOnce(
        json(
          {
            status: 422,
            errorCode: 'SEPA_DATA_INVALID',
            detail: 'La remesa tiene 1 dato(s) no válidos',
            errors: [
              { field: 'REM-2026-0001-0002.iban', message: 'IBAN ausente' },
            ],
          },
          422,
        ),
      );
    const r = await herramientas().get('accion_remesa_sepa')!({
      id: R,
      accion: 'generar',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      status: 422,
      errorCode: 'SEPA_DATA_INVALID',
    });
  });

  it('conciliar con comisión y previsión de liquidez con structuredContent', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: M, version: 1 }))
      .mockResolvedValueOnce(
        json({
          id: M,
          reconciliationKind: 'vencimiento',
          feeAmount: 5,
          version: 2,
        }),
      )
      .mockResolvedValueOnce(
        json({ fuenteSaldo: 'contable', saldoInicial: 10000, horizontes: [] }),
      );
    const h = herramientas();
    const c = await h.get('conciliar_movimiento')!({
      movimientoId: M,
      tipo: 'vencimiento',
      id: C,
      comision: 5,
    });
    expect(
      JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)),
    ).toEqual({
      tipo: 'vencimiento',
      id: C,
      comision: 5,
    });
    expect(c.structuredContent).toMatchObject({ feeAmount: 5 });
    const l = await h.get('prevision_liquidez')!({
      desde: '2026-11-26',
      horizontes: '7,30',
    });
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      '/tesoreria/liquidez?desde=2026-11-26&horizontes=7%2C30',
    );
    expect(l.structuredContent).toMatchObject({ saldoInicial: 10000 });
  });
});
