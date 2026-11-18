import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createProject,
  createTestApp,
  ifMatchDe,
  ifMatchPartida,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Contrato RFC 7807 del dominio de obras, presupuestos y partidas: cada rechazo
 * lleva un `errorCode` de dominio, el `detail` original y `correlationId` igual
 * a `X-Request-Id`. Además comprueba que la cadena de auditoría sigue íntegra
 * tras las operaciones del dominio.
 */
describe('Dominio de obras y presupuestos (integración) — errores RFC 7807 y auditoría', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    token = (await registerUser(app, { email: 'admin@test.dintel.es' }))
      .accessToken;
  });

  function verificarContrato(
    res: request.Response,
    status: number,
    errorCode: string,
    detail: string,
  ) {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.errorCode).toBe(errorCode);
    expect(res.body.type).toBe(`https://erp-dintel/errores/${errorCode}`);
    expect(res.body.detail).toBe(detail);
    expect(res.body.correlationId).toBe(res.headers['x-request-id']);
  }

  it('obra inexistente: 404 PROJECT_NOT_FOUND', async () => {
    const res = await authed(app, token).get(`/projects/${randomUUID()}`);
    verificarContrato(res, 404, 'PROJECT_NOT_FOUND', 'Obra no encontrada');
  });

  it('presupuesto inexistente: 404 BUDGET_NOT_FOUND', async () => {
    const res = await authed(app, token).get(`/budgets/${randomUUID()}`);
    verificarContrato(
      res,
      404,
      'BUDGET_NOT_FOUND',
      'Presupuesto no encontrado',
    );
  });

  it('código de obra repetido: 409 PROJECT_CODE_DUPLICATED', async () => {
    const obra = await createProject(app, token, { code: 'OBRA-DUP-1' });
    const res = await authed(app, token)
      .post('/projects')
      .send({ code: obra.code, name: 'Otra', contractAmount: 1000 });
    verificarContrato(
      res,
      409,
      'PROJECT_CODE_DUPLICATED',
      `Ya existe una obra con el código "${obra.code}"`,
    );
  });

  it('partida con código repetido en el presupuesto: 409 BUDGET_ITEM_CODE_DUPLICATED', async () => {
    const obra = await createProject(app, token);
    const presupuesto = await createBudget(app, token, obra.id);
    await addBudgetItem(app, token, presupuesto.id, { code: 'P-1' });
    const res = await authed(app, token)
      .post(`/budgets/${presupuesto.id}/items`)
      .send({
        code: 'P-1',
        name: 'Duplicada',
        unit: 'm2',
        unitPrice: 10,
        quantity: 1,
        level: 3,
      });
    verificarContrato(
      res,
      409,
      'BUDGET_ITEM_CODE_DUPLICATED',
      'Ya existe una partida con el código "P-1" en este presupuesto',
    );
  });

  it('activar un presupuesto sin partidas: 409 BUDGET_EMPTY', async () => {
    const obra = await createProject(app, token);
    const presupuesto = await createBudget(app, token, obra.id);
    const res = await authed(app, token)
      .patch(`/budgets/${presupuesto.id}`)
      .set(
        'If-Match',
        await ifMatchDe(app, token, `/budgets/${presupuesto.id}`),
      )
      .send({ status: 'activo' });
    verificarContrato(
      res,
      409,
      'BUDGET_EMPTY',
      'No se puede activar un presupuesto sin partidas',
    );
  });

  it('importación BC3 sin archivo: 400 BC3_FILE_REQUIRED', async () => {
    const obra = await createProject(app, token);
    const res = await authed(app, token).post(
      `/projects/${obra.id}/budgets/import/bc3`,
    );
    verificarContrato(
      res,
      400,
      'BC3_FILE_REQUIRED',
      'Se requiere el archivo .bc3',
    );
  });

  it('partida de un presupuesto activo: 409 BUDGET_ITEM_LOCKED', async () => {
    const obra = await createProject(app, token);
    const presupuesto = await createBudget(app, token, obra.id);
    const partida = await addBudgetItem(app, token, presupuesto.id);
    await activateBudget(app, token, presupuesto.id);
    const res = await authed(app, token)
      .patch(`/budget-items/${partida.id}`)
      .set(
        'If-Match',
        await ifMatchPartida(app, token, presupuesto.id, partida.id),
      )
      .send({ unitPrice: 99 });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('BUDGET_ITEM_LOCKED');
    expect(res.body.correlationId).toBe(res.headers['x-request-id']);
  });

  it('tras las operaciones del dominio, la cadena de auditoría sigue íntegra', async () => {
    const obra = await createProject(app, token);
    const presupuesto = await createBudget(app, token, obra.id);
    await addBudgetItem(app, token, presupuesto.id);
    await activateBudget(app, token, presupuesto.id);

    const res = await authed(app, token)
      .get('/audit/verify-integrity')
      .expect(200);
    expect(res.body.integra).toBe(true);
  });
});
