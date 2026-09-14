import { test, expect } from '@playwright/test';

/**
 * Flujo de autenticación (Fase 9). Distinto de `auth.setup.ts`: aquel es un
 * paso de *setup* que guarda sesión para el resto de specs; este es un
 * spec normal que ejercita el formulario de login de verdad — mismo
 * patrón que `smoke.spec.ts` (contexto sin sesión vía `test.use`).
 */

const ADMIN_EMAIL = process.env.E2E_EMAIL ?? 'test@dintel.es';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'Test1234!';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Autenticación', () => {
  test('login correcto redirige al panel principal', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/contraseña/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|iniciar sesión/i }).click();

    await expect(page).toHaveURL('/', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /panel/i })).toBeVisible({
      timeout: 8_000,
    });
  });

  test('credenciales incorrectas muestran un error y no redirigen', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/contraseña/i).fill('ContraseñaIncorrecta1234!');
    await page.getByRole('button', { name: /entrar|iniciar sesión/i }).click();

    // Se queda en /login y muestra algún mensaje de error.
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByText(/incorrect|no válid|error/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('una ruta protegida sin sesión redirige a /login con `next`', async ({
    page,
  }) => {
    await page.goto('/obras');
    await expect(page).toHaveURL(/\/login\?next=%2Fobras/, {
      timeout: 8_000,
    });
  });
});
