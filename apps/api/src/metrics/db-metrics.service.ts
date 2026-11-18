import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Histogram } from 'prom-client';
import { setQueryObserver } from '@erp/db';
import {
  esConsultaLenta,
  extractSqlOperation,
  sqlParaLog,
  UMBRAL_CONSULTA_LENTA_MS_POR_DEFECTO,
} from '@erp/shared';
import { logger } from '../common/logging/logger';
import { DB_QUERY_DURATION_SECONDS } from './metrics.constants';

/**
 * Umbral de consulta lenta (ms). Configurable con `SLOW_QUERY_MS`; un valor
 * no numérico o no positivo cae al de por defecto.
 */
function umbralConfigurado(): number {
  const valor = Number(process.env.SLOW_QUERY_MS);
  return Number.isFinite(valor) && valor > 0
    ? valor
    : UMBRAL_CONSULTA_LENTA_MS_POR_DEFECTO;
}

/**
 * Conecta el histograma `db_queries_duration_seconds` al observador de
 * consultas que expone `@erp/db` (envuelve `pool.query`, ver
 * `packages/db/src/index.ts`). Se registra desde el constructor, no desde
 * `onModuleInit`: Nest termina de construir todos los providers antes de
 * `app.listen()`, así que el observador queda puesto antes de que llegue
 * cualquier petición HTTP — no importa el orden real de instanciación
 * entre módulos.
 *
 * Etiquetada solo por `operation` (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/...,
 * ver `extractSqlOperation` en `@erp/shared`), no por la consulta
 * completa: con los IDs y filtros de cada llamada, esa cardinalidad sería
 * ilimitada.
 *
 * Además, cada consulta que supera el umbral (`SLOW_QUERY_MS`, 200 ms por
 * defecto) se registra en Pino a nivel `warn` con su duración y el texto
 * saneado (`sqlParaLog`: literales ocultos, truncado). El `correlationId`
 * (= `X-Request-Id`) de la petición en curso lo añade el `mixin` del logger
 * a través de `AsyncLocalStorage`.
 */
@Injectable()
export class DbMetricsService implements OnModuleDestroy {
  private readonly umbralLentaMs = umbralConfigurado();

  constructor(
    @InjectMetric(DB_QUERY_DURATION_SECONDS)
    private readonly dbQueryDuration: Histogram<string>,
  ) {
    setQueryObserver((durationMs, sql) => {
      this.dbQueryDuration.observe(
        { operation: extractSqlOperation(sql) },
        durationMs / 1000,
      );
      if (esConsultaLenta(durationMs, this.umbralLentaMs)) {
        logger.warn(
          {
            durationMs: Math.round(durationMs),
            umbralMs: this.umbralLentaMs,
            sql: sqlParaLog(sql),
          },
          'db.consulta_lenta',
        );
      }
    });
  }

  /** Deja `@erp/db` limpio si algún test reinstancia el módulo sin proceso nuevo. */
  onModuleDestroy(): void {
    setQueryObserver(undefined);
  }
}
