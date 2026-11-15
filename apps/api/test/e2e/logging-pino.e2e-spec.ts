import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { logger, setLogDestination } from '../../src/common/logging/logger';
import { createTestApp, registerUser, authed } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Log JSON con pino (integración)', () => {
  let app: INestApplication;
  let lineas: Record<string, unknown>[] = [];
  const nivelPrevio = logger.level;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
    logger.level = 'info';
    setLogDestination((l) => {
      lineas.push(JSON.parse(l) as Record<string, unknown>);
    });
  });
  afterAll(async () => {
    setLogDestination(undefined);
    logger.level = nivelPrevio;
    await app.close();
  });
  beforeEach(async () => {
    setLogDestination(undefined);
    await resetTestDb();
    lineas = [];
    setLogDestination((l) => {
      lineas.push(JSON.parse(l) as Record<string, unknown>);
    });
  });

  const accesos = () => lineas.filter((l) => l.msg === 'http.request');

  it('una línea JSON por petición con los 7 campos y route sin ids ni query', async () => {
    const admin = await registerUser(app);
    lineas = [];
    const res = await authed(app, admin.accessToken)
      .get('/projects?search=secreto-en-query')
      .set('X-Request-Id', 'log-test-1234');
    expect(res.status).toBe(200);
    const [l] = accesos();
    expect(accesos()).toHaveLength(1);
    expect(l).toMatchObject({
      level: 'info',
      msg: 'http.request',
      correlationId: 'log-test-1234',
      method: 'GET',
      route: '/projects',
      statusCode: 200,
    });
    expect(typeof l.latencyMs).toBe('number');
    expect(l.companyId).toEqual(expect.any(String));
    expect(l.userId).toEqual(expect.any(String));
    expect(JSON.stringify(l)).not.toContain('secreto-en-query');
  });

  it('route es el patrón con parámetros, no el id', async () => {
    const admin = await registerUser(app);
    lineas = [];
    const id = '11111111-1111-4111-8111-111111111111';
    await authed(app, admin.accessToken).get(`/projects/${id}`);
    expect(accesos()[0].route).toBe('/projects/:id');
  });

  it('una petición rechazada por guard (401) también deja línea; 404 es unmatched', async () => {
    await request(app.getHttpServer())
      .get('/projects')
      .set('X-Request-Id', 'guard-401-abcd');
    await request(app.getHttpServer()).get('/ruta/que/no/existe');
    const a = accesos();
    expect(a[0]).toMatchObject({
      correlationId: 'guard-401-abcd',
      statusCode: 401,
      userId: null,
    });
    expect(a[1]).toMatchObject({ statusCode: 404, route: 'unmatched' });
  });

  it('mixin: toda línea lleva correlationId aunque no sea la de acceso', async () => {
    await request(app.getHttpServer())
      .get('/projects')
      .set('X-Request-Id', 'mixin-0001-abcd');
    const err = lineas.find((l) => l.msg === 'http.error');
    expect(err?.correlationId).toBe('mixin-0001-abcd');
  });

  describe('redacción', () => {
    const SECRETOS = [
      'password',
      'token',
      'authorization',
      'certificate',
      'secret',
    ];
    const anidar = (n: number, hoja: Record<string, unknown>) => {
      let o: Record<string, unknown> = hoja;
      for (let i = 0; i < n; i++) o = { nivel: o };
      return o;
    };

    it.each([1, 3, 7])('enmascara a %i niveles de anidamiento', (n) => {
      const hoja = Object.fromEntries(SECRETOS.map((k) => [k, `VALOR-${k}`]));
      lineas = [];
      logger.info(
        { datos: anidar(n - 1, { ...hoja, visible: 'ok' }) },
        'prueba',
      );
      const l = lineas.find((x) => x.msg === 'prueba');
      const texto = JSON.stringify(l);
      for (const k of SECRETOS) expect(texto).not.toContain(`VALOR-${k}`);
      expect(texto).toContain('"visible":"ok"');
    });

    it('enmascara en el nivel raíz', () => {
      lineas = [];
      logger.info({ password: 'RAIZ-PW', token: 'RAIZ-TK' }, 'raiz');
      const texto = JSON.stringify(lineas.find((x) => x.msg === 'raiz'));
      expect(texto).not.toContain('RAIZ-');
    });
  });
});
