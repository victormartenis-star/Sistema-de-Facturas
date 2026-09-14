import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../auth/public.decorator';
import { DrizzleHealthIndicator } from './drizzle-health.indicator';

/** El proceso no debería usar más de 300 MB de heap ni 500 MB de RSS en marcha normal. */
const HEAP_THRESHOLD_BYTES = 300 * 1024 * 1024;
const RSS_THRESHOLD_BYTES = 500 * 1024 * 1024;

/**
 * `GET /health` — pensado para Docker `HEALTHCHECK` y balanceadores, no
 * para un humano ni para el frontend: por eso es `@Public()` (sin JWT) y
 * devuelve el JSON tal cual lo formatea Terminus (`{ status, info, error,
 * details }`), sin envoltorio propio.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DrizzleHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', HEAP_THRESHOLD_BYTES),
      () => this.memory.checkRSS('memory_rss', RSS_THRESHOLD_BYTES),
    ]);
  }
}
