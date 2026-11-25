import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarAvales } from './avales';

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
  registrarAvales(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const AVAL = '11111111-1111-4111-8111-111111111111';

describe('herramientas MCP de avales', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('registra consulta, alta, liberación, ejecución, prórroga y comisión', () => {
    expect([...herramientas().keys()].sort()).toEqual([
      'alta_aval',
      'detalle_aval',
      'ejecutar_aval',
      'liberar_aval',
      'listar_avales',
      'prorrogar_aval',
      'registrar_comision_aval',
      'resumen_avales',
    ]);
  });

  it('listar: filtros en la query y lista en structuredContent.items', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: AVAL, saldoVivo: 1000 }]));
    const r = await herramientas().get('listar_avales')!({
      venceEnDias: 30,
      direccion: 'emitido',
    });
    expect(r.structuredContent).toEqual({
      items: [{ id: AVAL, saldoVivo: 1000 }],
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/avales?');
    expect(url).toContain('venceEnDias=30');
    expect(url).toContain('direccion=emitido');
  });

  it('alta: valida las reglas cruzadas antes de llamar a la API', async () => {
    const h = herramientas();
    const mal = await h.get('alta_aval')!({
      referencia: 'AV-1',
      tipo: 'anticipo',
      direccion: 'emitido',
      entidad: 'Banco',
      importe: 1000,
      fechaEmision: '2026-02-01',
      fechaVencimiento: '2026-01-01',
    });
    expect(mal.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json({ id: AVAL, estado: 'vigente' }, 201));
    const ok = await h.get('alta_aval')!({
      referencia: 'AV-1',
      tipo: 'anticipo',
      direccion: 'emitido',
      entidad: 'Banco',
      importe: 1000,
      fechaEmision: '2026-02-01',
    });
    expect(ok.structuredContent).toMatchObject({ id: AVAL, estado: 'vigente' });
    const h0 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(h0['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ejecutar: lee la versión y envía If-Match e Idempotency-Key', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: AVAL, version: 4 }))
      .mockResolvedValueOnce(
        json({ id: AVAL, estado: 'ejecutado', ejecutado: 1000 }),
      );
    const r = await herramientas().get('ejecutar_aval')!({
      id: AVAL,
      fecha: '2026-05-01',
      motivo: 'Incumplimiento',
    });
    expect(r.structuredContent).toMatchObject({ estado: 'ejecutado' });
    expect(String(fetchMock.mock.calls[1][0])).toMatch(
      new RegExp(`/avales/${AVAL}/ejecutar$`),
    );
    const h = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(h['If-Match']).toBe('"4"');
    expect(h['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE llega estructurado', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: AVAL, version: 1 }))
      .mockResolvedValueOnce(
        json(
          {
            type: 'about:blank',
            title: 'Importe superior al saldo vivo del aval',
            status: 422,
            detail: 'El importe supera el saldo vivo',
            errorCode: 'BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE',
          },
          422,
        ),
      );
    const r = await herramientas().get('liberar_aval')!({
      id: AVAL,
      fecha: '2026-05-01',
      importe: 99_999,
      motivo: 'Parcial',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE',
    });
  });
});
