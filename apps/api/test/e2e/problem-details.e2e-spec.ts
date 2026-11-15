import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MENSAJE_CONFLICTO_VERSION } from '@erp/shared';
import { MENSAJE_SECRETO, ProblemProbeModule } from './problem-probe.module';

const CAMPOS = [
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'errorCode',
  'correlationId',
  'timestamp',
  'errors',
];

describe('RFC 7807 — AllExceptionsFilter (integración)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ProblemProbeModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (url: string) => request(app.getHttpServer()).get(url);

  function verificar(res: request.Response, status: number, code: string) {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(
      /^application\/problem\+json; charset=utf-8/,
    );
    for (const c of CAMPOS) expect(res.body).toHaveProperty(c);
    expect(res.body.status).toBe(status);
    expect(res.body.errorCode).toBe(code);
    expect(res.body.type).toBe(`https://erp-dintel/errores/${code}`);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.correlationId).toBe(res.headers['x-request-id']);
    // Compatibilidad
    expect(res.body.code).toBe(code);
    expect(res.body.statusCode).toBe(status);
    expect(res.body.message).toBe(res.body.detail);
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  }

  it('400 Zod con errors (pipe)', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/pipe?x=1')
      .send({ n: 'no' });
    verificar(res, 400, 'VALIDATION_ERROR');
    expect(res.body.errors[0]).toEqual({
      field: 'n',
      message: expect.any(String),
    });
    expect(res.body.message).toBe('Datos no válidos');
    expect(res.body.instance).toBe('/probe/pipe');
  });

  it('ZodError sin capturar -> 400 en vez de 500', async () => {
    const res = await get('/probe/zod');
    verificar(res, 400, 'VALIDATION_ERROR');
    expect(res.body.errors[0].field).toBe('a');
  });

  it('401, 403 y 404', async () => {
    verificar(await get('/probe/401'), 401, 'UNAUTHORIZED');
    const r403 = await get('/probe/403');
    verificar(r403, 403, 'FORBIDDEN');
    expect(r403.body.message).toBe('No tienes permiso');
    verificar(await get('/probe/no-existe'), 404, 'NOT_FOUND');
  });

  it('409 VERSION_CONFLICT conserva versionActual', async () => {
    const res = await get('/probe/version');
    verificar(res, 409, 'VERSION_CONFLICT');
    expect(res.body.versionActual).toBe(7);
    expect(res.body.detail).toBe(MENSAJE_CONFLICTO_VERSION);
  });

  it('409 INVALID_TRANSITION', async () => {
    const res = await get('/probe/transicion');
    verificar(res, 409, 'INVALID_TRANSITION');
  });

  it('409 IDEMPOTENCY_* conserva Retry-After', async () => {
    const res = await get('/probe/idem');
    verificar(res, 409, 'IDEMPOTENCY_IN_PROGRESS');
    expect(res.headers['retry-after']).toBe('1');
  });

  it('428 y 503 AUDIT_CHAIN_BUSY', async () => {
    verificar(await get('/probe/428'), 428, 'PRECONDITION_REQUIRED');
    verificar(await get('/probe/503'), 503, 'AUDIT_CHAIN_BUSY');
  });

  it('429', async () => {
    await get('/limited');
    await get('/limited');
    const res = await get('/limited');
    verificar(res, 429, 'TOO_MANY_REQUESTS');
  });

  it('500 sin detalle interno', async () => {
    const res = await get('/probe/boom');
    verificar(res, 500, 'INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secreto');
    expect(JSON.stringify(res.body)).not.toContain(MENSAJE_SECRETO);
    expect(res.body.detail).toBe(
      'Error interno. Indica el correlationId a soporte.',
    );
  });
});
