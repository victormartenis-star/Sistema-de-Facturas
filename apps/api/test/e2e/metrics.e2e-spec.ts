import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsModule } from '../../src/metrics/metrics.module';

/**
 * `GET /metrics` (Fase 11, cierre de cobertura): módulo de pruebas aparte
 * de `TestAppModule`, igual que `health.e2e-spec.ts` — es público, no toca
 * el negocio, y `PrometheusModule.register(...)` registra sus métricas en
 * el registro global de `prom-client` de este proceso; montarlo solo aquí
 * evita que los demás ficheros de test paguen ese coste de arranque o
 * choquen si alguna vez se instancia la app más de una vez por fichero.
 */
describe('Metrics (integración)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 en texto plano de Prometheus con las métricas propias registradas', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(res.headers['content-type']).toMatch(/text\/plain/);
    // Contadores/histogramas propios de `metrics.module.ts` (labels aparte).
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('db_queries_duration_seconds');
    expect(res.text).toContain('active_users');
    // `defaultMetrics: { enabled: true }`: también las de proceso de Node.
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('no exige token (es público, pensado para el scrape de Prometheus)', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(200);
  });
});
