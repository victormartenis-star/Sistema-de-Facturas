import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `treasury` (Fase 11, cierre de cobertura): los vencimientos
 * (`payment_milestones`) los genera `InvoicesService.approve()`, no
 * `treasury` — así que estos tests montan una factura de venta real
 * (aprobada) y ejercitan el calendario, el cashflow y pagar/reabrir sobre
 * los vencimientos que esa aprobación deja.
 */
describe('Treasury (integración) — vencimientos y cashflow', () => {
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

  async function approvedVentaInvoice(
    token: string,
    contactId: string,
    projectId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId,
        invoiceNumber: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        lines: [
          {
            description: 'Certificación mensual',
            baseAmount: 1000,
            vatPct: 21,
            projectId,
          },
        ],
        ...overrides,
      })
      .expect(201);
    const invoiceId = res.body.id as string;
    await authed(app, token).post(`/invoices/${invoiceId}/aprobar`).expect(201);
    return invoiceId;
  }

  it('GET /treasury/milestones lista el vencimiento de cobro que deja una factura de venta aprobada', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const cliente = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    const invoiceId = await approvedVentaInvoice(
      admin.accessToken,
      cliente.id,
      project.id,
    );

    const res = await authed(app, admin.accessToken)
      .get('/treasury/milestones')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      invoiceId,
      direction: 'cobro',
      status: 'previsto',
      dueDate: '2026-10-14',
    });

    const filtered = await authed(app, admin.accessToken)
      .get('/treasury/milestones?direction=pago')
      .expect(200);
    expect(filtered.body).toEqual([]);
  });

  it('pagar un vencimiento lo marca `pagado` y liquida la factura; reabrirlo la devuelve a `aprobada`', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const cliente = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    const invoiceId = await approvedVentaInvoice(
      admin.accessToken,
      cliente.id,
      project.id,
    );
    const [milestone] = (
      await authed(app, admin.accessToken).get('/treasury/milestones')
    ).body;

    await authed(app, admin.accessToken)
      .post(`/treasury/milestones/${milestone.id}/pagar`)
      .expect(204);
    const afterPay = await authed(app, admin.accessToken)
      .get('/treasury/milestones?status=pagado')
      .expect(200);
    expect(afterPay.body[0].status).toBe('pagado');
    const invoiceAfterPay = await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}`)
      .expect(200);
    expect(invoiceAfterPay.body.status).toBe('pagada');

    await authed(app, admin.accessToken)
      .post(`/treasury/milestones/${milestone.id}/reabrir`)
      .expect(204);
    const invoiceAfterReopen = await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}`)
      .expect(200);
    expect(invoiceAfterReopen.body.status).toBe('aprobada');
  });

  it('rechaza con 409 pagar un vencimiento que ya está pagado', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const cliente = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    await approvedVentaInvoice(admin.accessToken, cliente.id, project.id);
    const [milestone] = (
      await authed(app, admin.accessToken).get('/treasury/milestones')
    ).body;
    await authed(app, admin.accessToken)
      .post(`/treasury/milestones/${milestone.id}/pagar`)
      .expect(204);

    await authed(app, admin.accessToken)
      .post(`/treasury/milestones/${milestone.id}/pagar`)
      .expect(409);
  });

  it('GET /treasury/cashflow agrupa el vencimiento previsto en su semana y no hay tensión con un único cobro', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const cliente = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    await approvedVentaInvoice(admin.accessToken, cliente.id, project.id, {
      dueDate: '2026-09-20',
    });

    const res = await authed(app, admin.accessToken)
      .get('/treasury/cashflow?from=2026-09-14&to=2026-09-27&groupBy=semana')
      .expect(200);

    expect(res.body.totalCobros).toBeGreaterThan(0);
    expect(res.body.alertas).toBe(0);
    const bucketWithCobro = res.body.buckets.find((b: any) => b.cobros > 0);
    expect(bucketWithCobro).toBeDefined();
    expect(bucketWithCobro.tension).toBe(false);
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/treasury/milestones').expect(401);
  });
});
