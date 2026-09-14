/**
 * `setupFiles` de Jest: corre en cada worker, antes de que se importe el
 * fichero de test y antes de cualquier módulo de la app — a diferencia de
 * `globalSetup` (un proceso aparte, una sola vez, sin acceso al `process.env`
 * de los workers), esto sí es visible para `getDb()`/`AuthService` cuando
 * los importe el test. `getDb()` (`packages/db`) lee `DATABASE_URL` de forma
 * perezosa en su primera llamada, así que basta con fijarla aquí antes de
 * que ningún test haga una consulta real.
 */
import { TEST_DATABASE_URL, TEST_JWT_SECRET } from './test-db';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.NODE_ENV = 'test';
