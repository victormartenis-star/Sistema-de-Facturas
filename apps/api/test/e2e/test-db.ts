/**
 * Constantes de la base de datos de pruebas de integración. Un fichero
 * aparte (sin importar nada de Nest/Drizzle) para que tanto el
 * `globalSetup` de Jest (proceso separado, fuera de los workers) como el
 * `setupFiles` de cada worker y los propios specs vean exactamente los
 * mismos valores.
 *
 * `erp_test` es una base de datos propia, distinta de `erp_dev` (la de
 * desarrollo) — nunca se leen ni se escriben los datos de desarrollo desde
 * estos tests. Mismo usuario `erp`/`erp` que documenta `CLAUDE.md` para
 * Postgres nativo (con privilegio `CREATEDB`, ver `infra/bd.ps1`).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/erp_test';

/** Base de datos de mantenimiento contra la que se comprueba/crea `erp_test`. */
export const TEST_DATABASE_ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ??
  'postgres://erp:erp@localhost:5432/postgres';

export const TEST_DATABASE_NAME = 'erp_test';

/** Secreto de JWT de pruebas — 32+ caracteres, nunca el de producción. */
export const TEST_JWT_SECRET =
  'secreto-de-pruebas-de-integracion-no-usar-en-produccion-1234';
