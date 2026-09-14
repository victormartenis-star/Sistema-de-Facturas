import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, invoices } from '@erp/db';
import { authed, createContact, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `GET /invoices/:id/facturae` y la persistencia de la huella VeriFactu
 * (Fase 11) — ver `apps/api/src/invoices/facturae.service.ts` y
 * [[Módulo Facturación]] en Obsidian para el porqué del cacheo.
 */
describe('Facturae / VeriFactu (integración) — huella persistida', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  /** Crea, y opcionalmente aprueba, una factura de venta lista para Facturae. */
  async function createVentaInvoice(
    token: string,
    contactId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId,
        invoiceNumber: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'Certificación mensual',
            baseAmount: 1000,
            vatPct: 21,
          },
        ],
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await authed(app, token).post(`/invoices/${id}/aprobar`).expect(201);
    return id;
  }

  it('genera el XML y persiste hash/previousHash/generatedAt en la factura', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B11111111',
    });
    const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);

    const res = await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}/facturae`)
      .expect(200);
    expect(res.text).toContain('<?xml');
    expect(res.headers['content-type']).toContain('xml');

    const db = getDb();
    const [row] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(row.verifactuHash).not.toBeNull();
    expect(row.verifactuHash).toHaveLength(64); // SHA-256 en hex
    expect(row.verifactuPreviousHash).toBe(''); // primera factura de la empresa: genesis
    expect(row.verifactuGeneratedAt).not.toBeNull();
  });

  it('encadena correctamente: la 2ª factura usa el hash persistido de la 1ª como previousHash', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B22222222',
    });
    const firstId = await createVentaInvoice(admin.accessToken, contact.id, {
      issueDate: '2026-09-10',
    });
    const secondId = await createVentaInvoice(admin.accessToken, contact.id, {
      issueDate: '2026-09-12',
    });

    // Generar solo la 2ª: debe recorrer la 1ª (sin huella todavía), calcularla
    // y persistirla, y encadenar la 2ª a partir de ahí.
    await authed(app, admin.accessToken)
      .get(`/invoices/${secondId}/facturae`)
      .expect(200);

    const db = getDb();
    const [first] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, firstId));
    const [second] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, secondId));

    expect(first.verifactuHash).not.toBeNull();
    expect(second.verifactuPreviousHash).toBe(first.verifactuHash);
  });

  it('reutiliza el hash ya persistido de una factura sin recalcularlo (misma huella en dos peticiones)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B33333333',
    });
    const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);

    await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}/facturae`)
      .expect(200);
    const db = getDb();
    const [afterFirst] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId));

    // Segunda petición: el hash persistido debe reutilizarse tal cual, no
    // recalcularse a partir de un `generatedAt` distinto.
    await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}/facturae`)
      .expect(200);
    const [afterSecond] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId));

    expect(afterSecond.verifactuHash).toBe(afterFirst.verifactuHash);
    expect(afterSecond.verifactuGeneratedAt?.toISOString()).toBe(
      afterFirst.verifactuGeneratedAt?.toISOString(),
    );
  });

  it('rechaza Facturae de una factura de compra', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      taxId: 'B44444444',
    });
    const res = await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: contact.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [{ description: 'Material', baseAmount: 500, vatPct: 21 }],
      })
      .expect(201);
    await authed(app, admin.accessToken)
      .get(`/invoices/${(res.body as { id: string }).id}/facturae`)
      .expect(400);
  });

  it('rechaza Facturae de una factura en borrador (sin aprobar)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B55555555',
    });
    const res = await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: contact.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [{ description: 'Certificación', baseAmount: 500, vatPct: 21 }],
      })
      .expect(201);
    await authed(app, admin.accessToken)
      .get(`/invoices/${(res.body as { id: string }).id}/facturae`)
      .expect(400);
  });
});
