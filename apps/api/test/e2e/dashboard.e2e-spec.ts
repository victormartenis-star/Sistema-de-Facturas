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

/** `GET /dashboard/resumen` y `GET /dashboard/obras` (Fase 11, cierre de cobertura). */
describe('Dashboard (integración) — KPIs globales y por obra', () => {
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

  it('GET /dashboard/resumen devuelve todo a cero sin datos', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .get('/dashboard/resumen')
      .expect(200);

    expect(res.body).toEqual({
      obras: { total: 0, enCurso: 0, contratado: 0 },
      certificaciones: {
        totalCertificado: 0,
        retencionAcumulada: 0,
        certsPendientesFacturar: 0,
      },
      tesoreria: {
        pendienteCobro: 0,
        pendientePago: 0,
        vencidoCobro: 0,
        vencidoPago: 0,
      },
      compras: { pedidosPendientes: 0, importePedidosPendientes: 0 },
      facturas: { ventaBorradores: 0, compraBorradores: 0 },
    });
  });

  it('GET /dashboard/resumen refleja una obra en curso, un pedido pendiente y una factura de venta en borrador', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken, {
      status: 'en_curso',
      contractAmount: 50_000,
    });
    const proveedor = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
    });
    const cliente = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });

    await authed(app, admin.accessToken)
      .post('/purchase-orders')
      .send({
        projectId: project.id,
        contactId: proveedor.id,
        orderDate: '2026-09-14',
        description: 'Suministro de pruebas',
        amount: 2_000,
      })
      .expect(201);
    await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'Certificación mensual',
            baseAmount: 1_000,
            vatPct: 21,
            projectId: project.id,
          },
        ],
      })
      .expect(201);

    const res = await authed(app, admin.accessToken)
      .get('/dashboard/resumen')
      .expect(200);

    expect(res.body.obras).toEqual({
      total: 1,
      enCurso: 1,
      contratado: 50_000,
    });
    expect(res.body.compras).toEqual({
      pedidosPendientes: 1,
      importePedidosPendientes: 2_000,
    });
    expect(res.body.facturas.ventaBorradores).toBe(1);
  });

  it('GET /dashboard/obras devuelve el KPI económico por obra', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken, {
      contractAmount: 10_000,
    });

    const res = await authed(app, admin.accessToken)
      .get('/dashboard/obras')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      projectId: project.id,
      code: project.code,
      contractAmount: 10_000,
      totalCertificado: 0,
      pctCertificado: 0,
      costReal: 0,
      margenBruto: 0,
    });
  });

  it('GET /dashboard/obras: el coste real cuenta compras aprobadas, pagadas y rectificadas, neteando la rectificativa', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const project = await createProject(app, token);
    const proveedor = await createContact(app, token, { kind: 'proveedor' });
    const u = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    /** Compra aprobada con su albarán validado (3-way match). */
    const compra = async (importe: number): Promise<string> => {
      const order = await authed(app, token)
        .post('/purchase-orders')
        .send({
          projectId: project.id,
          contactId: proveedor.id,
          orderDate: '2026-09-14',
          description: 'Suministro',
          amount: importe,
        })
        .expect(201);
      const note = await authed(app, token)
        .post('/delivery-notes')
        .send({
          contactId: proveedor.id,
          orderId: order.body.id,
          noteNumber: `ALB-${u()}`,
          noteDate: '2026-09-14',
          amount: importe,
        })
        .expect(201);
      await authed(app, token)
        .post(`/delivery-notes/${note.body.id}/validar`)
        .expect(201);
      const inv = await authed(app, token)
        .post('/invoices')
        .send({
          kind: 'compra',
          contactId: proveedor.id,
          invoiceNumber: `FC-${u()}`,
          issueDate: '2026-09-14',
          deliveryNoteIds: [note.body.id],
          lines: [
            {
              description: 'Material',
              baseAmount: importe,
              vatPct: 21,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${inv.body.id}/aprobar`)
        .expect(201);
      return inv.body.id as string;
    };

    // 500 rectificada por completo (original rectificada + rectificativa
    // aprobada de −500), 300 pagada y 100 aprobada: coste real = 400.
    const rectificada = await compra(500);
    const rect = await authed(app, token)
      .post(`/invoices/${rectificada}/rectificar`)
      .send({
        clase: 'total',
        rectificationMotive: 'R4',
        rectificationType: 'S',
        issueDate: '2026-10-01',
        motivo: 'Error de importe',
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${rect.body.id}/aprobar`)
      .expect(201);
    const pagada = await compra(300);
    await authed(app, token).post(`/invoices/${pagada}/pagar`).expect(201);
    await compra(100);

    const res = await authed(app, token).get('/dashboard/obras').expect(200);
    expect(res.body[0].costReal).toBe(400);
  });

  it('un usuario de obra sin obras asignadas ve el KPI vacío en /dashboard/obras', async () => {
    const admin = await registerUser(app);
    await createProject(app, admin.accessToken);
    const email = `obra-${Date.now()}@test.dintel.es`;
    await authed(app, admin.accessToken)
      .post('/users')
      .send({
        email,
        password: 'Test1234!',
        fullName: 'Usuario de Obra',
        role: 'obra',
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Test1234!' })
      .expect(200);

    const res = await authed(app, login.body.accessToken)
      .get('/dashboard/obras')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/dashboard/resumen').expect(401);
  });
});
