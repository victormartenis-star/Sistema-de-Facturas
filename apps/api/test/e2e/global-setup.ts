/**
 * `globalSetup` de Jest: corre una sola vez, en un proceso aparte de los
 * workers que ejecutan los specs, antes de que arranque ningún test.
 * Deja `erp_test` lista para usarse: la crea si no existe (mismo criterio
 * de collation determinista que `erp_dev`, ver `infra/bd.ps1`) y le aplica
 * las migraciones de Drizzle si le faltan alguna — así la suite es
 * autocontenida desde un checkout limpio, sin depender de que alguien haya
 * corrido `drizzle-kit migrate` a mano contra esta base de datos primero.
 *
 * Usa el migrador programático de `drizzle-orm` (no la CLI de
 * `drizzle-kit`) para no depender de invocar un subproceso.
 */
import { resolve } from 'node:path';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  TEST_DATABASE_ADMIN_URL,
  TEST_DATABASE_NAME,
  TEST_DATABASE_URL,
} from './test-db';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../packages/db/drizzle');

async function ensureDatabaseExists(): Promise<void> {
  const admin = new Client({ connectionString: TEST_DATABASE_ADMIN_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DATABASE_NAME],
    );
    if (rowCount === 0) {
      // No se puede parametrizar el nombre de una base en CREATE DATABASE;
      // es una constante fija de este fichero, no entrada de usuario.
      await admin.query(
        `CREATE DATABASE ${TEST_DATABASE_NAME} OWNER erp ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
      );
    }
  } finally {
    await admin.end();
  }
}

async function applyMigrations(): Promise<void> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

export default async function globalSetup(): Promise<void> {
  await ensureDatabaseExists();
  await applyMigrations();
}
