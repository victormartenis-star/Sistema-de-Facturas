import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarTesoreria } from './tesoreria';

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
  registrarTesoreria(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VTO = '33333333-3333-4333-8333-333333333333';

describe('herramientas MCP de tesorería: cobros y pagos parciales', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('registrar cobro: lee la versión, envía If-Match e Idempotency-Key y el cuerpo sin id', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: VTO, version: 3 }))
      .mockResolvedValueOnce(
        json({ id: VTO, pendingAmount: 710, settlementState: 'parcial' }, 201),
      );
    const r = await herramientas().get('registrar_cobro_pago')!({
      id: VTO,
      importe: 500,
      fecha: '2026-11-22',
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ settlementState: 'parcial' });
    const [url, init] = fetchMock.mock.calls[1];
    expect(
      String(url).endsWith(`/treasury/milestones/${VTO}/liquidaciones`),
    ).toBe(true);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('"3"');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      importe: 500,
      fecha: '2026-11-22',
    });
  });

  it('un exceso de importe vuelve como error de dominio estructurado', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: VTO, version: 1 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 422,
            errorCode: 'SETTLEMENT_EXCEEDS_OUTSTANDING',
            detail: 'El importe supera el saldo pendiente',
            correlationId: 'abc',
          }),
          {
            status: 422,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        ),
      );
    const r = await herramientas().get('registrar_cobro_pago')!({
      id: VTO,
      importe: 99999,
      fecha: '2026-11-22',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe(
      'SETTLEMENT_EXCEEDS_OUTSTANDING',
    );
  });

  it('vencimientos admite filtrar por estado de liquidación', async () => {
    fetchMock.mockResolvedValue(json([]));
    const r = await herramientas().get('vencimientos')!({
      liquidacion: 'parcial',
    });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/liquidacion=parcial/);
    expect(r.structuredContent).toEqual({ items: [] });
  });
});
