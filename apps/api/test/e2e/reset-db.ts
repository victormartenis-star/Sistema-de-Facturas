/**
 * Aislamiento entre tests: no hay rollback transaccional (`DbService`/
 * `getDb()` usan un pool y una conexión por consulta, no una transacción
 * por test — cambiar eso es un rediseño de arquitectura que no toca esta
 * tarea), así que el aislamiento real es un `TRUNCATE` de todas las tablas
 * de negocio antes de cada test, sobre `erp_test` (nunca `erp_dev`).
 * Determinista: cada test arranca con la base vacía, sin depender del
 * orden en que Jest ejecute los ficheros ni los `it` dentro de cada uno.
 */
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { companies, getDb, schema } from '@erp/db';

// `Object.values(schema)` mezcla tablas con literales de tipo distintos
// (cada `PgTableWithColumns<{name: "invoices"; ...}>` es un tipo propio),
// así que un predicado de tipo `(v): v is PgTable` no encaja bien contra
// esa unión heterogénea. Filtramos sin narrowing y casteamos en el `map`
// en su lugar — el `is()` en tiempo de ejecución hace el trabajo real.
const ALL_TABLE_NAMES: string[] = Object.values(
  schema as Record<string, unknown>,
)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table as PgTable));

/**
 * `companies` se deja fuera del `TRUNCATE` por defecto: `DbService` cachea
 * `defaultCompanyId` en memoria durante toda la vida de la app de pruebas
 * (`beforeAll`, una `INestApplication` por fichero) — si `resetTestDb()`
 * también vaciara `companies`, esa caché quedaría apuntando a un id que ya
 * no existe y el primer `POST /auth/register` de cada test siguiente
 * fallaría con una violación de clave foránea real (así se descubrió: no
 * es una suposición). `seedCompany()` se llama una sola vez por fichero,
 * en `beforeAll`, no en cada `beforeEach`.
 */
const DEFAULT_KEEP = new Set(['companies']);

/** Vacía las tablas de negocio de `erp_test` (identidades reiniciadas, en cascada). */
export async function resetTestDb(
  keep: Set<string> = DEFAULT_KEEP,
): Promise<void> {
  const tableNames = ALL_TABLE_NAMES.filter((name) => !keep.has(name));
  if (tableNames.length === 0) return;
  const db = getDb();
  const identifiers = tableNames.map((name) => `"${name}"`).join(', ');
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`),
  );
}

/**
 * Bootstrap mínimo: una empresa. Igual que `packages/db/src/seed.ts` — no
 * hay ningún endpoint HTTP para crear la primera empresa (MVP monoempresa,
 * `AuthService.register()` exige que ya exista una), así que este es el
 * único sitio de estos tests que escribe en la base de datos sin pasar por
 * la API, y solo esto: el resto de fixtures (usuarios, obras, contactos,
 * facturas...) se crean con peticiones HTTP reales, igual que
 * `apps/e2e/seed.ts` y el servidor MCP. Se llama una sola vez por fichero
 * de test, en `beforeAll` — ver el comentario de `resetTestDb()`.
 */
export async function seedCompany(): Promise<string> {
  const db = getDb();
  const [company] = await db
    .insert(companies)
    .values({ name: 'Empresa de Pruebas de Integración', taxId: 'B00000000' })
    .returning();
  return company.id;
}
