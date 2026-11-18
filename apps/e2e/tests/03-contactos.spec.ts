import { test, expect } from '@playwright/test';

/**
 * Módulo Contactos / Proveedores.
 */

test.describe('Contactos', () => {
  test('lista contactos', async ({ page }) => {
    await page.goto('/contactos');
    await expect(page.getByRole('heading', { name: /contactos/i })).toBeVisible(
      { timeout: 8_000 },
    );
  });

  test('busca un contacto por texto', async ({ page }) => {
    await page.goto('/contactos');
    const searchBox = page.getByPlaceholder('Buscar por nombre o NIF');
    await expect(searchBox).toBeVisible({ timeout: 8_000 });
    await searchBox.fill('test');
    // El valor se aplica; la lista puede quedar vacía, no es lo que se valida aquí.
    await expect(searchBox).toHaveValue('test');
  });

  test('abre modal de nuevo contacto y lo cierra', async ({ page }) => {
    await page.goto('/contactos');
    await page.getByRole('button', { name: /nuevo contacto|añadir/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /cancelar/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});
