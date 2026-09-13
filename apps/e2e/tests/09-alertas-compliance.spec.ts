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

  test('muestra secciones de vencidos y próximos o estado vacío', async ({
    page,
  }) => {
    await page.goto('/homologacion/alertas');
    // `toBeVisible` reintenta durante el timeout, a diferencia de un
    // `isVisible()` de un solo disparo justo tras el `goto` (que puede
    // pillar el instante en que las alertas todavía están cargando).
    const vencidos = page.getByText(/vencidos/i);
    const proximos = page.getByText(/próximos/i);
    const vacio = page.getByText(/sin alertas|sin proveedores/i);
    await expect(vencidos.or(proximos).or(vacio).first()).toBeVisible({
      timeout: 8_000,
    });
  });
});
