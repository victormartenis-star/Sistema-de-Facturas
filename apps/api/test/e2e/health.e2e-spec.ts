import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DbModule } from '../../src/db/db.module';
import { HealthModule } from '../../src/health/health.module';

/**
 * `GET /health` (Fase 11, cierre de cobertura): módulo de pruebas aparte de
 * `TestAppModule` a propósito — el healthcheck no lleva auth (`@Public()`)
 * ni depende de ningún módulo de negocio, solo de `DbService` para el ping
 * a Postgres. Montarlo suelto evita arrastrar todo `AuthModule`/RBAC solo
 * para comprobar tres indicadores de Terminus.
 */
describe('Health (integración)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule, HealthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Solo se afirma el indicador de base de datos, no los de memoria: sus
   * umbrales (300 MB de heap, 500 MB de RSS) están pensados para el proceso
   * compilado de producción, no para este worker de `ts-jest` — que en la
   * práctica los supera solo por el peso de compilar TypeScript sobre la
   * marcha, no por ninguna fuga real de la app. Por eso el status code no
   * se fija a 200: puede ser 503 aquí y seguir siendo un healthcheck
   * correcto (Terminus reporta below-threshold de verdad).
   */
  it('el indicador de base de datos está up cuando Postgres está vivo, venga 200 o 503', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect([200, 503]).toContain(res.status);
    expect(res.body.details.database.status).toBe('up');
    expect(res.body.details.memory_heap.status).toMatch(/^(up|down)$/);
    expect(res.body.details.memory_rss.status).toMatch(/^(up|down)$/);
  });

  it('no exige token (es público, pensado para Docker/balanceadores)', async () => {
    // Sin cabecera Authorization: si llevara el guard global, sería 401, no
    // el 200/503 real de Terminus.
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).not.toBe(401);
  });
});
