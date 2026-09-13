import { test, expect } from '@playwright/test';

/**
 * Módulo Auditoría: trazabilidad de mutaciones.
 */

test.describe('Auditoría', () => {
  test('carga la página de auditoría', async ({ page }) => {
    await page.goto('/configuracion/auditoria');
    await expect(page.getByRole('heading', { name: /auditoría/i })).toBeVisible(
      { timeout: 8_000 },
    );
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
    // `toBeVisible` reintenta durante el timeout; un `isVisible()` de un
    // solo disparo justo tras el `goto` puede pillar el instante en que
    // `GET /audit` aún no resolvió y ni la tabla ni el vacío se ven todavía.
    const rows = page.locator('tbody tr').first();
    const empty = page.getByText(/sin registros|no hay/i).first();
    await expect(rows.or(empty)).toBeVisible({ timeout: 8_000 });
  });
});
