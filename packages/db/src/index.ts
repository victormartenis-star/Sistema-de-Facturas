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

/**
 * Entero positivo desde el entorno; si falta o no es válido, el valor por
 * defecto. Evita que un `DB_POOL_MAX=abc` deje el pool sin límite.
 */
function entero(variable: string, porDefecto: number): number {
  const valor = Number(process.env[variable]);
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto;
}

export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL no está definida');
    }
    pool = new Pool({
      connectionString: url,
      max: entero('DB_POOL_MAX', 10),
      // Libera conexiones ociosas tras 30 s: el pool no retiene conexiones
      // de más tras picos y Postgres no acumula sesiones muertas.
      idleTimeoutMillis: entero('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
      connectionTimeoutMillis: entero('DB_POOL_CONNECTION_TIMEOUT_MS', 5000),
    });
    // Un error en un cliente inactivo (reinicio de Postgres, corte de red)
    // se emite en el Pool; sin manejador Node lo trata como excepción no
    // capturada y tumba el proceso. El pool descarta ese cliente y abre otro.
    pool.on('error', (err) => {
      console.error('[db] error en un cliente inactivo del pool:', err.message);
    });
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

/** Cliente de transacción de drizzle (el argumento del callback de `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Ejecutor de consultas: la conexión normal o una transacción. Los helpers
 * que deban poder usarse dentro de una transacción reciben un `DbOrTx` y lo
 * usan para TODAS sus lecturas y escrituras (el pool no ve filas sin confirmar).
 */
export type DbOrTx = Db | Tx;

/** Estado del pool de `pg` (para `/health/ready`); `null` si aún no se creó. */
export function getPoolStats(): {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  max: number;
} | null {
  if (!pool) return null;
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    max: pool.options.max ?? 10,
  };
}
