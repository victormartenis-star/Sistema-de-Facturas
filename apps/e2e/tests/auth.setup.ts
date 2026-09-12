import { test as setup, expect } from '@playwright/test';
import path from 'path';

/**
 * Setup global: hace login y guarda el storageState (cookies/localStorage)
 * para que los tests no tengan que autenticarse cada vez.
 */

const AUTH_FILE = path.join(__dirname, '../.auth/user.json');

setup('autenticar usuario de prueba', async ({ page }) => {
  await page.goto('/login');

  // Rellena el formulario de login
  await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? 'test@dintel.es');
  await page.getByLabel(/contraseña/i).fill(process.env.E2E_PASSWORD ?? 'Test1234!');
  await page.getByRole('button', { name: /entrar|iniciar sesión/i }).click();

  // Espera a estar en el panel principal
  await expect(page).toHaveURL('/', { timeout: 10_000 });
  await expect(page.getByText(/panel|dashboard/i).first()).toBeVisible();

  // Guarda el estado de autenticación
  await page.context().storageState({ path: AUTH_FILE });
});
