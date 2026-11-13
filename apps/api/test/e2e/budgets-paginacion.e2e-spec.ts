import { INestApplication } from '@nestjs/common';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/** Fase 4, tramo 1: GET /projects/:id/budgets con paginación opt-in y filtro por estado. */
describe('Presupuestos (integración) — paginación y filtros', () => {
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

  /** 3 presupuestos con partidas en la obra (uno activo) y 1 en otra obra. */
  async function escenario() {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const obra = await createProject(app, token);
    const otra = await createProject(app, token);
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const b = await createBudget(app, token, obra.id, { name: `P${n}` });
      await addBudgetItem(app, token, b.id);
      await addBudgetItem(app, token, b.id);
      ids.push(b.id);
    }
    await createBudget(app, token, otra.id);
    await activateBudget(app, token, ids[0]);
    return { token, obra };
  }

  it('sin page devuelve el array de siempre', async () => {
    const { token, obra } = await escenario();
    const res = await authed(app, token)
      .get(`/projects/${obra.id}/budgets`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
  });

  it('pagina: página 1, página 2, total correcto y partidas bien contadas', async () => {
    const { token, obra } = await escenario();
    const get = async (page: number) =>
      (
        await authed(app, token)
          .get(`/projects/${obra.id}/budgets?page=${page}&pageSize=2`)
          .expect(200)
      ).body;
    const p1 = await get(1);
    const p2 = await get(2);
    expect(p1).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(1);
    const todos = [...p1.items, ...p2.items];
    expect(new Set(todos.map((i: { id: string }) => i.id)).size).toBe(3);
    for (const b of todos) expect(b.itemCount).toBe(2);
    const fuera = await get(7);
    expect(fuera.items).toEqual([]);
    expect(fuera.total).toBe(3);
  });

  it('filtra por estado y el total respeta el filtro', async () => {
    const { token, obra } = await escenario();
    const activos = await authed(app, token)
      .get(`/projects/${obra.id}/budgets?status=activo&page=1&pageSize=10`)
      .expect(200);
    expect(activos.body.total).toBe(1);
    const borradores = await authed(app, token)
      .get(`/projects/${obra.id}/budgets?status=borrador`)
      .expect(200);
    expect(borradores.body).toHaveLength(2);
  });

  it('rechaza page y pageSize no válidos con 400', async () => {
    const { token, obra } = await escenario();
    for (const q of ['pageSize=0&page=1', 'pageSize=101&page=1', 'page=abc']) {
      await authed(app, token)
        .get(`/projects/${obra.id}/budgets?${q}`)
        .expect(400);
    }
  });
});
