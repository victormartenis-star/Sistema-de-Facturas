import { INestApplication } from '@nestjs/common';
import {
  authed,
  createPhase,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Partes diarios (integración) — personal y maquinaria', () => {
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

  it('crea un parte de personal y calcula el coste con horas ordinarias y extra', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const phase = await createPhase(app, admin.accessToken, project.id);

    const res = await authed(app, admin.accessToken)
      .post('/partes-diarios/personal')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        workerName: 'María López',
        workDate: '2026-09-14',
        ordinaryHours: 8,
        overtimeHours: 2,
        ordinaryRate: 15,
        overtimeRate: 22.5,
      })
      .expect(201);

    // 8*15 + 2*22.5 = 120 + 45 = 165
    expect(res.body.totalCost).toBeCloseTo(165, 2);
    expect(res.body.approvedAt).toBeNull();
  });

  it('crea un parte de maquinaria y calcula el coste por horas de uso', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);

    const res = await authed(app, admin.accessToken)
      .post('/partes-diarios/maquinaria')
      .send({
        projectId: project.id,
        machineName: 'Dumper 4x4',
        ownership: 'propia',
        workDate: '2026-09-14',
        hoursUsed: 6.5,
        hourlyRate: 40,
      })
      .expect(201);

    expect(res.body.totalCost).toBeCloseTo(260, 2);
  });

  it('aprobar dispara approvedBy/approvedAt con el usuario que aprueba', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const parte = await authed(app, admin.accessToken)
      .post('/partes-diarios/personal')
      .send({
        projectId: project.id,
        workerName: 'Ana Ruiz',
        workDate: '2026-09-14',
        ordinaryHours: 8,
        overtimeHours: 0,
        ordinaryRate: 15,
        overtimeRate: 22.5,
      })
      .expect(201);
    expect(parte.body.approvedBy).toBeNull();

    const approved = await authed(app, admin.accessToken)
      .post(`/partes-diarios/personal/${parte.body.id}/aprobar`)
      .expect(201);
    expect(approved.body.approvedBy).toBe(admin.user.id);
    expect(approved.body.approvedAt).toEqual(expect.any(String));
  });

  it('recalcula el coste al actualizar las horas', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const parte = await authed(app, admin.accessToken)
      .post('/partes-diarios/maquinaria')
      .send({
        projectId: project.id,
        machineName: 'Camión',
        workDate: '2026-09-14',
        hoursUsed: 4,
        hourlyRate: 50,
      })
      .expect(201);
    expect(parte.body.totalCost).toBeCloseTo(200, 2);

    const updated = await authed(app, admin.accessToken)
      .patch(`/partes-diarios/maquinaria/${parte.body.id}`)
      .send({ hoursUsed: 6 })
      .expect(200);
    expect(updated.body.totalCost).toBeCloseTo(300, 2);
  });

  it('filtra por obra y por rango de fechas', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const projectA = await createProject(app, admin.accessToken, {
      code: `A-${Date.now()}`,
    });
    const projectB = await createProject(app, admin.accessToken, {
      code: `B-${Date.now()}`,
    });
    await authed(app, admin.accessToken)
      .post('/partes-diarios/personal')
      .send({
        projectId: projectA.id,
        workerName: 'Trabajador A',
        workDate: '2026-09-01',
        ordinaryHours: 8,
        overtimeHours: 0,
        ordinaryRate: 15,
        overtimeRate: 22.5,
      })
      .expect(201);
    await authed(app, admin.accessToken)
      .post('/partes-diarios/personal')
      .send({
        projectId: projectB.id,
        workerName: 'Trabajador B',
        workDate: '2026-09-20',
        ordinaryHours: 8,
        overtimeHours: 0,
        ordinaryRate: 15,
        overtimeRate: 22.5,
      })
      .expect(201);

    const filtered = await authed(app, admin.accessToken)
      .get(`/partes-diarios/personal?projectId=${projectA.id}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].workerName).toBe('Trabajador A');

    const byDate = await authed(app, admin.accessToken)
      .get('/partes-diarios/personal?from=2026-09-15&to=2026-09-30')
      .expect(200);
    expect(byDate.body).toHaveLength(1);
    expect(byDate.body[0].workerName).toBe('Trabajador B');
  });
});
