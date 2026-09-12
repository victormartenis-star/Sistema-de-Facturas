import { test, expect } from '@playwright/test';

/**
 * Módulo Tesorería: gráfico cashflow y calendario de vencimientos.
 */

test.describe('Tesorería', () => {
  test('carga la página de tesorería', async ({ page }) => {
    await page.goto('/tesoreria');
    await expect(
      page.getByRole('heading', { name: /tesorería/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('muestra la sección de flujo de caja', async ({ page }) => {
    await page.goto('/tesoreria');
    await expect(
      page.getByText(/flujo de caja|cashflow/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('cambia la agrupación del gráfico entre semana y mes', async ({ page }) => {
    await page.goto('/tesoreria');

    const btnMes = page.getByRole('button', { name: /meses/i });
    if (await btnMes.isVisible()) {
      await btnMes.click();
      await expect(btnMes).toHaveClass(/bg-amber|active|selected/);
      await page.getByRole('button', { name: /semanas/i }).click();
    }
  });

  test('muestra el calendario de vencimientos', async ({ page }) => {
    await page.goto('/tesoreria');
    await expect(
      page.getByText(/vencimientos/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });
});
