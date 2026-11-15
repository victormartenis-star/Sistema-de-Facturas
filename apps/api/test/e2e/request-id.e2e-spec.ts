import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProblemProbeModule } from './problem-probe.module';
import { createTestApp } from './helpers';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('X-Request-Id (integración)', () => {
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

  it('sin cabecera genera un UUID v4', async () => {
    const res = await get('/probe/ok').expect(200);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('respeta una cabecera válida', async () => {
    const res = await get('/probe/ok').set('X-Request-Id', 'abc12345-OK_.x');
    expect(res.headers['x-request-id']).toBe('abc12345-OK_.x');
  });

  it.each([
    ['demasiado corta', 'abc'],
    ['demasiado larga', 'a'.repeat(65)],
    ['con caracteres no permitidos', 'abc 12345<script>'],
    ['vacía', ''],
  ])('regenera una cabecera inválida (%s)', async (_n, valor) => {
    const res = await get('/probe/ok').set('X-Request-Id', valor);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('está en 404, 403, 429 y 500 y coincide con el correlationId del cuerpo', async () => {
    const id = 'trace-0001-abcd';
    const r404 = await get('/no-existe').set('X-Request-Id', id).expect(404);
    const r403 = await get('/probe/403').set('X-Request-Id', id).expect(403);
    const r500 = await get('/probe/boom').set('X-Request-Id', id).expect(500);
    await get('/limited').expect(200);
    await get('/limited').expect(200);
    const r429 = await get('/limited').set('X-Request-Id', id).expect(429);
    for (const r of [r404, r403, r429, r500]) {
      expect(r.headers['x-request-id']).toBe(id);
      expect(r.body.correlationId).toBe(id);
    }
    expect(r429.headers['retry-after']).toBeDefined();
  });

  it('dos peticiones concurrentes no mezclan su correlationId', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `concurr-${i}-xxxx`);
    const res = await Promise.all(
      ids.map((id) => get('/probe/boom').set('X-Request-Id', id)),
    );
    res.forEach((r, i) => {
      expect(r.headers['x-request-id']).toBe(ids[i]);
      expect(r.body.correlationId).toBe(ids[i]);
    });
  });
});

describe('X-Request-Id en 401 (app completa)', () => {
  it('una petición sin token lleva la cabecera y el correlationId', async () => {
    const app = await createTestApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/projects')
        .set('X-Request-Id', 'sin-token-1234')
        .expect(401);
      expect(res.headers['x-request-id']).toBe('sin-token-1234');
      expect(res.body.correlationId).toBe('sin-token-1234');
    } finally {
      await app.close();
    }
  });
});
