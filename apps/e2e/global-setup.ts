import { execSync } from 'node:child_process';

/**
 * Se ejecuta una vez antes de toda la suite E2E, después de que `webServer`
 * (ver `playwright.config.ts`) confirme que la API está arriba: Playwright
 * arranca los plugins de `webServer` antes que `globalSetup`, así que la API
 * ya es alcanzable aquí, tanto en CI (arrancada por `webServer`) como en
 * local (arrancada a mano con `npm run dev:api`).
 *
 * Delega en `npm run seed:e2e` en vez de reimplementar el seed aquí: un solo
 * sitio de verdad para los datos de prueba, se pueda invocar solo o desde
 * Playwright. Es idempotente — seguro de ejecutar en cada run de la suite.
 */
export default function globalSetup(): void {
  execSync('npm run seed:e2e', { stdio: 'inherit', cwd: __dirname });
}
