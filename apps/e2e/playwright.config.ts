import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de tests E2E para el ERP Dintel.
 *
 * En local: la API (puerto 3001) y la web (puerto 3000) deben estar ya en
 * marcha (`npm run dev:api` / `npm run dev:web`) — no se arrancan solas para
 * no interferir con el hot-reload de una sesión de desarrollo activa.
 *
 * En CI (`process.env.CI`): `webServer` compila y arranca ambas por su cuenta,
 * ya que no hay ningún servidor previo. Requiere `npm run build:packages`
 * previo (paquetes compartidos) y una base de datos migrada
 * (`npm run db:migrate && npm run db:seed`).
 *
 * `globalSetup` puebla los datos de prueba (`npm run seed:e2e`, ver
 * `seed.ts`) después de que `webServer` confirme que la API está arriba —
 * incluido el usuario `E2E_EMAIL` / `E2E_PASSWORD` que usa
 * `tests/auth.setup.ts`, que hasta ahora había que crear a mano.
 *
 * Dos navegadores (Fase 9, 14-sep-2026): `chromium` y `firefox`, ambos
 * dependientes del mismo `setup` — el `storageState` que guarda
 * `auth.setup.ts` es JSON portable (cookies/localStorage del origen), no
 * específico de un motor, así que un solo login sirve para los dos.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./global-setup'),
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
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  /* En local no arrancamos servidores automáticamente (ya deben estar corriendo). */
  webServer: process.env.CI
    ? [
        {
          command: 'npm run build -w @erp/api && npm run start -w @erp/api',
          port: 3001,
          reuseExistingServer: false,
          // El runner de CI es más lento y variable que un portátil: margen
          // amplio para que un `tsc` frío no dispare un fallo por timeout.
          timeout: 180_000,
        },
        {
          command: 'npm run build -w @erp/web && npm run start -w @erp/web',
          port: 3000,
          reuseExistingServer: false,
          // El build de Next.js es el más lento de los dos arranques.
          timeout: 180_000,
        },
      ]
    : undefined,
});
