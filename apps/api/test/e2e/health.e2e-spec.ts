import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { closeDb } from '@erp/db';
import { CommonModule } from '../../src/common/common.module';
import { DbModule } from '../../src/db/db.module';
import { HealthModule } from '../../src/health/health.module';

/**
 * `/health/live`, `/health/ready` y el alias `/health`: públicos (sin token),
 * sin Terminus. Módulo aparte de `TestAppModule` a propósito: no necesitan
 * auth ni negocio.
 */
describe('Health (integración)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CommonModule, DbModule, HealthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('live responde 200 sin token', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeS).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it.each(['/health/ready', '/health'])(
    '%s responde 200 con base y estado del pool, sin token',
    async (ruta) => {
      const res = await request(app.getHttpServer()).get(ruta);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      const db = res.body.checks.database;
      expect(db.status).toBe('up');
      expect(typeof db.latencyMs).toBe('number');
      expect(db.pool).toEqual({
        totalCount: expect.any(Number),
        idleCount: expect.any(Number),
        waitingCount: expect.any(Number),
        max: 10,
      });
    },
  );

  it('ready responde 503 sin mensajes de Postgres cuando la base no es alcanzable', async () => {
    const original = process.env.DATABASE_URL;
    await closeDb();
    // Puerto cerrado: la conexión es rechazada de inmediato.
    process.env.DATABASE_URL = 'postgresql://erp:erp@127.0.0.1:1/inexistente';
    try {
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('error');
      expect(res.body.checks.database.status).toBe('down');
      expect(['error', 'timeout']).toContain(res.body.checks.database.motivo);
      const texto = JSON.stringify(res.body);
      expect(texto).not.toMatch(
        /ECONNREFUSED|127\.0\.0\.1|inexistente|password/i,
      );
    } finally {
      await closeDb();
      process.env.DATABASE_URL = original;
    }
    const ok = await request(app.getHttpServer()).get('/health/ready');
    expect(ok.status).toBe(200);
  });
});
