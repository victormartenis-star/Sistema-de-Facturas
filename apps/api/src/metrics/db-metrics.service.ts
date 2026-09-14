import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Histogram } from 'prom-client';
import { setQueryObserver } from '@erp/db';
import { extractSqlOperation } from '@erp/shared';
import { DB_QUERY_DURATION_SECONDS } from './metrics.constants';

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
 */
@Injectable()
export class DbMetricsService implements OnModuleDestroy {
  constructor(
    @InjectMetric(DB_QUERY_DURATION_SECONDS)
    private readonly dbQueryDuration: Histogram<string>,
  ) {
    setQueryObserver((durationMs, sql) => {
      this.dbQueryDuration.observe(
        { operation: extractSqlOperation(sql) },
        durationMs / 1000,
      );
    });
  }

  /** Deja `@erp/db` limpio si algún test reinstancia el módulo sin proceso nuevo. */
  onModuleDestroy(): void {
    setQueryObserver(undefined);
  }
}
