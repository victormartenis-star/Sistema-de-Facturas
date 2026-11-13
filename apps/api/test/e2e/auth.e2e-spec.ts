import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthTokensDto } from '@erp/shared';
import { authed, createTestApp, loginUser, registerUser } from './helpers';
import { sql } from 'drizzle-orm';
import { getDb } from '@erp/db';
import { resetTestDb, seedCompany } from './reset-db';

describe('Auth (integración)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    // Una sola vez por fichero: `DbService.getDefaultCompanyId()` cachea el
    // id en memoria durante toda la vida de la app — ver `reset-db.ts`.
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  describe('POST /auth/register', () => {
    it('registra al primer usuario de la empresa como admin (bootstrap)', async () => {
      const tokens = await registerUser(app, {
        email: 'primero@test.dintel.es',
      });
      expect(tokens.user.role).toBe('admin');
      expect(tokens.user.email).toBe('primero@test.dintel.es');
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toEqual(expect.any(String));
      expect(tokens.expiresIn).toBeGreaterThan(0);
    });

    it('cierra el registro público con 403 si ya hay un usuario activo y no crea el usuario', async () => {
      await registerUser(app, { email: 'admin@test.dintel.es' });
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'segundo@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Segundo',
        })
        .expect(403);
      expect(res.body.message).toBe(
        'El registro público está cerrado; pide a un administrador que cree tu cuenta',
      );
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'segundo@test.dintel.es', password: 'Test1234!' })
        .expect(401);
    });

    it('ignora `role` en el cuerpo del bootstrap: el primero es admin igualmente', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'primero@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Primero',
          role: 'obra',
        })
        .expect(201);
      expect((res.body as AuthTokensDto).user.role).toBe('admin');
    });

    it('un registro con role: admin no escala privilegios (403 y sin usuario creado)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'intruso@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Intruso',
          role: 'admin',
        })
        .expect(403);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'intruso@test.dintel.es', password: 'Test1234!' })
        .expect(401);
      const users = (
        await authed(app, admin.accessToken).get('/users').expect(200)
      ).body as { email: string }[];
      expect(users.map((u) => u.email)).toEqual(['admin@test.dintel.es']);
    });

    it('con el registro cerrado, un email duplicado también responde 403', async () => {
      await registerUser(app, { email: 'dup@test.dintel.es' });
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'dup@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Otro',
        })
        .expect(403);
    });

    it('registros concurrentes sobre BD vacía: exactamente 1 admin (201) y el resto 403', async () => {
      const N = 12;
      const MSG =
        'El registro público está cerrado; pide a un administrador que cree tu cuenta';
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        if (vuelta > 0) await resetTestDb();
        const respuestas = await Promise.all(
          Array.from({ length: N }, (_, i) =>
            request(app.getHttpServer())
              .post('/auth/register')
              .send({
                email: `carrera-${vuelta}-${i}@test.dintel.es`,
                password: 'Test1234!',
                fullName: `Carrera ${i}`,
              }),
          ),
        );
        const estados = respuestas.map((r) => r.status);
        expect(estados.filter((e) => e === 201)).toHaveLength(1);
        expect(estados.filter((e) => e === 403)).toHaveLength(N - 1);
        for (const r of respuestas.filter((x) => x.status === 403)) {
          expect(r.body.message).toBe(MSG);
        }
        const ganador = respuestas.find((r) => r.status === 201)!
          .body as AuthTokensDto;
        expect(ganador.user.role).toBe('admin');

        const filas = await getDb().execute(
          sql`select role, count(*)::int as n from users where deleted_at is null group by role`,
        );
        expect(filas.rows).toEqual([{ role: 'admin', n: 1 }]);
        const lista = (
          await authed(app, ganador.accessToken).get('/users').expect(200)
        ).body as unknown[];
        expect(lista).toHaveLength(1);
      }
    });

    it('registros concurrentes con el mismo email: 1 alta (201) y el resto 403', async () => {
      const N = 12;
      const respuestas = await Promise.all(
        Array.from({ length: N }, () =>
          request(app.getHttpServer()).post('/auth/register').send({
            email: 'mismo@test.dintel.es',
            password: 'Test1234!',
            fullName: 'Mismo',
          }),
        ),
      );
      const estados = respuestas.map((r) => r.status);
      expect(estados.filter((e) => e === 201)).toHaveLength(1);
      expect(estados.filter((e) => e === 403)).toHaveLength(N - 1);
    });

    it('rechaza una contraseña demasiado corta con 400 (ZodValidationPipe)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'corto@test.dintel.es', password: '123', fullName: 'X' })
        .expect(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'password' }),
        ]),
      );
    });
  });

  describe('POST /auth/login', () => {
    it('devuelve tokens con credenciales correctas', async () => {
      await registerUser(app, {
        email: 'login@test.dintel.es',
        password: 'Test1234!',
      });
      const tokens = await loginUser(app, 'login@test.dintel.es', 'Test1234!');
      expect(tokens.user.email).toBe('login@test.dintel.es');
    });

    it('rechaza una contraseña incorrecta con 401', async () => {
      await registerUser(app, {
        email: 'malpass@test.dintel.es',
        password: 'Test1234!',
      });
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'malpass@test.dintel.es', password: 'OtraCosa1234!' })
        .expect(401);
    });

    it('rechaza un email inexistente con 401 (no con 404: no revela si el email existe)', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'no-existe@test.dintel.es', password: 'Test1234!' })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('devuelve el usuario del token con un Bearer válido', async () => {
      const tokens = await registerUser(app, { email: 'me@test.dintel.es' });
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);
      expect(res.body.email).toBe('me@test.dintel.es');
    });

    it('rechaza la petición sin token con 401 (JwtAuthGuard global)', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rechaza un token corrupto con 401', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer esto-no-es-un-jwt-valido')
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('emite un nuevo access token a partir de un refresh token válido', async () => {
      const tokens = await registerUser(app, {
        email: 'refresh@test.dintel.es',
      });
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);
      const refreshed = res.body as AuthTokensDto;
      expect(refreshed.accessToken).toEqual(expect.any(String));
      expect(refreshed.user.email).toBe('refresh@test.dintel.es');
    });

    it('rechaza un refresh token inventado con 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'token-que-no-existe' })
        .expect(401);
    });

    it('invalida el refresh token tras logout', async () => {
      const tokens = await registerUser(app, {
        email: 'logout@test.dintel.es',
      });
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(204);
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
    });
  });

  describe('PATCH /auth/password', () => {
    it('cambia la contraseña propia, permite entrar con la nueva y revoca las sesiones abiertas', async () => {
      const tokens = await registerUser(app, {
        email: 'cambia@test.dintel.es',
        password: 'Original123!',
      });
      const client = authed(app, tokens.accessToken);

      await client
        .patch('/auth/password')
        .send({ currentPassword: 'Original123!', newPassword: 'Nueva123!' })
        .expect(204);

      // La sesión emitida antes del cambio queda revocada.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      // La contraseña vieja ya no vale; la nueva sí.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'cambia@test.dintel.es', password: 'Original123!' })
        .expect(401);
      const loggedIn = await loginUser(
        app,
        'cambia@test.dintel.es',
        'Nueva123!',
      );
      expect(loggedIn.accessToken).toEqual(expect.any(String));
    });

    it('rechaza el cambio con la contraseña actual equivocada, con 401', async () => {
      const tokens = await registerUser(app, {
        email: 'rechaza@test.dintel.es',
        password: 'Original123!',
      });
      await authed(app, tokens.accessToken)
        .patch('/auth/password')
        .send({ currentPassword: 'Otra123!', newPassword: 'Nueva123!' })
        .expect(401);
    });

    it('exige token', async () => {
      await request(app.getHttpServer())
        .patch('/auth/password')
        .send({ currentPassword: 'a', newPassword: 'Nueva123!' })
        .expect(401);
    });
  });
});
