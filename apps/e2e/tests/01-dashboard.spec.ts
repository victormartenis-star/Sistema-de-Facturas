import { test, expect } from '@playwright/test';

/**
 * Panel principal: verifica que los KPI cards se cargan
 * y que la navegación básica funciona.
 */

test.describe('Panel principal', () => {
  test('carga el panel y muestra KPIs', async ({ page }) => {
    await page.goto('/');

    // Al menos un bloque de KPI debe estar visible
    await expect(
      page.getByText(/obras en curso|contratado|certificado/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('la navegación del sidebar funciona', async ({ page }) => {
    await page.goto('/');

    // Click en Obras
    await page.getByRole('link', { name: /obras/i }).first().click();
    await expect(page).toHaveURL(/\/obras/);

    // Click en Facturas
    await page.getByRole('link', { name: /facturas/i }).first().click();
    await expect(page).toHaveURL(/\/facturas/);
  });

  test('el sidebar tiene los enlaces de configuración', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: /auditoría/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /usuarios/i }),
    ).toBeVisible();
  });
});
