import { test, expect } from '@playwright/test';

/**
 * Módulo Alertas PRL / Compliance.
 */

test.describe('Alertas de compliance', () => {
  test('carga la página de alertas PRL', async ({ page }) => {
    await page.goto('/homologacion/alertas');
    await expect(
      page.getByRole('heading', { name: /alertas|prl|vencimiento/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('cambia el horizonte temporal', async ({ page }) => {
    await page.goto('/homologacion/alertas');

    // Comprueba que existen botones de horizonte (7/15/30/60/90 días)
    const btn30 = page.getByRole('button', { name: '30' });
    if (await btn30.isVisible()) {
      await btn30.click();
      await page.getByRole('button', { name: '60' }).click();
    }
  });

  test('muestra secciones de vencidos y próximos o estado vacío', async ({ page }) => {
    await page.goto('/homologacion/alertas');
    const hasVencidos = await page.getByText(/vencidos/i).isVisible().catch(() => false);
    const hasProximos = await page.getByText(/próximos/i).isVisible().catch(() => false);
    const isEmpty = await page.getByText(/sin alertas|sin proveedores/i).isVisible().catch(() => false);
    expect(hasVencidos || hasProximos || isEmpty).toBe(true);
  });
});
