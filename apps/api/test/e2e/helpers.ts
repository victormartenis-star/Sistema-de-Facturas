import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthTokensDto, UserRole } from '@erp/shared';
import { TestAppModule } from './test-app.module';

/** Arranca la app de pruebas (ver `test-app.module.ts` para qué lleva y qué no). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

let userCounter = 0;
/** Email único por llamada — evita colisiones entre tests dentro del mismo fichero. */
function uniqueEmail(prefix: string): string {
  userCounter += 1;
  return `${prefix}-${Date.now()}-${userCounter}@test.dintel.es`;
}

export interface RegisterOverrides {
  email?: string;
  password?: string;
  fullName?: string;
  role?: UserRole;
}

/**
 * `POST /auth/register`. El primer usuario de la empresa siempre sale
 * `admin` sin importar el `role` pedido (regla de `AuthService.register`,
 * MVP monoempresa) — para un `obra`/`gerente`/`administracion` de verdad
 * hace falta que ya haya un admin registrado antes.
 */
export async function registerUser(
  app: INestApplication,
  overrides: RegisterOverrides = {},
): Promise<AuthTokensDto> {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      email: overrides.email ?? uniqueEmail('user'),
      password: overrides.password ?? 'Test1234!',
      fullName: overrides.fullName ?? 'Usuario de Prueba',
      role: overrides.role,
    })
    .expect(201);
  return res.body as AuthTokensDto;
}

export async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<AuthTokensDto> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body as AuthTokensDto;
}

/** `supertest` con `Authorization: Bearer <token>` ya puesto en cada verbo. */
export function authed(app: INestApplication, token: string) {
  const server = app.getHttpServer();
  const withAuth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => withAuth(request(server).get(url)),
    post: (url: string) => withAuth(request(server).post(url)),
    patch: (url: string) => withAuth(request(server).patch(url)),
    put: (url: string) => withAuth(request(server).put(url)),
    delete: (url: string) => withAuth(request(server).delete(url)),
  };
}

interface ProjectShape {
  id: string;
  [key: string]: unknown;
}

/** `POST /projects` como el usuario del token dado (pensado para un admin). */
export async function createProject(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<ProjectShape> {
  const res = await authed(app, token)
    .post('/projects')
    .send({
      code: `OBRA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Obra de pruebas',
      contractAmount: 100_000,
      ...overrides,
    })
    .expect(201);
  return res.body as ProjectShape;
}

interface ContactShape {
  id: string;
  [key: string]: unknown;
}

/** `POST /contacts` como el usuario del token dado. */
export async function createContact(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<ContactShape> {
  const res = await authed(app, token)
    .post('/contacts')
    .send({
      kind: 'cliente',
      legalName: 'Cliente de Pruebas SL',
      ...overrides,
    })
    .expect(201);
  return res.body as ContactShape;
}

/**
 * Crea un usuario con rol `obra` vía `POST /users` (como admin), le asigna
 * acceso a las obras dadas y devuelve sus tokens ya logueado — el atajo
 * completo que necesita cualquier test de RBAC por obra.
 */
export async function createObraUser(
  app: INestApplication,
  adminToken: string,
  projectIds: string[],
): Promise<{ id: string; tokens: AuthTokensDto }> {
  const email = uniqueEmail('obra');
  const password = 'Test1234!';
  const res = await authed(app, adminToken)
    .post('/users')
    .send({
      email,
      password,
      fullName: 'Usuario de Obra',
      role: 'obra',
    })
    .expect(201);
  const userId = (res.body as { id: string }).id;
  await authed(app, adminToken)
    .put(`/users/${userId}/acceso-obras`)
    .send({ projectIds })
    .expect(204);
  const tokens = await loginUser(app, email, password);
  return { id: userId, tokens };
}
