import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Gauge, Histogram } from 'prom-client';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { buildHttpRequestLabels } from '@erp/shared';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import {
  ACTIVE_USERS_GAUGE,
  HTTP_REQUESTS_TOTAL,
  HTTP_REQUEST_DURATION_SECONDS,
} from './metrics.constants';

/** Ventana de actividad para `active_users_count`: ver la clase para el porqué. */
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Instrumenta cada petición HTTP con las métricas RED estándar:
 * `http_requests_total` (contador) y `http_request_duration_seconds`
 * (histograma), etiquetadas por método, ruta *con patrón*
 * (`/invoices/:id`, nunca `/invoices/123`) y código de estado, más el rol
 * del usuario cuando lo hay. El etiquetado exacto — y por qué usa el
 * patrón de ruta y no la URL resuelta — vive en `buildHttpRequestLabels`
 * (`@erp/shared`), probado sin Nest en `packages/shared/src/metrics.test.ts`.
 *
 * De paso alimenta `active_users_count`: un gauge aproximado con los
 * `userId` distintos vistos en los últimos 5 minutos, en memoria y por
 * proceso — se reinicia al desplegar, no es una cuenta de sesiones activas
 * real (no hay tabla de sesiones en el esquema), solo una señal de
 * actividad razonable sin tener que levantar infraestructura nueva
 * (Redis, etc.) para esto.
 *
 * Se registra como `APP_INTERCEPTOR` global desde `MetricsModule`, con el
 * mismo patrón que `LoggingInterceptor` en `AppModule` (ver ese fichero).
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly activeUsers = new Map<string, number>();

  constructor(
    @InjectMetric(HTTP_REQUESTS_TOTAL)
    private readonly requestsTotal: Counter<string>,
    @InjectMetric(HTTP_REQUEST_DURATION_SECONDS)
    private readonly requestDuration: Histogram<string>,
    @InjectMetric(ACTIVE_USERS_GAUGE)
    private readonly activeUsersGauge: Gauge<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest & Request>();
    const res = http.getResponse<Response>();
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res.statusCode, start),
        error: (err: { status?: number }) =>
          this.record(req, err.status ?? 500, start),
      }),
    );
  }

  private record(
    req: AuthenticatedRequest & Request,
    statusCode: number,
    start: bigint,
  ): void {
    const routePattern =
      // `req.route` lo tipa `@types/express` como `any`: solo tiene forma
      // cuando Express llegó a resolver la ruta.
      typeof req.route?.path === 'string' ? req.route.path : undefined;
    const labels = buildHttpRequestLabels({
      method: req.method,
      routePattern,
      statusCode,
      role: req.user?.role ?? null,
    });
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

    this.requestsTotal.inc(labels);
    this.requestDuration.observe(
      {
        method: labels.method,
        route: labels.route,
        status_code: labels.status_code,
      },
      durationSeconds,
    );

    if (req.user?.sub) {
      this.touchActiveUser(req.user.sub);
    }
  }

  private touchActiveUser(userId: string): void {
    const now = Date.now();
    this.activeUsers.set(userId, now);
    for (const [id, lastSeen] of this.activeUsers) {
      if (now - lastSeen > ACTIVE_WINDOW_MS) this.activeUsers.delete(id);
    }
    this.activeUsersGauge.set(this.activeUsers.size);
  }
}
