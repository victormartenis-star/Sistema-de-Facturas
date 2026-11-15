import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import { getPoolStats } from '@erp/db';
import { Public } from '../auth/public.decorator';
import { DbService } from '../db/db.service';
import { logger } from '../common/logging/logger';

export const READY_TIMEOUT_MS = 2000;

/**
 * Sondas para balanceadores/Docker: públicas (sin JWT), exentas de throttling
 * y sin datos sensibles (nunca el mensaje de error de Postgres: va al log).
 * Responden escribiendo el estado, sin lanzar excepciones (el filtro global
 * las convertiría en problem+json).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly dbs: DbService) {}

  /** Liveness: el proceso responde. Sin dependencias. */
  @Public()
  @SkipThrottle()
  @Get('live')
  live() {
    return {
      status: 'ok',
      uptimeS: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: `SELECT 1` (2 s) + estado del pool. 503 si la base no responde. */
  @Public()
  @SkipThrottle()
  @Get(['ready', ''])
  async ready(@Res() res: Response): Promise<void> {
    const inicio = Date.now();
    let motivo: 'timeout' | 'error' | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.dbs.db.execute(sql`SELECT 1`),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            READY_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      motivo =
        err instanceof Error && err.message === 'timeout' ? 'timeout' : 'error';
      logger.error(
        { err, motivo },
        'health.ready: base de datos no disponible',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    const ok = motivo === null;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'error',
      checks: {
        database: {
          status: ok ? 'up' : 'down',
          latencyMs: Date.now() - inicio,
          ...(ok ? {} : { motivo }),
          pool: getPoolStats(),
        },
      },
      timestamp: new Date().toISOString(),
    });
  }
}
