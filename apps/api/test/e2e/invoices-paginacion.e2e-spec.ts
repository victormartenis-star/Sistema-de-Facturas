import { INestApplication } from '@nestjs/common';
import {
  authed,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/** Fase 4, tramo 1: GET /invoices con paginación opt-in y filtro por obra. */
describe('Facturas (integración) — paginación y filtros', () => {
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

  /** 2 compras y 1 venta en la obra A y 2 compras en la B, misma fecha; la venta aprobada. */
  async function escenario() {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const a = await createProject(app, token);
    const b = await createProject(app, token);
    const proveedor = await createContact(app, token, { kind: 'proveedor' });
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const crear = async (n: number, projectId: string, venta = false) => {
      const res = await authed(app, token)
        .post('/invoices')
        .send({
          kind: venta ? 'venta' : 'compra',
          contactId: venta ? cliente.id : proveedor.id,
          ...(venta ? { dueDate: '2026-10-14' } : {}),
          invoiceNumber: `FC-PAG-${n}`,
          issueDate: '2026-09-14',
          lines: [
            { description: 'Material', baseAmount: 100, vatPct: 21, projectId },
          ],
        })
        .expect(201);
      return res.body.id as string;
    };
    const idsA = [
      await crear(1, a.id),
      await crear(2, a.id),
      await crear(3, a.id, true),
    ];
    await crear(4, b.id);
    await crear(5, b.id);
    await authed(app, token).post(`/invoices/${idsA[2]}/aprobar`).expect(201);
    return { token, a, b };
  }

  it('sin page devuelve el array de siempre', async () => {
    const { token } = await escenario();
    const res = await authed(app, token).get('/invoices').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(5);
  });

  it('pagina con orden estable: página 1, página 2, total y sin duplicados', async () => {
    const { token } = await escenario();
    const get = async (page: number) =>
      (
        await authed(app, token)
          .get(`/invoices?page=${page}&pageSize=2`)
          .expect(200)
      ).body;
    const p1 = await get(1);
    const p2 = await get(2);
    const p3 = await get(3);
    expect(p1).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3 });
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(2);
    expect(p3.items).toHaveLength(1);
    const ids = [...p1.items, ...p2.items, ...p3.items].map(
      (i: { id: string }) => i.id,
    );
    expect(new Set(ids).size).toBe(5);
    const fuera = await get(9);
    expect(fuera.items).toEqual([]);
    expect(fuera.total).toBe(5);
  });

  it('filtra por obra y por estado, y el total respeta el filtro', async () => {
    const { token, a, b } = await escenario();
    const porObra = await authed(app, token)
      .get(`/invoices?projectId=${a.id}&page=1&pageSize=2`)
      .expect(200);
    expect(porObra.body.total).toBe(3);
    expect(porObra.body.items).toHaveLength(2);
    const sinPagina = await authed(app, token)
      .get(`/invoices?projectId=${b.id}`)
      .expect(200);
    expect(sinPagina.body).toHaveLength(2);
    const porEstado = await authed(app, token)
      .get('/invoices?status=aprobada&page=1&pageSize=10')
      .expect(200);
    expect(porEstado.body.total).toBe(1);
    expect(porEstado.body.items[0].status).toBe('aprobada');
  });

  it('rechaza page y pageSize no válidos con 400', async () => {
    const { token } = await escenario();
    for (const q of ['pageSize=0&page=1', 'pageSize=101&page=1', 'page=abc']) {
      await authed(app, token).get(`/invoices?${q}`).expect(400);
    }
  });

  it('el rol obra solo cuenta sus obras en el total', async () => {
    const { token, a, b } = await escenario();
    const obra = await createObraUser(app, token, [a.id]);
    const todas = await authed(app, obra.tokens.accessToken)
      .get('/invoices?page=1&pageSize=10')
      .expect(200);
    expect(todas.body.total).toBe(3);
    const ajena = await authed(app, obra.tokens.accessToken)
      .get(`/invoices?projectId=${b.id}&page=1&pageSize=10`)
      .expect(200);
    expect(ajena.body.total).toBe(0);
    expect(ajena.body.items).toEqual([]);
  });
});
