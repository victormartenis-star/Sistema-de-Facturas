import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import { buildDbHealthStatus } from '@erp/shared';
import { DbService } from '../db/db.service';

/**
 * Healthcheck de PostgreSQL vía Drizzle: mide cuánto tarda un `SELECT 1` y
 * lo traduce en un resultado de Terminus. La decisión "qué cuenta como
 * arriba/abajo" vive en `buildDbHealthStatus` (`@erp/shared`, sin Node ni
 * Drizzle) para poder probarla sin una base de datos real; aquí solo se
 * hace la llamada de verdad y se envuelve en el formato de Terminus.
 */
@Injectable()
export class DrizzleHealthIndicator extends HealthIndicator {
  constructor(private readonly dbs: DbService) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    const start = Date.now();
    try {
      await this.dbs.db.execute(sql`SELECT 1`);
      const status = buildDbHealthStatus({
        ok: true,
        latencyMs: Date.now() - start,
      });
      return this.getStatus(key, true, status);
    } catch (err) {
      const status = buildDbHealthStatus({
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'error desconocido',
      });
      throw new HealthCheckError(
        'La base de datos no responde',
        this.getStatus(key, false, status),
      );
    }
  }
}
