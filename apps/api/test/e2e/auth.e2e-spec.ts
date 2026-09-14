import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthTokensDto } from '@erp/shared';
import { createTestApp, loginUser, registerUser } from './helpers';
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
    it('registra al primer usuario de la empresa como admin', async () => {
      const tokens = await registerUser(app, {
        email: 'primero@test.dintel.es',
        role: 'obra', // pedido explícitamente, pero el primero siempre es admin
      });
      expect(tokens.user.role).toBe('admin');
      expect(tokens.user.email).toBe('primero@test.dintel.es');
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toEqual(expect.any(String));
      expect(tokens.expiresIn).toBeGreaterThan(0);
    });

    it('respeta el rol pedido a partir del segundo usuario', async () => {
      await registerUser(app, { email: 'admin@test.dintel.es' });
      const tokens = await registerUser(app, {
        email: 'obra@test.dintel.es',
        role: 'obra',
      });
      expect(tokens.user.role).toBe('obra');
    });

    it('rechaza un email duplicado con 409', async () => {
      await registerUser(app, { email: 'dup@test.dintel.es' });
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'dup@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Otro',
        })
        .expect(409);
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
});
