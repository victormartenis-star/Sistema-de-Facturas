import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarCierre } from './cierre';
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
  registrarCierre(server);
  registrarAvales(server);
  return mapa;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OBRA = '22222222-2222-4222-8222-222222222222';
const AVAL = '33333333-3333-4333-8333-333333333333';
const cabeceras = (m: ReturnType<typeof vi.fn>, i: number) =>
  (m.mock.calls[i][1] as RequestInit).headers as Record<string, string>;

describe('herramientas MCP de cierre de ejercicio, EAC y líneas de avales', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('propuesta y cierre: ruta del ejercicio, structuredContent e Idempotency-Key', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ ejercicio: 2025, resultado: 10, impedimentos: [] }),
      )
      .mockResolvedValueOnce(
        json({ ejercicio: 2025, estado: 'cerrado', version: 1 }),
      );
    const h = herramientas();
    const p = await h.get('propuesta_cierre_ejercicio')!({ ejercicio: 2025 });
    expect(p.structuredContent).toMatchObject({ resultado: 10 });
    const c = await h.get('cerrar_ejercicio')!({ ejercicio: 2025 });
    expect(c.structuredContent).toMatchObject({ estado: 'cerrado' });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/contabilidad\/ejercicios\/2025\/cierre$/,
    );
    expect(String(fetchMock.mock.calls[1][0])).toMatch(
      /\/contabilidad\/ejercicios\/2025\/cerrar$/,
    );
    expect(cabeceras(fetchMock, 1)['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it('revertir: lee la versión del cierre vigente y envía If-Match', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ cierreVigente: { version: 3 } }))
      .mockResolvedValueOnce(json({ estado: 'revertido' }));
    const r = await herramientas().get('revertir_cierre_ejercicio')!({
      ejercicio: 2025,
      motivo: 'Ajuste de auditoría',
    });
    expect(r.structuredContent).toMatchObject({ estado: 'revertido' });
    expect(cabeceras(fetchMock, 1)['If-Match']).toBe('"3"');
  });

  it('EAC: sin versión previa no envía If-Match; con versión, sí', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ version: 0 }))
      .mockResolvedValueOnce(json({ version: 1, origen: 'manual' }))
      .mockResolvedValueOnce(json({ version: 1 }))
      .mockResolvedValueOnce(json({ version: 2, origen: 'automatica' }));
    const h = herramientas();
    const v1 = await h.get('fijar_estimacion_cierre')!({
      projectId: OBRA,
      costeEstimado: 1000,
      motivo: 'Revisión',
    });
    expect(v1.structuredContent).toMatchObject({
      version: 1,
      origen: 'manual',
    });
    expect(cabeceras(fetchMock, 1)['If-Match']).toBeUndefined();
    await h.get('fijar_estimacion_cierre')!({
      projectId: OBRA,
      costeEstimado: null,
      motivo: 'Automática',
    });
    expect(cabeceras(fetchMock, 3)['If-Match']).toBe('"1"');
    expect(String(fetchMock.mock.calls[3][0])).toContain(
      `/projects/${OBRA}/estimacion-cierre`,
    );
  });

  it('EAC_BELOW_ACTUAL_COST llega estructurado', async () => {
    fetchMock.mockResolvedValueOnce(json({ version: 0 })).mockResolvedValueOnce(
      json(
        {
          type: 'about:blank',
          title: 'Estimación al cierre inferior al coste real',
          status: 422,
          detail: 'No puede ser inferior al coste real',
          errorCode: 'EAC_BELOW_ACTUAL_COST',
        },
        422,
      ),
    );
    const r = await herramientas().get('fijar_estimacion_cierre')!({
      projectId: OBRA,
      costeEstimado: 1,
      motivo: 'Demasiado baja',
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      errorCode: 'EAC_BELOW_ACTUAL_COST',
    });
  });

  it('líneas en items y ejecución financiada de un aval', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ entidad: 'Banco', disponible: 100 }]))
      .mockResolvedValueOnce(json({ id: AVAL, version: 2 }))
      .mockResolvedValueOnce(json({ id: AVAL, estado: 'ejecutado' }));
    const h = herramientas();
    const l = await h.get('lineas_avales')!({});
    expect(l.structuredContent).toEqual({
      items: [{ entidad: 'Banco', disponible: 100 }],
    });
    await h.get('ejecutar_aval')!({
      id: AVAL,
      fecha: '2026-04-01',
      motivo: 'Incumplimiento',
      liquidacion: 'financiacion',
    });
    const cuerpo = JSON.parse(
      String((fetchMock.mock.calls[2][1] as RequestInit).body),
    );
    expect(cuerpo).toMatchObject({ liquidacion: 'financiacion' });
  });
});
