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
