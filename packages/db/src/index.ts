import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export * from './schema';
export { schema };

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Db | undefined;

/**
 * Observador opcional de duración de consultas SQL. Lo registra
 * `apps/api/src/metrics/db-metrics.service.ts` para alimentar el
 * histograma `db_queries_duration_seconds` (Fase 8); si nadie lo registra
 * (tests, scripts, MCP), `getDb()` no añade ningún coste extra.
 */
type QueryObserver = (durationMs: number, sql: string) => void;
let queryObserver: QueryObserver | undefined;

export function setQueryObserver(observer: QueryObserver | undefined): void {
  queryObserver = observer;
}

/**
 * Envuelve `pool.query` para cronometrar cada consulta sin cambiar su
 * comportamiento ni su tipo público (`pg.Pool#query` tiene ~8 sobrecargas,
 * incluida una basada en callback; solo instrumentamos la forma basada en
 * promesa porque es la única que usa el driver `node-postgres` de Drizzle
 * por debajo — confirmado leyendo `drizzle-orm/node-postgres/session.js`).
 */
function instrumentPool(target: Pool): void {
  const originalQuery = target.query.bind(target) as (
    ...args: unknown[]
  ) => unknown;
  target.query = ((...args: unknown[]) => {
    if (!queryObserver) return originalQuery(...args);
    const start = process.hrtime.bigint();
    const first = args[0];
    const sql =
      typeof first === 'string'
        ? first
        : ((first as { text?: string } | undefined)?.text ?? '');
    const result = originalQuery(...args);
    if (result instanceof Promise) {
      return result.finally(() => {
        queryObserver?.(Number(process.hrtime.bigint() - start) / 1e6, sql);
      });
    }
    return result;
  }) as Pool['query'];
}

export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL no está definida');
    }
    pool = new Pool({ connectionString: url });
    instrumentPool(pool);
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
