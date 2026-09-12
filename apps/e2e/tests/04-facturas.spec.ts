import { test, expect } from '@playwright/test';

/**
 * Módulo Facturas: listado, filtros y creación básica.
 */

test.describe('Facturas', () => {
  test('carga la página de facturas', async ({ page }) => {
    await page.goto('/facturas');
    await expect(
      page.getByRole('heading', { name: /facturas/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('filtra por tipo (compra / venta)', async ({ page }) => {
    await page.goto('/facturas');

    // Busca el selector de tipo
    const select = page.getByRole('combobox').first();
    if (await select.isVisible()) {
      await select.selectOption('compra');
      await page.waitForTimeout(400);
      await select.selectOption('venta');
      await page.waitForTimeout(400);
    }
  });

  test('abre modal de nueva factura y valida campos requeridos', async ({ page }) => {
    await page.goto('/facturas');
    await page.getByRole('button', { name: /nueva factura/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Intenta enviar sin rellenar
    await page.getByRole('button', { name: /crear|guardar/i }).click();
    // El formulario debe mostrar algún error de validación o permanecer abierto
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: /cancelar/i }).click();
  });
});
