import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarSubcontratas } from './subcontratas';

type Resultado = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};
type Manejador = (args: Record<string, unknown>) => Promise<Resultado>;

function herramientas(): Map<string, Manejador> {
  const mapa = new Map<string, Manejador>();
  const server = {
    registerTool: (nombre: string, _cfg: unknown, fn: Manejador) =>
      mapa.set(nombre, fn),
  } as unknown as McpServer;
  registrarSubcontratas(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CONTRATO = '11111111-1111-4111-8111-111111111111';
const CERT = '22222222-2222-4222-8222-222222222222';

describe('herramientas MCP de subcontratas', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('no expone pagar ni devolver garantía (salidas de dinero)', () => {
    expect([...herramientas().keys()].sort()).toEqual([
      'aprobar_certificacion_subcontrata',
      'consultar_certificacion_subcontrata',
      'consultar_retencion_garantia',
      'crear_certificacion_subcontrata',
      'generar_factura_compra_subcontrata',
      'listar_certificaciones_subcontrata',
      'listar_contratos_subcontrata',
    ]);
  });

  it('generar factura: lee la versión, envía If-Match y el cuerpo sin el id', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: CERT, version: 4 }))
      .mockResolvedValueOnce(
        json({ id: CERT, facturaCompra: { invoiceNumber: 'F-1' } }, 201),
      );
    const r = await herramientas().get('generar_factura_compra_subcontrata')!({
      id: CERT,
      invoiceNumber: 'F-1',
      issueDate: '2026-11-30',
      isp: true,
    });
    expect(r.isError).toBeFalsy();
    const [url, init] = fetchMock.mock.calls[1];
    expect(
      String(url).endsWith(
        `/subcontratas/certificaciones/${CERT}/factura-compra`,
      ),
    ).toBe(true);
    expect(
      ((init as RequestInit).headers as Record<string, string>)['If-Match'],
    ).toBe('"4"');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      invoiceNumber: 'F-1',
      issueDate: '2026-11-30',
      isp: true,
    });
  });

  it('listar contratos pasa los filtros en la query', async () => {
    fetchMock.mockResolvedValue(json([]));
    await herramientas().get('listar_contratos_subcontrata')!({
      proyectoId: CONTRATO,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(
      String(url).endsWith(`/subcontratas/contratos?proyectoId=${CONTRATO}`),
    ).toBe(true);
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toHaveProperty('X-Request-Id');
  });

  it('crear envía el cuerpo sin contratoId al POST del contrato', async () => {
    fetchMock.mockResolvedValue(json({ id: CERT }, 201));
    await herramientas().get('crear_certificacion_subcontrata')!({
      contratoId: CONTRATO,
      fecha: '2026-11-30',
      periodoDesde: '2026-11-01',
      periodoHasta: '2026-11-30',
      importeOrigen: 1000,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(
      `/subcontratas/contratos/${CONTRATO}/certificaciones`,
    );
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      fecha: '2026-11-30',
      periodoDesde: '2026-11-01',
      periodoHasta: '2026-11-30',
      importeOrigen: 1000,
    });
  });

  it('aprobar lee la versión y la envía en If-Match; un 409 de PRL llega como error', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: CERT, version: 3 }))
      .mockResolvedValueOnce(
        json(
          {
            status: 409,
            detail:
              'No se puede aprobar la certificación: la subcontrata no está apta por PRL.',
          },
          409,
        ),
      );
    const r = await herramientas().get('aprobar_certificacion_subcontrata')!({
      id: CERT,
    });
    const [, init] = fetchMock.mock.calls[1];
    expect(
      ((init as RequestInit).headers as Record<string, string>)['If-Match'],
    ).toBe('"3"');
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/PRL/);
  });
});
