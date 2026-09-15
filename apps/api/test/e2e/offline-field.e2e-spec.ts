import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Offline Field (integración) — fichajes y checklist PRL', () => {
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

  it('crea fichajes de entrada y salida', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);

    const entrada = (
      await client
        .post('/fichajes')
        .send({
          projectId: project.id,
          workerName: 'Juan Pérez',
          type: 'entrada',
          occurredAt: '2026-09-15T07:00:00.000Z',
        })
        .expect(201)
    ).body;
    expect(entrada.type).toBe('entrada');
    expect(entrada.projectCode).toBe(project.code);

    await client
      .post('/fichajes')
      .send({
        projectId: project.id,
        workerName: 'Juan Pérez',
        type: 'salida',
        occurredAt: '2026-09-15T15:00:00.000Z',
      })
      .expect(201);

    const list = (
      await client.get(`/fichajes?projectId=${project.id}`).expect(200)
    ).body;
    expect(list).toHaveLength(2);
  });

  it('reintentar el mismo clientId no duplica el fichaje (idempotencia de sincronización offline)', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);
    const clientId = '11111111-1111-4111-8111-111111111111';

    const payload = {
      projectId: project.id,
      workerName: 'María López',
      type: 'entrada',
      occurredAt: '2026-09-15T07:05:00.000Z',
      clientId,
    };

    const first = (await client.post('/fichajes').send(payload).expect(201))
      .body;
    const retry = (await client.post('/fichajes').send(payload).expect(201))
      .body;
    expect(retry.id).toBe(first.id);

    const list = (
      await client.get(`/fichajes?projectId=${project.id}`).expect(200)
    ).body;
    expect(list).toHaveLength(1);
  });

  it('crea un checklist PRL y calcula allChecked', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);

    const incompleto = (
      await client
        .post('/checklist-prl')
        .send({
          projectId: project.id,
          workerName: 'Juan Pérez',
          checkDate: '2026-09-15',
          items: [
            { label: 'EPIs completos', checked: true },
            { label: 'Extintor accesible', checked: false },
          ],
        })
        .expect(201)
    ).body;
    expect(incompleto.allChecked).toBe(false);

    const completo = (
      await client
        .post('/checklist-prl')
        .send({
          projectId: project.id,
          workerName: 'Ana Ruiz',
          checkDate: '2026-09-15',
          items: [
            { label: 'EPIs completos', checked: true },
            { label: 'Extintor accesible', checked: true },
          ],
        })
        .expect(201)
    ).body;
    expect(completo.allChecked).toBe(true);

    const list = (
      await client.get(`/checklist-prl?projectId=${project.id}`).expect(200)
    ).body;
    expect(list).toHaveLength(2);
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/fichajes').expect(401);
  });
});
