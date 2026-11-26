import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarCompras } from './compras';

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
  registrarCompras(server);
  return mapa;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const SC = '88888888-8888-4888-8888-888888888888';
const PO = '99999999-9999-4999-8999-999999999999';
const LN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('herramientas MCP de compras (P2P)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('aprobar una solicitud: lee la versión y envía If-Match; SoD con código', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: SC, version: 2 }))
      .mockResolvedValueOnce(
        json(
          {
            status: 403,
            errorCode: 'P2P_SOD_SELF_APPROVAL',
            detail: 'Quien solicita la compra no puede aprobarla',
          },
          403,
        ),
      );
    const r = await herramientas().get('decidir_solicitud_compra')!({
      id: SC,
      accion: 'aprobar',
    });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(String(fetchMock.mock.calls[1][0])).toMatch(
      /\/compras\/solicitudes\/.+\/aprobar$/,
    );
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"2"');
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      status: 403,
      errorCode: 'P2P_SOD_SELF_APPROVAL',
    });
  });

  it('recepción con lotes: Idempotency-Key y structuredContent del pedido', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: PO,
        estado: 'servido_parcial',
        lineas: [{ id: LN, recibida: '40.000' }],
      }),
    );
    const r = await herramientas().get('registrar_recepcion')!({
      id: PO,
      fecha: '2026-11-21',
      albaranNumero: 'ALB-1',
      lineas: [
        { lineaId: LN, cantidad: 40, lotes: [{ codigo: 'L1', cantidad: 40 }] },
      ],
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(JSON.parse(String(init.body)).lineas[0].lotes).toEqual([
      { codigo: 'L1', cantidad: 40 },
    ]);
    expect(r.structuredContent).toMatchObject({ estado: 'servido_parcial' });
  });

  it('verificar factura devuelve el cuadre; un pedido sin cuadre responde sinCuadre', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          factura: { id: 'f1' },
          cuadre: {
            bloqueada: true,
            lineas: [{ motivos: [{ codigo: 'P2P_MATCH_PRICE_VARIANCE' }] }],
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const h = herramientas();
    const v = await h.get('verificar_factura_pedido')!({
      id: PO,
      invoiceNumber: 'F-1',
      issueDate: '2026-11-22',
      lineas: [{ lineaId: LN, cantidad: 40, precioUnitario: 6.1 }],
    });
    expect(v.structuredContent).toMatchObject({ cuadre: { bloqueada: true } });
    const c = await h.get('cuadre_factura')!({ invoiceId: LN });
    expect(c.structuredContent).toEqual({ sinCuadre: true });
  });
});
