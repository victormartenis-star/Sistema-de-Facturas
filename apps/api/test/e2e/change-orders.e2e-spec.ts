import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Change Orders (integración) — contradictorios/modificados y bloqueo de certificación', () => {
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

  it('workflow completo: borrador → enviar → aprobar', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);
    const df = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      legalName: 'Dirección Facultativa SL',
    });

    const co = (
      await client
        .post('/change-orders')
        .send({
          projectId: project.id,
          tipo: 'contradictorio',
          titulo: 'Cimentación especial por terreno rocoso',
          descripcion: 'Se encontró roca no prevista en el estudio geotécnico',
          lineas: [
            {
              descripcion: 'Excavación en roca',
              unidad: 'm3',
              cantidad: 50,
              precioUnitario: 40,
            },
          ],
        })
        .expect(201)
    ).body;
    expect(co.estado).toBe('borrador');
    expect(co.importeEstimado).toBe(2000);
    expect(co.numero).toContain('-CO-');

    await client
      .post(`/change-orders/${co.id}/enviar`)
      .send({ direccionFacultativaContactId: df.id })
      .expect(201);

    const afterEnviar = (
      await client.get(`/change-orders/${co.id}`).expect(200)
    ).body;
    expect(afterEnviar.estado).toBe('enviado_df');
    expect(afterEnviar.fechaEnvio).not.toBeNull();

    // No se puede editar un enviado.
    await client
      .patch(`/change-orders/${co.id}`)
      .send({ titulo: 'Otro título' })
      .expect(409);

    const resolved = (
      await client
        .post(`/change-orders/${co.id}/resolver`)
        .send({
          estado: 'aprobado',
          importeAprobado: 1900,
          comentarioResolucion: 'Aprobado con ajuste de precio',
        })
        .expect(201)
    ).body;
    expect(resolved.estado).toBe('aprobado');
    expect(resolved.importeAprobado).toBe(1900);
  });

  it('bloquea certificar una partida con un contradictorio/modificado pendiente de resolución', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken, {
      contractAmount: 100_000,
    });
    const df = await createContact(app, admin.accessToken, { kind: 'cliente' });
    const budget = await createBudget(app, admin.accessToken, project.id);
    const item = await addBudgetItem(app, admin.accessToken, budget.id);
    await activateBudget(app, admin.accessToken, budget.id);

    const co = (
      await client
        .post('/change-orders')
        .send({
          projectId: project.id,
          tipo: 'modificado',
          titulo: 'Cambio de acabado',
          descripcion: 'El cliente pide cambiar el acabado de esta partida',
          lineas: [
            {
              budgetItemId: item.id,
              descripcion: 'Acabado superior',
              unidad: 'ud',
              cantidad: 1,
              precioUnitario: 500,
            },
          ],
        })
        .expect(201)
    ).body;

    const cert = (
      await client
        .post('/certifications')
        .send({
          projectId: project.id,
          certDate: '2026-09-15',
          cumulativePct: 10,
        })
        .expect(201)
    ).body;

    // Todavía en borrador: bloqueado.
    await client
      .post(`/certifications/${cert.id}/lines`)
      .send({
        budgetItemId: item.id,
        cumulativePct: 10,
        cumulativeAmount: 100,
        periodAmount: 100,
      })
      .expect(409);

    await client
      .post(`/change-orders/${co.id}/enviar`)
      .send({ direccionFacultativaContactId: df.id })
      .expect(201);

    // Enviado pero sin resolver: sigue bloqueado.
    await client
      .post(`/certifications/${cert.id}/lines`)
      .send({
        budgetItemId: item.id,
        cumulativePct: 10,
        cumulativeAmount: 100,
        periodAmount: 100,
      })
      .expect(409);

    await client
      .post(`/change-orders/${co.id}/resolver`)
      .send({ estado: 'aprobado', importeAprobado: 500 })
      .expect(201);

    // Resuelto (aprobado): ya se puede certificar.
    await client
      .post(`/certifications/${cert.id}/lines`)
      .send({
        budgetItemId: item.id,
        cumulativePct: 10,
        cumulativeAmount: 100,
        periodAmount: 100,
      })
      .expect(201);
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/change-orders').expect(401);
  });
});
