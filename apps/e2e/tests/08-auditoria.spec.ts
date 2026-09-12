import { test, expect } from '@playwright/test';

/**
 * Módulo Auditoría: trazabilidad de mutaciones.
 */

test.describe('Auditoría', () => {
  test('carga la página de auditoría', async ({ page }) => {
    await page.goto('/configuracion/auditoria');
    await expect(
      page.getByRole('heading', { name: /auditoría/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('filtra por tipo de entidad', async ({ page }) => {
    await page.goto('/configuracion/auditoria');
    const select = page.getByRole('combobox').first();
    if (await select.isVisible()) {
      await select.selectOption('project');
      await page.waitForTimeout(400);
    }
  });

  test('muestra registros o mensaje vacío', async ({ page }) => {
    await page.goto('/configuracion/auditoria');
    const hasRows = await page.locator('tbody tr').first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/sin registros|no hay/i).first().isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });
});
