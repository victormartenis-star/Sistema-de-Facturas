import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarAuditoria } from './auditoria';

type Resultado = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** Servidor MCP mínimo: captura el manejador registrado de la herramienta. */
function obtenerManejador(): () => Promise<Resultado> {
  let manejador: (() => Promise<Resultado>) | undefined;
  const server = {
    registerTool: (
      nombre: string,
      _cfg: unknown,
      fn: () => Promise<Resultado>,
    ) => {
      if (nombre === 'verify_audit_integrity') manejador = fn;
    },
  } as unknown as McpServer;
  registrarAuditoria(server);
  if (!manejador) throw new Error('verify_audit_integrity no registrada');
  return manejador;
}

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('verify_audit_integrity', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide GET /audit/verify-integrity con cabecera X-Request-Id', async () => {
    fetchMock.mockResolvedValue(
      respuestaJson({
        integra: true,
        entradasVerificadas: 3,
        ultimaSecuencia: 3,
        verificadoEn: '2026-11-15T10:00:00.000Z',
        primerPuntoRoto: null,
      }),
    );
    await obtenerManejador()();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/audit\/verify-integrity$/);
    expect(init.method ?? 'GET').toBe('GET');
    const cabeceras = init.headers as Record<string, string>;
    expect(cabeceras['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('cadena íntegra: devuelve integra: true', async () => {
    fetchMock.mockResolvedValue(
      respuestaJson({
        integra: true,
        entradasVerificadas: 5,
        ultimaSecuencia: 5,
        verificadoEn: '2026-11-15T10:00:00.000Z',
        primerPuntoRoto: null,
      }),
    );
    const r = await obtenerManejador()();
    expect(r.isError).toBeUndefined();
    const datos = JSON.parse(r.content[0].text);
    expect(datos).toMatchObject({ integra: true, entradasVerificadas: 5 });
  });

  it('cadena rota: devuelve primerPuntoRoto con motivo', async () => {
    fetchMock.mockResolvedValue(
      respuestaJson({
        integra: false,
        entradasVerificadas: 2,
        ultimaSecuencia: 2,
        verificadoEn: '2026-11-15T10:00:00.000Z',
        primerPuntoRoto: {
          sequenceNumber: 2,
          motivo: 'hash_no_coincide',
          detalle: 'El hash almacenado no coincide',
          esperado: 'aaa',
          encontrado: 'bbb',
        },
      }),
    );
    const r = await obtenerManejador()();
    const datos = JSON.parse(r.content[0].text);
    expect(datos.integra).toBe(false);
    expect(datos.primerPuntoRoto).toMatchObject({
      secuencia: 2,
      motivo: 'hash_no_coincide',
    });
  });

  it('error RFC 7807: devuelve un mensaje con la ref', async () => {
    fetchMock.mockResolvedValue(
      respuestaJson(
        {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: 'Solo administración',
          correlationId: 'corr-123',
        },
        403,
      ),
    );
    const r = await obtenerManejador()();
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('[403]');
    expect(r.content[0].text).toContain('Solo administración');
    expect(r.content[0].text).toContain('(ref: corr-123)');
  });
});
