import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';
import {
  ACTIVE_USERS_GAUGE,
  DB_QUERY_DURATION_SECONDS,
  HTTP_REQUESTS_TOTAL,
  HTTP_REQUEST_DURATION_SECONDS,
} from './metrics.constants';
import { DbMetricsService } from './db-metrics.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';

/**
 * Observabilidad de la API (Fase 8): `GET /metrics` en formato Prometheus,
 * métricas RED de peticiones HTTP y de consultas SQL, y un gauge
 * aproximado de usuarios activos. Detalle completo — nombres exactos,
 * labels, buckets, cómo importar el dashboard de Grafana — en la nota
 * Obsidian «Observabilidad y Telemetría».
 *
 * `PrometheusModule.register(...)` registra `MetricsController` como
 * controlador de su propio módulo dinámico (por eso no se repite aquí en
 * `controllers`): ver el comentario en `metrics.controller.ts`.
 */
@Module({
  imports: [
    PrometheusModule.register({
      controller: MetricsController,
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    makeCounterProvider({
      name: HTTP_REQUESTS_TOTAL,
      help: 'Peticiones HTTP completadas, por método, ruta con patrón, código de estado y rol.',
      labelNames: ['method', 'route', 'status_code', 'role'],
    }),
    makeHistogramProvider({
      name: HTTP_REQUEST_DURATION_SECONDS,
      help: 'Latencia de peticiones HTTP en segundos, por método, ruta con patrón y código de estado.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    }),
    makeHistogramProvider({
      name: DB_QUERY_DURATION_SECONDS,
      help: 'Latencia de consultas SQL vía Drizzle/node-postgres en segundos, por tipo de operación.',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    }),
    makeGaugeProvider({
      name: ACTIVE_USERS_GAUGE,
      help: 'Usuarios autenticados distintos vistos en los últimos 5 minutos (aproximado, en memoria, por proceso).',
    }),
    DbMetricsService,
    HttpMetricsInterceptor,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class MetricsModule {}
