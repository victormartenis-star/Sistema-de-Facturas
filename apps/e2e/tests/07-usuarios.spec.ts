import { test, expect } from '@playwright/test';

/**
 * Módulo Usuarios: gestión de accesos y roles.
 */

test.describe('Usuarios', () => {
  test('carga la página de usuarios', async ({ page }) => {
    await page.goto('/configuracion/usuarios');
    await expect(
      page.getByRole('heading', { name: /usuarios/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('abre el modal de nuevo usuario y lo cierra', async ({ page }) => {
    await page.goto('/configuracion/usuarios');
    await page.getByRole('button', { name: /nuevo usuario/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /cancelar/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('muestra la leyenda de roles', async ({ page }) => {
    await page.goto('/configuracion/usuarios');
    await expect(
      page.getByText(/administrador|gerente|obra/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });
});
