import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CopilotoService } from '../../src/copiloto/copiloto.service';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/** `YYYY-MM-DD` a N días naturales de hoy (positivo futuro, negativo pasado). */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * `copiloto` (Fase 11, cierre de cobertura): `CopilotoService.query()`
 * llama a la API de Anthropic (Claude Haiku) — sin `ANTHROPIC_API_KEY` el
 * servicio lo comprueba primero y degrada con una respuesta explicativa
 * (200, no un error) en vez de llamar a la red, así que no hay llamada
 * real en ningún test de este fichero.
 */
describe('Copiloto (integración) — desactivado sin ANTHROPIC_API_KEY', () => {
  let app: INestApplication;
  // El `.env` de desarrollo local puede traer una clave real (para probar
  // el pipeline OCR/IA a mano); este fichero prueba justo el camino sin
  // clave, así que la quitamos del entorno del proceso explícitamente en
  // vez de asumir que `jest.setup-env.ts` no la fija.
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  it('POST /copiloto/query degrada con una respuesta explicativa sin llamar a la red', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .post('/copiloto/query')
      .send({ question: '¿Cuántas obras en curso tenemos?' })
      .expect(201);
    expect(res.body.answer).toContain('ANTHROPIC_API_KEY');
    expect(res.body.toolsUsed).toEqual([]);
  });

  it('valida la pregunta antes de llegar al servicio: vacía o demasiado larga es 400', async () => {
    const admin = await registerUser(app);

    await authed(app, admin.accessToken)
      .post('/copiloto/query')
      .send({ question: '' })
      .expect(400);

    await authed(app, admin.accessToken)
      .post('/copiloto/query')
      .send({ question: 'x'.repeat(2001) })
      .expect(400);
  });

  it('exige token', async () => {
    await request(app.getHttpServer())
      .post('/copiloto/query')
      .send({ question: 'hola' })
      .expect(401);
  });

  it('POST /copiloto/query/stream degrada igual que la versión sin streaming, en formato SSE', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .post('/copiloto/query/stream')
      .send({ question: '¿Cuántas obras en curso tenemos?' })
      .expect(200);

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('ANTHROPIC_API_KEY');
    expect(res.text).toContain('"type":"done"');
    expect(res.text).toContain('"toolsUsed":[]');
  });

  it('POST /copiloto/query/stream exige token', async () => {
    await request(app.getHttpServer())
      .post('/copiloto/query/stream')
      .send({ question: 'hola' })
      .expect(401);
  });
});

/**
 * Herramientas de escritura del copiloto (Fase 15): dado que invocarlas de
 * verdad requiere que el modelo de Claude decida usarlas (fuera del control
 * de un test determinista, ver plan de la fase), se prueba `executeTool()`
 * directamente — saltándose `client.messages.create()` — igual que el resto
 * de esta suite trata la lógica determinista de un módulo. `executeTool` es
 * privado; se accede vía notación de corchetes (TypeScript solo lo impide en
 * compilación, no en tiempo de ejecución), patrón habitual para probar un
 * método interno sin ampliar la superficie pública del servicio solo para
 * los tests.
 *
 * Cada herramienta llama a la API real con el JWT del usuario (igual que en
 * producción); como aquí no hay un servidor HTTP escuchando en un puerto de
 * verdad (esta suite nunca hace `app.listen()`, solo `supertest` contra el
 * `http.Server` en memoria), `global.fetch` se sustituye por un adaptador
 * que reenvía la misma petición a través de `supertest` — así se ejercita el
 * controlador/servicio/base de datos reales, no una respuesta simulada.
 */
describe('Copiloto — herramientas de escritura aditivas (Fase 15)', () => {
  let app: INestApplication;
  let service: CopilotoService;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
    service = app.get(CopilotoService);
  });

  afterAll(async () => {
    await app.close();
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchThroughApp(accessToken: string) {
    global.fetch = (async (
      input: string | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toLowerCase() as
        'get' | 'post' | 'patch';
      let req = request(app.getHttpServer())
        [method](url.pathname + url.search)
        .set('Authorization', `Bearer ${accessToken}`);
      if (init?.body) req = req.send(JSON.parse(String(init.body)));
      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text: async () => JSON.stringify(res.body),
        json: async () => res.body,
      } as unknown as Response;
    }) as typeof fetch;
  }

  it('crear_incidencia_prl crea una incidencia PRL real, visible después vía GET', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    mockFetchThroughApp(admin.accessToken);

    const result = (await (
      service as unknown as {
        executeTool: (
          name: string,
          input: Record<string, unknown>,
          accessToken: string,
        ) => Promise<unknown>;
      }
    ).executeTool(
      'crear_incidencia_prl',
      {
        projectId: project.id,
        fecha: '2026-09-17',
        puntoInspeccion: 'Andamio fachada norte',
        descripcion: 'Falta rodapié de protección',
      },
      admin.accessToken,
    )) as { id: string };

    expect(result.id).toBeDefined();

    const list = (
      await authed(app, admin.accessToken)
        .get(`/incidencias-prl?projectId=${project.id}`)
        .expect(200)
    ).body as { id: string; puntoInspeccion: string; gravedad: string }[];
    expect(list.some((i) => i.id === result.id && i.gravedad === 'leve')).toBe(
      true,
    );
  });

  it('crear_fichaje registra un fichaje real', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    mockFetchThroughApp(admin.accessToken);

    const result = (await (
      service as unknown as {
        executeTool: (
          name: string,
          input: Record<string, unknown>,
          accessToken: string,
        ) => Promise<unknown>;
      }
    ).executeTool(
      'crear_fichaje',
      { projectId: project.id, workerName: 'Juan Pérez', type: 'entrada' },
      admin.accessToken,
    )) as { id: string };

    expect(result.id).toBeDefined();

    const list = (
      await authed(app, admin.accessToken)
        .get(`/fichajes?projectId=${project.id}`)
        .expect(200)
    ).body as { id: string; workerName: string; type: string }[];
    expect(
      list.some((f) => f.id === result.id && f.workerName === 'Juan Pérez'),
    ).toBe(true);
  });

  it('marcar_notificacion_leida marca de verdad una notificación real como leída', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);

    await client
      .post('/permisos')
      .send({
        projectId: project.id,
        tipo: 'licencia_obra',
        organismoPublico: 'Ayuntamiento de Pruebas',
        fechaSolicitud: isoDaysFromNow(-90),
        fechaResolucion: isoDaysFromNow(-60),
        fechaVencimiento: isoDaysFromNow(10),
        status: 'concedido',
      })
      .expect(201);
    await client.post('/alerts/run').expect(201);
    const notifications = (
      await client.get('/alerts/notifications').expect(200)
    ).body as { id: string; read: boolean }[];
    expect(notifications.length).toBeGreaterThan(0);
    const target = notifications[0];

    mockFetchThroughApp(admin.accessToken);
    const result = (await (
      service as unknown as {
        executeTool: (
          name: string,
          input: Record<string, unknown>,
          accessToken: string,
        ) => Promise<unknown>;
      }
    ).executeTool(
      'marcar_notificacion_leida',
      { notificationId: target.id },
      admin.accessToken,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);

    const after = (await client.get('/alerts/notifications').expect(200))
      .body as { id: string; read: boolean }[];
    expect(after.find((n) => n.id === target.id)?.read).toBe(true);
  });
});
