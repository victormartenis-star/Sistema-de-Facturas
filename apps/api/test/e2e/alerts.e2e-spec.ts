import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ALERT_RULE_TYPES } from '@erp/shared';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/** `YYYY-MM-DD` a N días naturales de hoy (positivo futuro, negativo pasado). */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('Alertas (integración) — reglas y notificaciones proactivas', () => {
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

  it('siembra las 4 reglas por defecto la primera vez que se piden', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);

    const rules = (await client.get('/alerts/rules').expect(200)).body as {
      type: string;
      thresholdDays: number | null;
      thresholdPct: number | null;
      channels: string[];
      enabled: boolean;
    }[];
    expect(rules).toHaveLength(ALERT_RULE_TYPES.length);
    const byType = Object.fromEntries(rules.map((r) => [r.type, r]));
    expect(byType.permiso.thresholdDays).toBe(30);
    expect(byType.sobrecoste.thresholdPct).toBe(0);
    expect(byType.garantia_postventa.thresholdDays).toBe(15);
    expect(byType.permiso.channels).toEqual(['in_app']);
    expect(byType.permiso.enabled).toBe(true);
  });

  it('actualiza el umbral de una regla y rechaza un cuerpo vacío', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    await client.get('/alerts/rules').expect(200);

    const updated = (
      await client
        .patch('/alerts/rules/permiso')
        .send({ thresholdDays: 10 })
        .expect(200)
    ).body;
    expect(updated.thresholdDays).toBe(10);

    await client.patch('/alerts/rules/permiso').send({}).expect(400);
  });

  it('la evaluación crea una notificación por un permiso próximo a caducar, y no la duplica en una segunda pasada', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);

    await client
      .post('/permisos')
      .send({
        projectId: project.id,
        tipo: 'licencia_obra',
        organismoPublico: 'Ayuntamiento de Pruebas',
        fechaSolicitud: isoDaysFromNow(-90),
        fechaResolucion: isoDaysFromNow(-60),
        fechaVencimiento: isoDaysFromNow(10),
        status: 'concedido',
      })
      .expect(201);

    const first = (await client.post('/alerts/run').expect(201)).body;
    expect(first.evaluated).toEqual(expect.arrayContaining(['permiso']));
    expect(first.created).toBeGreaterThanOrEqual(1);

    const notifications = (
      await client.get('/alerts/notifications').expect(200)
    ).body as { id: string; type: string; read: boolean }[];
    const permisoNotifs = notifications.filter((n) => n.type === 'permiso');
    expect(permisoNotifs).toHaveLength(1);
    expect(permisoNotifs[0].read).toBe(false);

    // Segunda pasada: el permiso sigue sin resolverse, no debe duplicar la notificación.
    const second = (await client.post('/alerts/run').expect(201)).body;
    expect(second.created).toBe(0);
    const notifsAfter = (await client.get('/alerts/notifications').expect(200))
      .body as { type: string }[];
    expect(notifsAfter.filter((n) => n.type === 'permiso')).toHaveLength(1);

    // Marcar como leída
    await client
      .patch(`/alerts/notifications/${permisoNotifs[0].id}/leer`)
      .expect(204);
    const unread = (
      await client.get('/alerts/notifications/no-leidas').expect(200)
    ).body;
    expect(unread.count).toBe(0);
  });

  it('la evaluación crea una notificación por una incidencia de postventa cerca de vencer la garantía', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);

    const unit = (
      await client
        .post('/real-estate/units')
        .send({ projectId: project.id, code: 'A-1', salePrice: 150_000 })
        .expect(201)
    ).body;

    await client
      .post('/real-estate/postventa')
      .send({
        unitId: unit.id,
        category: 'fontaneria',
        description: 'Fuga en el baño principal',
        reportedAt: isoDaysFromNow(-5),
        warrantyDeadline: isoDaysFromNow(7),
      })
      .expect(201);

    const run = (await client.post('/alerts/run').expect(201)).body;
    expect(run.evaluated).toEqual(
      expect.arrayContaining(['garantia_postventa']),
    );

    const notifications = (
      await client.get('/alerts/notifications').expect(200)
    ).body as { type: string }[];
    expect(
      notifications.filter((n) => n.type === 'garantia_postventa'),
    ).toHaveLength(1);
  });

  it('exige token y restringe la edición de reglas a roles de gestión', async () => {
    await request(app.getHttpServer()).get('/alerts/rules').expect(401);

    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const obraEmail = `obra-${Date.now()}@test.dintel.es`;
    await authed(app, admin.accessToken)
      .post('/users')
      .send({
        email: obraEmail,
        password: 'Test1234!',
        fullName: 'Usuario de Obra',
        role: 'obra',
      })
      .expect(201);
    // Acceso a obras no es necesario para este chequeo de rol: el guard de
    // roles corta antes de llegar a la lógica de negocio.
    void project;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: obraEmail, password: 'Test1234!' })
      .expect(200);
    const obraClient = authed(app, login.body.accessToken);

    await obraClient
      .patch('/alerts/rules/permiso')
      .send({ thresholdDays: 5 })
      .expect(403);
  });
});
