import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de tests E2E para el ERP Dintel.
 *
 * Requiere que la API (puerto 3001) y la web (puerto 3000) estén en marcha.
 * En CI se arrancan automáticamente vía webServer.
 */
export default defineConfig({
  testDir: './tests',
  /* Timeout por test */
  timeout: 30_000,
  /* Fallo en el primer test fallido del fichero */
  fullyParallel: false,
  /* Reintentos en CI */
  retries: process.env.CI ? 2 : 0,
  /* Paralelismo: 1 worker en CI para no competir con la API/web */
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    /* Contexto sin caché entre tests */
    storageState: undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    /* Setup: login y guarda storageState para los demás */
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  /* En local no arrancamos servidores automáticamente (ya deben estar corriendo). */
  // webServer: [...],
});
