import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createObraUser,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Budgets (integración) — presupuestos y partidas', () => {
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

  it('crea un presupuesto, lo lista y añade/actualiza/borra partidas', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);

    const budget = await createBudget(app, admin.accessToken, project.id, {
      name: 'Presupuesto base',
    });
    expect(budget.status).toBe('borrador');

    const list = await authed(app, admin.accessToken)
      .get(`/projects/${project.id}/budgets`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(budget.id);

    const item = await addBudgetItem(app, admin.accessToken, budget.id, {
      code: 'P01',
      unitPrice: 100,
      quantity: 10,
    });
    expect(item.totalAmount).toBeCloseTo(1_000, 2);

    const updated = await authed(app, admin.accessToken)
      .patch(`/budget-items/${item.id}`)
      .send({ quantity: 20 })
      .expect(200);
    expect(updated.body.totalAmount).toBeCloseTo(2_000, 2);

    const detail = await authed(app, admin.accessToken)
      .get(`/budgets/${budget.id}`)
      .expect(200);
    expect(detail.body.totalAmount).toBeCloseTo(2_000, 2);
    expect(detail.body.items).toHaveLength(1);

    await authed(app, admin.accessToken)
      .delete(`/budget-items/${item.id}`)
      .expect(204);

    const detailAfter = await authed(app, admin.accessToken)
      .get(`/budgets/${budget.id}`)
      .expect(200);
    expect(detailAfter.body.items).toHaveLength(0);
  });

  it('rechaza dos partidas con el mismo código en el mismo presupuesto, con 409', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const budget = await createBudget(app, admin.accessToken, project.id);
    await addBudgetItem(app, admin.accessToken, budget.id, { code: 'DUP' });

    await authed(app, admin.accessToken)
      .post(`/budgets/${budget.id}/items`)
      .send({
        code: 'DUP',
        name: 'Otra partida',
        unit: 'm2',
        unitPrice: 5,
        quantity: 1,
        level: 3,
      })
      .expect(409);
  });

  it('al activar un presupuesto, cierra automáticamente el que ya estaba activo en la obra', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const first = await createBudget(app, admin.accessToken, project.id, {
      name: 'Versión 1',
    });
    const second = await createBudget(app, admin.accessToken, project.id, {
      name: 'Versión 2',
    });

    await activateBudget(app, admin.accessToken, first.id);
    await activateBudget(app, admin.accessToken, second.id);

    const firstAfter = await authed(app, admin.accessToken)
      .get(`/budgets/${first.id}`)
      .expect(200);
    const secondAfter = await authed(app, admin.accessToken)
      .get(`/budgets/${second.id}`)
      .expect(200);
    expect(firstAfter.body.status).toBe('cerrado');
    expect(secondAfter.body.status).toBe('activo');
  });

  it('borra lógicamente un presupuesto y deja de listarlo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const budget = await createBudget(app, admin.accessToken, project.id);

    await authed(app, admin.accessToken)
      .delete(`/budgets/${budget.id}`)
      .expect(204);

    const list = await authed(app, admin.accessToken)
      .get(`/projects/${project.id}/budgets`)
      .expect(200);
    expect(list.body).toHaveLength(0);
    await authed(app, admin.accessToken)
      .get(`/budgets/${budget.id}`)
      .expect(404);
  });

  it('un usuario `obra` sin acceso a la obra recibe 404 al pedir el presupuesto (no delata que exista)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const budget = await createBudget(app, admin.accessToken, project.id);
    const item = await addBudgetItem(app, admin.accessToken, budget.id);
    const { tokens: obraTokens } = await createObraUser(
      app,
      admin.accessToken,
      [],
    );

    await authed(app, obraTokens.accessToken)
      .get(`/budgets/${budget.id}`)
      .expect(404);
    await authed(app, obraTokens.accessToken)
      .patch(`/budgets/${budget.id}`)
      .send({ name: 'Intento' })
      .expect(404);
    await authed(app, obraTokens.accessToken)
      .patch(`/budget-items/${item.id}`)
      .send({ quantity: 5 })
      .expect(404);
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer())
      .get('/projects/00000000-0000-0000-0000-000000000000/budgets')
      .expect(401);
  });
});
