import { INestApplication } from '@nestjs/common';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Maquinaria y equipos (integración) — maestro y mantenimientos', () => {
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

  it('da de alta un equipo con los valores por defecto', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });

    const res = await authed(app, admin.accessToken)
      .post('/equipos')
      .send({ nombre: 'Retroexcavadora 12T' })
      .expect(201);

    expect(res.body.tipo).toBe('maquina_pesada');
    expect(res.body.ownership).toBe('propia');
    expect(res.body.estado).toBe('operativo');
    expect(res.body.ultimoMantenimientoFecha).toBeNull();
  });

  it('lista los equipos y filtra por estado', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    await authed(app, admin.accessToken)
      .post('/equipos')
      .send({ nombre: 'Dumper', estado: 'operativo' })
      .expect(201);
    await authed(app, admin.accessToken)
      .post('/equipos')
      .send({ nombre: 'Grúa torre', estado: 'averiado' })
      .expect(201);

    const averiados = await authed(app, admin.accessToken)
      .get('/equipos?estado=averiado')
      .expect(200);
    expect(averiados.body).toHaveLength(1);
    expect(averiados.body[0].nombre).toBe('Grúa torre');
  });

  it('registra un mantenimiento y lo refleja como último y próxima revisión del equipo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const equipo = await authed(app, admin.accessToken)
      .post('/equipos')
      .send({ nombre: 'Camión hormigonera' })
      .expect(201);

    await authed(app, admin.accessToken)
      .post('/equipos/mantenimientos')
      .send({
        equipoId: equipo.body.id,
        tipo: 'itv',
        fecha: '2026-09-10',
        coste: 120.5,
        proximaRevisionFecha: '2027-09-10',
      })
      .expect(201);

    const updated = await authed(app, admin.accessToken)
      .get(`/equipos/${equipo.body.id}`)
      .expect(200);
    expect(updated.body.ultimoMantenimientoFecha).toBe('2026-09-10');
    expect(updated.body.proximaRevisionFecha).toBe('2027-09-10');

    const historico = await authed(app, admin.accessToken)
      .get(`/equipos/${equipo.body.id}/mantenimientos`)
      .expect(200);
    expect(historico.body).toHaveLength(1);
    expect(historico.body[0].coste).toBeCloseTo(120.5, 2);
  });

  it('rechaza un mantenimiento de un equipo inexistente', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    await authed(app, admin.accessToken)
      .post('/equipos/mantenimientos')
      .send({
        equipoId: '00000000-0000-0000-0000-000000000000',
        fecha: '2026-09-10',
      })
      .expect(404);
  });

  it('enlaza un parte de maquinaria a la ficha del equipo y devuelve su nombre', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const equipo = await authed(app, admin.accessToken)
      .post('/equipos')
      .send({ nombre: 'Dumper 4x4', matricula: '1234-ABC' })
      .expect(201);

    const parte = await authed(app, admin.accessToken)
      .post('/partes-diarios/maquinaria')
      .send({
        projectId: project.id,
        machineName: 'Dumper 4x4',
        equipoId: equipo.body.id,
        workDate: '2026-09-14',
        hoursUsed: 5,
        hourlyRate: 40,
      })
      .expect(201);

    expect(parte.body.equipoId).toBe(equipo.body.id);
    expect(parte.body.equipoNombre).toBe('Dumper 4x4');
  });

  it('da de baja lógica un equipo y deja de listarlo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const equipo = await authed(app, admin.accessToken)
      .post('/equipos')
      .send({ nombre: 'Compresor' })
      .expect(201);

    await authed(app, admin.accessToken)
      .delete(`/equipos/${equipo.body.id}`)
      .expect(204);

    const list = await authed(app, admin.accessToken)
      .get('/equipos')
      .expect(200);
    expect(
      list.body.find((e: { id: string }) => e.id === equipo.body.id),
    ).toBeUndefined();
  });
});
