import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createObraUser,
  createPhase,
  createProject,
  createTestApp,
  createUserWithRole,
  ifMatch,
  ifMatchDe,
  ifMatchPartida,
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
      .set('If-Match', ifMatch(item.version))
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
      .set('If-Match', ifMatch(updated.body.version))
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

    await addBudgetItem(app, admin.accessToken, first.id);
    await addBudgetItem(app, admin.accessToken, second.id);
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
      .set('If-Match', ifMatch(budget.version))
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
      .set('If-Match', ifMatch(budget.version))
      .send({ name: 'Intento' })
      .expect(404);
    await authed(app, obraTokens.accessToken)
      .patch(`/budget-items/${item.id}`)
      .set('If-Match', ifMatch(item.version))
      .send({ quantity: 5 })
      .expect(404);
  });

  describe('máquina de estados', () => {
    async function budgetWithItem(
      token: string,
      status?: 'activo' | 'cerrado',
    ) {
      const project = await createProject(app, token);
      const budget = await createBudget(app, token, project.id);
      const item = await addBudgetItem(app, token, budget.id, {
        code: 'P01',
        unitPrice: 10,
        quantity: 10,
      });
      if (status) {
        await activateBudget(app, token, budget.id);
        if (status === 'cerrado') {
          await authed(app, token)
            .patch(`/budgets/${budget.id}`)
            .set(
              'If-Match',
              await ifMatchDe(app, token, `/budgets/${budget.id}`),
            )
            .send({ status: 'cerrado' })
            .expect(200);
        }
      }
      return { project, budget, item };
    }

    it('un presupuesto sin partidas no se puede activar (409)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project = await createProject(app, admin.accessToken);
      const budget = await createBudget(app, admin.accessToken, project.id);
      const res = await authed(app, admin.accessToken)
        .patch(`/budgets/${budget.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${budget.id}`),
        )
        .send({ status: 'activo' })
        .expect(409);
      expect(res.body.message).toMatch(/sin partidas/);
    });

    it('no se vuelve atrás: activo → borrador y cerrado → borrador/activo dan 409', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const { budget } = await budgetWithItem(admin.accessToken, 'activo');
      await authed(app, admin.accessToken)
        .patch(`/budgets/${budget.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${budget.id}`),
        )
        .send({ status: 'borrador' })
        .expect(409);

      const { budget: cerrado } = await budgetWithItem(
        admin.accessToken,
        'cerrado',
      );
      await authed(app, admin.accessToken)
        .patch(`/budgets/${cerrado.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${cerrado.id}`),
        )
        .send({ status: 'borrador' })
        .expect(409);
      await authed(app, admin.accessToken)
        .patch(`/budgets/${cerrado.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${cerrado.id}`),
        )
        .send({ status: 'activo' })
        .expect(409);
    });

    it('con el presupuesto activo: 409 al crear, borrar o cambiar precio de partidas; phaseId sí', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const { project, budget, item } = await budgetWithItem(
        admin.accessToken,
        'activo',
      );
      const api = authed(app, admin.accessToken);

      await api
        .post(`/budgets/${budget.id}/items`)
        .send({
          code: 'P02',
          name: 'Otra',
          unit: 'ud',
          unitPrice: 1,
          quantity: 1,
        })
        .expect(409);
      await api
        .patch(`/budget-items/${item.id}`)
        .set(
          'If-Match',
          await ifMatchPartida(app, admin.accessToken, budget.id, item.id),
        )
        .send({ unitPrice: 99 })
        .expect(409);
      await api
        .delete(`/budget-items/${item.id}`)
        .set(
          'If-Match',
          await ifMatchPartida(app, admin.accessToken, budget.id, item.id),
        )
        .expect(409);

      // La imputación analítica sí se puede corregir y no cambia importes.
      const phase = await createPhase(app, admin.accessToken, project.id);
      const res = await api
        .patch(`/budget-items/${item.id}`)
        .set(
          'If-Match',
          await ifMatchPartida(app, admin.accessToken, budget.id, item.id),
        )
        .send({ phaseId: phase.id })
        .expect(200);
      expect(res.body.phaseId).toBe(phase.id);
      expect(res.body.totalAmount).toBeCloseTo(100, 2);
    });

    it('con el presupuesto cerrado no se toca ninguna partida (ni phaseId)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const { project, budget, item } = await budgetWithItem(
        admin.accessToken,
        'cerrado',
      );
      const phase = await createPhase(app, admin.accessToken, project.id);
      await authed(app, admin.accessToken)
        .patch(`/budget-items/${item.id}`)
        .set(
          'If-Match',
          await ifMatchPartida(app, admin.accessToken, budget.id, item.id),
        )
        .send({ phaseId: phase.id })
        .expect(409);
      await authed(app, admin.accessToken)
        .patch(`/budgets/${budget.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${budget.id}`),
        )
        .send({ notes: 'cambio' })
        .expect(409);
    });

    it('activo: las notas sí se editan, el nombre no', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const { budget } = await budgetWithItem(admin.accessToken, 'activo');
      await authed(app, admin.accessToken)
        .patch(`/budgets/${budget.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${budget.id}`),
        )
        .send({ notes: 'Aclaración' })
        .expect(200);
      await authed(app, admin.accessToken)
        .patch(`/budgets/${budget.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${budget.id}`),
        )
        .send({ name: 'Otro nombre' })
        .expect(409);
    });

    it('solo se borra un presupuesto en borrador', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const { budget } = await budgetWithItem(admin.accessToken, 'activo');
      await authed(app, admin.accessToken)
        .delete(`/budgets/${budget.id}`)
        .set(
          'If-Match',
          await ifMatchDe(app, admin.accessToken, `/budgets/${budget.id}`),
        )
        .expect(409);
    });

    it('duplicar crea un borrador con las mismas partidas; al activarlo cierra el anterior', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const { budget } = await budgetWithItem(admin.accessToken, 'activo');

      const res = await authed(app, admin.accessToken)
        .post(`/budgets/${budget.id}/duplicar`)
        .send({})
        .expect(201);
      expect(res.body.status).toBe('borrador');
      expect(res.body.itemCount).toBe(1);
      expect(res.body.totalAmount).toBeCloseTo(100, 2);
      expect(res.body.id).not.toBe(budget.id);

      // La copia sí se puede corregir y, al activarla, cierra la versión anterior.
      const detail = await authed(app, admin.accessToken)
        .get(`/budgets/${res.body.id}`)
        .expect(200);
      await authed(app, admin.accessToken)
        .patch(`/budget-items/${detail.body.items[0].id}`)
        .set('If-Match', ifMatch(detail.body.items[0].version))
        .send({ unitPrice: 20 })
        .expect(200);
      await activateBudget(app, admin.accessToken, res.body.id);
      const anterior = await authed(app, admin.accessToken)
        .get(`/budgets/${budget.id}`)
        .expect(200);
      expect(anterior.body.status).toBe('cerrado');
    });

    it('el lector no puede duplicar (solo GET)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const { budget } = await budgetWithItem(admin.accessToken);
      const lector = await createUserWithRole(app, admin.accessToken, 'lector');
      await authed(app, lector.accessToken)
        .post(`/budgets/${budget.id}/duplicar`)
        .send({})
        .expect(403);
    });
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer())
      .get('/projects/00000000-0000-0000-0000-000000000000/budgets')
      .expect(401);
  });
});
