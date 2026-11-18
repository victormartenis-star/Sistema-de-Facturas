import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '@erp/db';
import { DbMetricsService } from '../../src/metrics/db-metrics.service';
import { logger, setLogDestination } from '../../src/common/logging/logger';

/**
 * Log de consultas lentas: una consulta que supera el umbral (200 ms por
 * defecto) se registra a `warn` con duración y SQL saneado. Se instancia
 * `DbMetricsService` a mano porque la app de test no monta `MetricsModule`.
 */
describe('Base de datos (integración) — log de consultas lentas', () => {
  const lineas: string[] = [];
  let servicio: DbMetricsService;
  let nivelPrevio: string;

  beforeAll(() => {
    nivelPrevio = logger.level;
    logger.level = 'warn';
    setLogDestination((linea) => lineas.push(linea));
    const histograma = { observe: () => undefined } as never;
    servicio = new DbMetricsService(histograma);
  });

  afterAll(async () => {
    servicio.onModuleDestroy();
    await closeDb();
    setLogDestination(undefined);
    logger.level = nivelPrevio as typeof logger.level;
  });

  beforeEach(() => {
    lineas.length = 0;
  });

  it('registra en warn una consulta que supera el umbral, sin valores de parámetros', async () => {
    await getDb().execute(sql`SELECT pg_sleep(0.25), 'secreto-123' AS dato`);

    const aviso = lineas
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === 'db.consulta_lenta');
    expect(aviso).toBeDefined();
    expect(aviso?.level).toBe('warn');
    expect(aviso?.umbralMs).toBe(200);
    expect(aviso?.durationMs as number).toBeGreaterThanOrEqual(200);
    expect(String(aviso?.sql)).toContain('pg_sleep');
    expect(JSON.stringify(aviso)).not.toContain('secreto-123');
  });

  it('no registra consultas rápidas', async () => {
    await getDb().execute(sql`SELECT 1`);
    expect(lineas.some((l) => l.includes('db.consulta_lenta'))).toBe(false);
  });
});
