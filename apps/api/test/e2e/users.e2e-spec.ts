import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  authed,
  createObraUser,
  createTestApp,
  loginUser,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Users (integración) — gestión de usuarios y contraseñas', () => {
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

  it('un admin puede crear, listar, actualizar y borrar usuarios', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);

    const created = (
      await client
        .post('/users')
        .send({
          email: 'nuevo@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Usuario Nuevo',
          role: 'administracion',
        })
        .expect(201)
    ).body as { id: string };

    const list = (await client.get('/users').expect(200)).body as {
      id: string;
    }[];
    expect(list.map((u) => u.id)).toEqual(expect.arrayContaining([created.id]));

    await client
      .patch(`/users/${created.id}`)
      .send({ fullName: 'Usuario Renombrado' })
      .expect(200);

    await client.delete(`/users/${created.id}`).expect(204);
  });

  it('un usuario `obra` no puede crear, actualizar ni borrar otros usuarios (403)', async () => {
    const admin = await registerUser(app);
    const { tokens: obraTokens } = await createObraUser(
      app,
      admin.accessToken,
      [],
    );
    const client = authed(app, obraTokens.accessToken);

    await client
      .post('/users')
      .send({
        email: 'intruso@test.dintel.es',
        password: 'Test1234!',
        fullName: 'Intruso',
        role: 'admin',
      })
      .expect(403);

    const admin2 = (
      await authed(app, admin.accessToken)
        .post('/users')
        .send({
          email: 'victima@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Víctima',
          role: 'administracion',
        })
        .expect(201)
    ).body as { id: string };

    await client
      .patch(`/users/${admin2.id}`)
      .send({ role: 'admin' })
      .expect(403);
    await client.delete(`/users/${admin2.id}`).expect(403);
    await client
      .patch(`/users/${admin2.id}/password`)
      .send({ newPassword: 'Hackeada123!' })
      .expect(403);
  });

  it('resetea la contraseña de otro usuario sin pedir la actual, y revoca sus sesiones abiertas', async () => {
    const admin = await registerUser(app);
    const target = (
      await authed(app, admin.accessToken)
        .post('/users')
        .send({
          email: 'resetear@test.dintel.es',
          password: 'Original123!',
          fullName: 'Usuario a Resetear',
          role: 'administracion',
        })
        .expect(201)
    ).body as { id: string };
    const targetTokens = await loginUser(
      app,
      'resetear@test.dintel.es',
      'Original123!',
    );

    await authed(app, admin.accessToken)
      .patch(`/users/${target.id}/password`)
      .send({ newPassword: 'Nueva123!' })
      .expect(204);

    // El refresh token que el usuario ya tenía queda revocado (el access
    // token en curso sigue vivo hasta su expiración natural: es un JWT sin
    // lista de revocación, igual que tras un `logout` normal).
    await authed(app, targetTokens.accessToken)
      .post('/auth/refresh')
      .send({ refreshToken: targetTokens.refreshToken })
      .expect(401);

    // La contraseña vieja ya no vale; la nueva sí.
    await loginUser(app, 'resetear@test.dintel.es', 'Nueva123!');
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
  });
});
