import { test, expect } from '@playwright/test';

/**
 * Módulo Obras: CRUD básico y navegación a ficha de obra.
 */

test.describe('Obras', () => {
  test('lista obras existentes', async ({ page }) => {
    await page.goto('/obras');
    // La página debe cargar (con o sin obras)
    await expect(
      page.getByRole('heading', { name: /obras/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('abre el modal de nueva obra y lo cierra', async ({ page }) => {
    await page.goto('/obras');
    await page.getByRole('button', { name: /nueva obra/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Cierra con el botón Cancelar
    await page.getByRole('button', { name: /cancelar/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('crea una obra y aparece en la lista', async ({ page }) => {
    await page.goto('/obras');

    const code = `TEST-${Date.now()}`;

    await page.getByRole('button', { name: /nueva obra/i }).click();
    await page.getByLabel(/código/i).fill(code);
    await page.getByLabel(/nombre/i).fill('Obra E2E Test');
    await page.getByLabel(/contrato|importe/i).first().fill('50000');

    await page.getByRole('button', { name: /crear|guardar/i }).click();

    // La obra debe aparecer en la lista
    await expect(page.getByText(code)).toBeVisible({ timeout: 8_000 });
  });

  test('navega a la ficha de una obra', async ({ page }) => {
    await page.goto('/obras');

    // Hace click en la primera obra de la lista
    const firstLink = page.getByRole('link').filter({ hasText: /TEST-|E2E/ }).first();
    if (await firstLink.isVisible()) {
      await firstLink.click();
      await expect(page).toHaveURL(/\/obras\/.+/);
      await expect(
        page.getByText(/desvío|presupuesto|fases/i).first(),
      ).toBeVisible({ timeout: 8_000 });
    }
  });
});
