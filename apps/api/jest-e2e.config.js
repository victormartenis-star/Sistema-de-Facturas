/**
 * Config de Jest para las pruebas de integración HTTP de `apps/api`
 * (`test/e2e/*.e2e-spec.ts`, Supertest contra una `INestApplication` real).
 * Deliberadamente aparte de cualquier config de unit tests: hoy no hay
 * ninguna (ver `packages/shared`, que usa vitest) — si en el futuro se
 * añaden unit tests de NestJS con Jest, van en otro `testMatch`, no aquí.
 *
 * `globalSetup` prepara `erp_test` (crea + migra) una vez, fuera de los
 * workers; `setupFiles` fija las variables de entorno (`DATABASE_URL` a
 * `erp_test`, `JWT_SECRET` de pruebas) en cada worker antes de que se
 * importe el fichero de test. Ver `test/e2e/test-db.ts`.
 */
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'api:integration',
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.e2e-spec\\.ts$',
  // `<rootDir>` completo (no solo `test/e2e`): `collectCoverageFrom` busca
  // ficheros dentro de `roots`, así que restringirlo a `test/e2e` dejaba
  // fuera todo `src/` y el informe de cobertura solo veía los módulos que
  // alguna importación tocaba — nunca los que ningún test ejercita, que es
  // justo el dato honesto que hace falta para fijar el umbral con cabeza.
  roots: ['<rootDir>'],
  // Solo `.ts`: `@erp/db`/`@erp/shared` se consumen ya compilados
  // (`dist/*.js`, CommonJS) — no hace falta, y con npm workspaces en
  // symlink Jest los ve por su ruta real (`packages/*/dist/...`), fuera
  // del `transformIgnorePatterns` por defecto, así que si el patrón
  // incluyera `.js` ts-jest intentaría "compilarlos" igualmente.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  setupFiles: ['<rootDir>/test/e2e/jest.setup-env.ts'],
  testTimeout: 30_000,
  // Un solo worker: todos los specs comparten `erp_test` y hacen TRUNCATE
  // entre tests (`reset-db.ts`) — en paralelo se pisarían entre sí.
  maxWorkers: 1,
  collectCoverage: false,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // `src/modules/proveedores` fuera: bloqueante externo (ver
  // `tsconfig.test.json`), ni compila hoy — no tiene sentido pedirle
  // cobertura. `test/` fuera: es la suite en sí, no código de producción.
  collectCoverageFrom: ['src/**/*.ts', '!src/modules/proveedores/**'],
  // Umbral real y medido, no el 75 % pedido a ciegas (Fase 9) ni de un
  // salto (Fase 10). Con `auth`, `invoices`, `certifications`,
  // `comparativos`, `partes-diarios` y `cost-control` cubiertos — ya no
  // son 3 flujos, pero siguen siendo menos de la mitad de los ~24
  // controladores de la API — un 75 % global sigue siendo imposible sin
  // inflar el número. Medido en vivo el 14-sep-2026 (Fase 10, con las
  // specs nuevas): statements 37.71 %, branches 19.43 %, functions
  // 35.5 %, lines 37.34 % (subida real desde el 25.1/10.72/23.02/24.5 %
  // de la Fase 9). El umbral de abajo se fija un poco por debajo de eso
  // (margen de estabilidad) para no romper `verify` por una variación
  // mínima entre ejecuciones — el detalle exacto de qué SÍ y qué NO está
  // cubierto vive en «Estrategia de Testing y Calidad.md»; este es el
  // suelo de hoy, pensado para seguir subiendo, no para quedarse aquí.
  coverageThreshold: {
    global: {
      statements: 34,
      branches: 16,
      functions: 30,
      lines: 34,
    },
  },
};
