import { Controller, Get, Res } from '@nestjs/common';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';

/**
 * `GET /metrics` en formato de texto de Prometheus. Pensado para que un
 * `prometheus.yml` lo raspe (ver `infrastructure/monitoring/`), no para un
 * humano ni para el frontend: por eso es `@Public()` (sin JWT) — igual que
 * `GET /health` — y no lleva `@Roles(...)`. No expone datos de negocio ni
 * PII, solo contadores/histogramas agregados.
 *
 * Sin `@Controller('metrics')`: `PrometheusModule.register(...)` (ver
 * `metrics.module.ts`) fija la ruta por `Reflect.defineMetadata` a partir
 * de su opción `path` (por defecto `/metrics`), así que un decorador aquí
 * sería redundante — se deja así a propósito, siguiendo el patrón oficial
 * de la librería.
 */
@Controller()
export class MetricsController extends PrometheusController {
  @Public()
  @Get()
  index(@Res({ passthrough: true }) response: Response) {
    return super.index(response);
  }
}
