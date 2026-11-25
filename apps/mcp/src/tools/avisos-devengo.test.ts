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

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const AVISO = {
  desde: '2024-01',
  hasta: '2024-10',
  meses: 10,
  motivo: 'fuera_de_ventana',
  nivel: 'alerta',
  casos: 10,
  detalle: '2024-01 a 2024-10: Fuera de la ventana del devengo automático',
};

describe('herramientas MCP de avisos de devengo y retenciones en la conciliación', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('devengo automático: avisos, alertas y lote en structuredContent', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        desde: '2024-11',
        hasta: '2026-10',
        periodos: [],
        contabilizados: 23,
        importe: 1917.81,
        loteId: 'l1',
        avisos: [AVISO],
        alertas: 1,
      }),
    );
    const r = await herramientas().get('devengo_automatico_avales')!({
      fechaReferencia: '2026-11-15',
    });
    expect(r.structuredContent).toMatchObject({
      loteId: 'l1',
      alertas: 1,
      avisos: [{ motivo: 'fuera_de_ventana', nivel: 'alerta' }],
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      fechaReferencia: '2026-11-15',
    });
  });

  it('lotes del devengo: lista en items con sus avisos', async () => {
    fetchMock.mockResolvedValueOnce(
      json([{ id: 'l1', disparo: 'automatico', avisos: [AVISO], alertas: 1 }]),
    );
    const r = await herramientas().get('lotes_devengo_avales')!({});
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/avales\/devengos\/lotes$/,
    );
    expect(r.structuredContent).toMatchObject({
      items: [{ id: 'l1', disparo: 'automatico', alertas: 1 }],
    });
  });

  it('conciliación: partidas de retención con detalle; error RFC 7807 con errorCode', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          id: null,
          fecha: '2026-09-30',
          cuadra: true,
          descuadres: 0,
          partidas: [
            {
              clave: 'clientes_retenciones',
              cuentas: '4301',
              auxiliar: 30,
              mayor: 30,
              diferencia: 0,
              cuadra: true,
              detalle: [
                { clave: 'vencida', concepto: 'Vencida', importe: 30 },
                { clave: 'no_vencida', concepto: 'No vencida', importe: 0 },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json(
          {
            type: 'about:blank',
            status: 422,
            errorCode: 'CLOSE_RECONCILIATION_DATE_INVALID',
            detail: 'La fecha de corte (2999-01-01) no puede ser futura',
          },
          422,
        ),
      );
    const h = herramientas();
    const ok = await h.get('conciliacion_cierre')!({ fecha: '2026-09-30' });
    expect(ok.structuredContent).toMatchObject({
      partidas: [
        {
          clave: 'clientes_retenciones',
          detalle: [{ clave: 'vencida', importe: 30 }, {}],
        },
      ],
    });
    const mal = await h.get('conciliacion_cierre')!({ fecha: '2999-01-01' });
    expect(mal.isError).toBe(true);
    expect(mal.structuredContent).toMatchObject({
      status: 422,
      errorCode: 'CLOSE_RECONCILIATION_DATE_INVALID',
    });
  });
});
