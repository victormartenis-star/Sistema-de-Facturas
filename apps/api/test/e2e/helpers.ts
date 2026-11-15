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
}

/**
 * `POST /auth/register`: solo sirve para el bootstrap. El primer usuario de
 * la empresa sale siempre `admin`; con la empresa ya poblada el registro
 * público está cerrado (403). Para crear usuarios con otro rol usa
 * `createUserWithRole`.
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
    })
    .expect(201);
  return res.body as AuthTokensDto;
}

/**
 * Crea un usuario con el rol dado vía `POST /users` (como admin) y devuelve
 * sus tokens tras iniciar sesión. No relaja el registro público.
 */
export async function createUserWithRole(
  app: INestApplication,
  adminToken: string,
  role: UserRole,
  overrides: RegisterOverrides = {},
): Promise<AuthTokensDto> {
  const email = overrides.email ?? uniqueEmail(role);
  const password = overrides.password ?? 'Test1234!';
  await authed(app, adminToken)
    .post('/users')
    .send({
      email,
      password,
      fullName: overrides.fullName ?? 'Usuario de Prueba',
      role,
    })
    .expect(201);
  return loginUser(app, email, password);
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

interface PhaseShape {
  id: string;
  code: string;
  [key: string]: unknown;
}

/** `POST /projects/:projectId/phases` como el usuario del token dado. */
export async function createPhase(
  app: INestApplication,
  token: string,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<PhaseShape> {
  const res = await authed(app, token)
    .post(`/projects/${projectId}/phases`)
    .send({
      code: `FASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Fase de pruebas',
      ...overrides,
    })
    .expect(201);
  return res.body as PhaseShape;
}

interface BudgetShape {
  id: string;
  status: string;
  [key: string]: unknown;
}

/** `POST /projects/:projectId/budgets` como el usuario del token dado. */
export async function createBudget(
  app: INestApplication,
  token: string,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<BudgetShape> {
  const res = await authed(app, token)
    .post(`/projects/${projectId}/budgets`)
    .send({ name: 'Presupuesto de pruebas', ...overrides })
    .expect(201);
  return res.body as BudgetShape;
}

/**
 * Valor de `If-Match` para una versión: `"3"`. Desde que `EXIGIR_VERSION`
 * vale `true` por defecto, todo PATCH/DELETE de una entidad versionada
 * (presupuestos, partidas, facturas, albaranes, líneas de certificación,
 * pedidos…) debe llevarlo.
 */
export function ifMatch(version: unknown): string {
  return `"${String(version)}"`;
}

/** Lee `version` con un GET a `url` y la devuelve ya como valor de `If-Match`. */
export async function ifMatchDe(
  app: INestApplication,
  token: string,
  url: string,
): Promise<string> {
  const res = await authed(app, token).get(url).expect(200);
  return ifMatch((res.body as { version: unknown }).version);
}

/** `If-Match` de una entidad sin GET por id (p. ej. albaranes): se lee de su listado. */
export async function ifMatchDeLista(
  app: INestApplication,
  token: string,
  listUrl: string,
  id: string,
): Promise<string> {
  const res = await authed(app, token).get(listUrl).expect(200);
  const fila = (res.body as { id: string; version: unknown }[]).find(
    (f) => f.id === id,
  );
  if (!fila) throw new Error(`${id} no aparece en ${listUrl}`);
  return ifMatch(fila.version);
}

/** `If-Match` de una partida (no hay GET por id: se lee del detalle del presupuesto). */
export async function ifMatchPartida(
  app: INestApplication,
  token: string,
  budgetId: string,
  itemId: string,
): Promise<string> {
  const res = await authed(app, token).get(`/budgets/${budgetId}`).expect(200);
  const item = (
    res.body as { items: { id: string; version: unknown }[] }
  ).items.find((i) => i.id === itemId);
  if (!item) throw new Error(`Partida ${itemId} no encontrada`);
  return ifMatch(item.version);
}

/** `PATCH /budgets/:id` para pasarlo a `activo` (necesario para el BAC del control de costes). */
export async function activateBudget(
  app: INestApplication,
  token: string,
  budgetId: string,
): Promise<void> {
  await authed(app, token)
    .patch(`/budgets/${budgetId}`)
    .set('If-Match', await ifMatchDe(app, token, `/budgets/${budgetId}`))
    .send({ status: 'activo' })
    .expect(200);
}

interface BudgetItemShape {
  id: string;
  [key: string]: unknown;
}

/** `POST /budgets/:budgetId/items` como el usuario del token dado. */
export async function addBudgetItem(
  app: INestApplication,
  token: string,
  budgetId: string,
  overrides: Record<string, unknown> = {},
): Promise<BudgetItemShape> {
  const res = await authed(app, token)
    .post(`/budgets/${budgetId}/items`)
    .send({
      code: `PARTIDA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Partida de pruebas',
      unit: 'm2',
      unitPrice: 10,
      quantity: 100,
      level: 3,
      ...overrides,
    })
    .expect(201);
  return res.body as BudgetItemShape;
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
