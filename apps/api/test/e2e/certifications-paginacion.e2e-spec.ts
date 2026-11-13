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

/** Fase 4, tramo 1: GET /certifications con paginación opt-in y filtro por estado. */
describe('Certificaciones (integración) — paginación y filtros', () => {
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

  /** Obra A con 3 certificaciones (la 1.ª facturada) y obra B con 2. */
  async function escenario() {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const a = await createProject(app, token);
    const b = await createProject(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const crear = async (projectId: string, pct: number) =>
      (
        await authed(app, token)
          .post('/certifications')
          .send({ projectId, certDate: '2026-09-14', cumulativePct: pct })
          .expect(201)
      ).body.id as string;
    const primera = await crear(a.id, 10);
    await crear(a.id, 20);
    await crear(a.id, 30);
    await crear(b.id, 10);
    await crear(b.id, 20);
    await authed(app, token)
      .post(`/certifications/${primera}/facturar`)
      .send({
        contactId: cliente.id,
        invoiceNumber: `CERT-PAG-${Date.now()}`,
        issueDate: '2026-09-14',
      })
      .expect(201);
    return { token, a, b };
  }

  it('sin page devuelve el array de siempre', async () => {
    const { token } = await escenario();
    const res = await authed(app, token).get('/certifications').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(5);
  });

  it('pagina una obra: página 1, página 2, total y lo último primero', async () => {
    const { token, a } = await escenario();
    const get = async (page: number) =>
      (
        await authed(app, token)
          .get(`/certifications?projectId=${a.id}&page=${page}&pageSize=2`)
          .expect(200)
      ).body;
    const p1 = await get(1);
    const p2 = await get(2);
    expect(p1).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(p1.items.map((c: { seq: number }) => c.seq)).toEqual([3, 2]);
    expect(p2.items.map((c: { seq: number }) => c.seq)).toEqual([1]);
    const fuera = await get(5);
    expect(fuera.items).toEqual([]);
    expect(fuera.total).toBe(3);
  });

  it('filtra por obra y por estado, y el total respeta el filtro', async () => {
    const { token, a } = await escenario();
    const global = await authed(app, token)
      .get('/certifications?page=1&pageSize=2')
      .expect(200);
    expect(global.body.total).toBe(5);
    const facturadas = await authed(app, token)
      .get('/certifications?status=facturada&page=1&pageSize=10')
      .expect(200);
    expect(facturadas.body.total).toBe(1);
    const borradorObra = await authed(app, token)
      .get(
        `/certifications?projectId=${a.id}&status=borrador&page=1&pageSize=10`,
      )
      .expect(200);
    expect(borradorObra.body.total).toBe(2);
    const sinPagina = await authed(app, token)
      .get('/certifications?status=borrador')
      .expect(200);
    expect(sinPagina.body).toHaveLength(4);
  });

  it('rechaza page y pageSize no válidos con 400', async () => {
    const { token } = await escenario();
    for (const q of ['pageSize=0&page=1', 'pageSize=101&page=1', 'page=abc']) {
      await authed(app, token).get(`/certifications?${q}`).expect(400);
    }
  });

  it('el rol obra solo cuenta sus obras en el total', async () => {
    const { token, a } = await escenario();
    const obra = await createObraUser(app, token, [a.id]);
    const res = await authed(app, obra.tokens.accessToken)
      .get('/certifications?page=1&pageSize=10')
      .expect(200);
    expect(res.body.total).toBe(3);
  });
});
