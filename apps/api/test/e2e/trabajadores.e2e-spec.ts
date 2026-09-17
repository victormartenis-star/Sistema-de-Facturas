import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Trabajadores (integración) — maestro de personal', () => {
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

  it('da de alta un trabajador con los valores por defecto', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });

    const res = await authed(app, admin.accessToken)
      .post('/trabajadores')
      .send({ nombre: 'Juan Pérez' })
      .expect(201);

    expect(res.body.tipo).toBe('propio');
    expect(res.body.activo).toBe(true);
    expect(res.body.proveedorNombre).toBeNull();
  });

  it('lista los trabajadores y filtra por activo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    await authed(app, admin.accessToken)
      .post('/trabajadores')
      .send({ nombre: 'Ana García' })
      .expect(201);
    const baja = (
      await authed(app, admin.accessToken)
        .post('/trabajadores')
        .send({ nombre: 'Pedro Ruiz' })
        .expect(201)
    ).body;
    await authed(app, admin.accessToken)
      .patch(`/trabajadores/${baja.id}`)
      .send({ activo: false })
      .expect(200);

    const activos = await authed(app, admin.accessToken)
      .get('/trabajadores?activo=true')
      .expect(200);
    expect(activos.body).toHaveLength(1);
    expect(activos.body[0].nombre).toBe('Ana García');
  });

  it('rechaza un tipo no reconocido con 400 (ZodValidationPipe)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    await authed(app, admin.accessToken)
      .post('/trabajadores')
      .send({ nombre: 'Luis Soto', tipo: 'freelance' })
      .expect(400);
  });

  it('enlaza un parte de personal a la ficha del trabajador y devuelve su nombre', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const trabajador = await authed(app, admin.accessToken)
      .post('/trabajadores')
      .send({ nombre: 'María López', ordinaryRateDefault: 18.5 })
      .expect(201);

    const parte = await authed(app, admin.accessToken)
      .post('/partes-diarios/personal')
      .send({
        projectId: project.id,
        workerName: 'María López',
        trabajadorId: trabajador.body.id,
        workDate: '2026-09-14',
        ordinaryHours: 8,
        ordinaryRate: 18.5,
        overtimeRate: 25,
      })
      .expect(201);

    expect(parte.body.trabajadorId).toBe(trabajador.body.id);
    expect(parte.body.trabajadorNombre).toBe('María López');
  });

  it('rechaza un parte enlazado a un trabajador inexistente con 404', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);

    await authed(app, admin.accessToken)
      .post('/partes-diarios/personal')
      .send({
        projectId: project.id,
        workerName: 'Nadie',
        trabajadorId: '00000000-0000-0000-0000-000000000000',
        workDate: '2026-09-14',
        ordinaryRate: 18.5,
        overtimeRate: 25,
      })
      .expect(404);
  });

  it('da de baja lógica un trabajador y deja de listarlo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const trabajador = await authed(app, admin.accessToken)
      .post('/trabajadores')
      .send({ nombre: 'Carlos Díaz' })
      .expect(201);

    await authed(app, admin.accessToken)
      .delete(`/trabajadores/${trabajador.body.id}`)
      .expect(204);

    const list = await authed(app, admin.accessToken)
      .get('/trabajadores')
      .expect(200);
    expect(
      list.body.find((t: { id: string }) => t.id === trabajador.body.id),
    ).toBeUndefined();
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer()).get('/trabajadores').expect(401);
  });
});
