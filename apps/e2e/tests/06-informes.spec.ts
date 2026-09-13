import { test, expect } from '@playwright/test';

/**
 * Módulo Informes: KPIs por obra y gráficos.
 */

test.describe('Informes', () => {
  test('carga la página de informes', async ({ page }) => {
    await page.goto('/informes');
    await expect(page.getByRole('heading', { name: /informes/i })).toBeVisible({
      timeout: 8_000,
    });
  });

  test('muestra KPI cards o mensaje vacío', async ({ page }) => {
    await page.goto('/informes');
    // Con datos: KPI cards. Sin datos: mensaje explicativo. Se espera con
    // `toBeVisible` (reintenta) en vez de un `isVisible()` de un solo
    // disparo: justo tras el `goto` los KPIs todavía pueden estar
    // cargando y ninguno de los dos textos está aún en pantalla.
    const kpis = page.getByText(/obras en curso|contratado/i).first();
    const empty = page.getByText(/sin obras|crea una obra/i).first();
    await expect(kpis.or(empty)).toBeVisible({ timeout: 8_000 });
  });

  test('enlace de fila de tabla navega a ficha de obra', async ({ page }) => {
    await page.goto('/informes');
    const firstObra = page.locator('tbody tr a').first();
    if (await firstObra.isVisible()) {
      await firstObra.click();
      await expect(page).toHaveURL(/\/obras\/.+/);
    }
  });
});
