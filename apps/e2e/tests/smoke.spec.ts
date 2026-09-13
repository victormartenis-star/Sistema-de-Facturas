import { test, expect, type Page } from '@playwright/test';

/**
 * Test de humo: el camino crítico de extremo a extremo.
 *
 * A diferencia del resto de specs, no reutiliza el `storageState` que deja
 * `auth.setup.ts` (esa sesión ya viene con el login hecho): aquí se ejercita
 * el propio formulario de login, con los dos roles que más importan para el
 * RBAC por obra. Por eso fuerza un contexto sin sesión con `test.use`.
 *
 * Usuarios: el admin lo crea `apps/e2e/seed.ts` si no existe (mismas
 * credenciales que `auth.setup.ts`); `obra@e2e.dintel.es` lo crea el mismo
 * seed con acceso a una sola obra.
 */

const ADMIN_EMAIL = process.env.E2E_EMAIL ?? 'test@dintel.es';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'Test1234!';
const OBRA_EMAIL = 'obra@e2e.dintel.es';
const OBRA_PASSWORD = 'Test1234!';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

test.use({ storageState: { cookies: [], origins: [] } });

async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/contraseña/i).fill(password);
  await page.getByRole('button', { name: /entrar|iniciar sesión/i }).click();
  await expect(page).toHaveURL('/', { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /panel/i })).toBeVisible({
    timeout: 8_000,
  });
}

test.describe('Humo: camino crítico', () => {
  test('el admin inicia sesión y llega al panel', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('el usuario obra inicia sesión y llega al panel', async ({ page }) => {
    await login(page, OBRA_EMAIL, OBRA_PASSWORD);
  });

  test('GET /invoices/:id/facturae responde XML', async ({ page, request }) => {
    // El token viaja en localStorage (`erp.accessToken`, ver
    // `apps/web/src/lib/api.ts`); se reutiliza la sesión ya iniciada en vez
    // de duplicar la lógica de login contra la API.
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const accessToken = await page.evaluate(() =>
      localStorage.getItem('erp.accessToken'),
    );
    expect(
      accessToken,
      'debería haber un access token tras el login',
    ).toBeTruthy();

    const invoicesRes = await request.get(`${API_URL}/invoices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(invoicesRes.ok()).toBe(true);
    const invoices = (await invoicesRes.json()) as {
      id: string;
      invoiceNumber: string;
    }[];

    // Sembrada por `apps/e2e/seed.ts`: factura de venta ya aprobada.
    const invoice = invoices.find((i) => i.invoiceNumber === 'V-E2E-0001');
    expect(
      invoice,
      'la factura V-E2E-0001 debería existir (la crea apps/e2e/seed.ts)',
    ).toBeTruthy();

    const facturaeRes = await request.get(
      `${API_URL}/invoices/${invoice!.id}/facturae`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(facturaeRes.status()).toBe(200);
    expect(facturaeRes.headers()['content-type']).toContain('application/xml');
    expect(await facturaeRes.text()).toContain('<?xml version="1.0"');
  });
});
