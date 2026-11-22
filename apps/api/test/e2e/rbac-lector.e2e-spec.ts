import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import {
  authed,
  createProject,
  createTestApp,
  ifMatch,
  loginUser,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator';
import { ALLOW_READ_ONLY_KEY } from '../../src/auth/read-only.guard';

const UUID = '00000000-0000-4000-8000-000000000001';

interface Ruta {
  metodo: string;
  ruta: string;
  publica: boolean;
  permiteLector: boolean;
}

const NOMBRES_METODO: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
};

function unir(...partes: string[]): string {
  return (
    '/' +
    partes
      .map((p) => p.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/')
  );
}

/** Recorre todos los controladores registrados y devuelve sus rutas con los metadatos de guards. */
function listarRutas(app: INestApplication): Ruta[] {
  const rutas: Ruta[] = [];
  const modulos = app.get(ModulesContainer);
  for (const modulo of modulos.values()) {
    for (const wrapper of modulo.controllers.values()) {
      const clase = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!clase) continue;
      const base = Reflect.getMetadata(PATH_METADATA, clase) as
        string | string[] | undefined;
      if (base === undefined) continue;
      const prefijo = Array.isArray(base) ? base[0] : base;
      const claseMeta = (k: string) =>
        Reflect.getMetadata(k, clase) as boolean | undefined;
      for (const nombre of Object.getOwnPropertyNames(clase.prototype)) {
        if (nombre === 'constructor') continue;
        const handler = (clase.prototype as Record<string, unknown>)[nombre];
        if (typeof handler !== 'function') continue;
        const metodo = Reflect.getMetadata(METHOD_METADATA, handler) as
          number | undefined;
        if (metodo === undefined) continue;
        const nombreMetodo = NOMBRES_METODO[metodo];
        if (!nombreMetodo) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as
          string | string[];
        const handlerMeta = (k: string) =>
          Reflect.getMetadata(k, handler) as boolean | undefined;
        rutas.push({
          metodo: nombreMetodo,
          ruta: unir(prefijo, Array.isArray(sub) ? sub[0] : sub),
          publica: Boolean(
            handlerMeta(IS_PUBLIC_KEY) ?? claseMeta(IS_PUBLIC_KEY),
          ),
          permiteLector: Boolean(
            handlerMeta(ALLOW_READ_ONLY_KEY) ?? claseMeta(ALLOW_READ_ONLY_KEY),
          ),
        });
      }
    }
  }
  return rutas;
}

describe('RBAC rol lector (integración) — solo lectura', () => {
  let app: INestApplication;
  let adminToken: string;
  let lectorToken: string;
  let lectorRefresh: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    const admin = await registerUser(app);
    adminToken = admin.accessToken;
    await authed(app, adminToken)
      .post('/users')
      .send({
        email: 'lector@test.dintel.es',
        password: 'Test1234!',
        fullName: 'Lector de Pruebas',
        role: 'lector',
      })
      .expect(201);
    const tokens = await loginUser(app, 'lector@test.dintel.es', 'Test1234!');
    lectorToken = tokens.accessToken;
    lectorRefresh = tokens.refreshToken;
  });

  it('un admin puede cambiar a un usuario al rol lector', async () => {
    const otro = (
      await authed(app, adminToken)
        .post('/users')
        .send({
          email: 'otro@test.dintel.es',
          password: 'Test1234!',
          fullName: 'Otro',
          role: 'administracion',
        })
        .expect(201)
    ).body as { id: string; version: number };
    const res = await authed(app, adminToken)
      .patch(`/users/${otro.id}`)
      .set('If-Match', ifMatch(otro.version))
      .send({ role: 'lector' })
      .expect(200);
    expect((res.body as { role: string }).role).toBe('lector');
  });

  it('el lector puede leer con GET (empresa completa, como gerente)', async () => {
    const obra = await createProject(app, adminToken);
    const client = authed(app, lectorToken);
    const lista = (await client.get('/projects').expect(200)).body as {
      id: string;
    }[];
    expect(lista.map((p) => p.id)).toContain(obra.id);
    await client.get('/certifications').expect(200);
    await client.get(`/projects/${obra.id}/cost-control`).expect(200);
  });

  it('el lector no puede escribir: POST/PATCH/PUT/DELETE devuelven 403 y nada cambia', async () => {
    const obra = await createProject(app, adminToken);
    const client = authed(app, lectorToken);

    const rechazo = await client
      .post('/projects')
      .send({ code: 'X-1', name: 'No debe crearse', contractAmount: 1 })
      .expect(403);
    expect((rechazo.body as { message: string }).message).toMatch(
      /solo lectura/i,
    );
    await client
      .patch(`/projects/${obra.id}`)
      .send({ name: 'Cambiada' })
      .expect(403);
    await client
      .put(`/users/${UUID}/acceso-obras`)
      .send({ projectIds: [] })
      .expect(403);
    await client.delete(`/budgets/${UUID}`).expect(403);

    const lista = (await authed(app, adminToken).get('/projects').expect(200))
      .body as { id: string; name: string }[];
    expect(lista).toHaveLength(1);
    expect(lista[0].name).toBe('Obra de pruebas');
  });

  it('login, refresh y logout siguen funcionando para el lector; cambiar su contraseña también', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'lector@test.dintel.es', password: 'Test1234!' })
      .expect(200);
    const refrescado = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: lectorRefresh })
      .expect(200);
    const nuevo = refrescado.body as {
      accessToken: string;
      refreshToken: string;
    };
    await authed(app, nuevo.accessToken)
      .patch('/auth/password')
      .send({ currentPassword: 'Test1234!', newPassword: 'Nueva1234!' })
      .expect(204);
    const salida = await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: nuevo.refreshToken });
    expect([200, 204]).toContain(salida.status);
  });

  it('regresión: administracion sigue escribiendo y un cliente de portal sigue fuera (opt-in)', async () => {
    for (const [email, role] of [
      ['adm@test.dintel.es', 'administracion'],
      ['cli@test.dintel.es', 'cliente'],
    ]) {
      await authed(app, adminToken)
        .post('/users')
        .send({ email, password: 'Test1234!', fullName: role, role })
        .expect(201);
    }
    const adm = await loginUser(app, 'adm@test.dintel.es', 'Test1234!');
    const cli = await loginUser(app, 'cli@test.dintel.es', 'Test1234!');
    await createProject(app, adm.accessToken);
    await authed(app, cli.accessToken).get('/projects').expect(403);
  });

  it('barrido: toda ruta de escritura registrada rechaza al lector con 403, salvo la lista blanca', async () => {
    const escrituras = listarRutas(app).filter((r) => r.metodo !== 'GET');
    // Sanidad: si el recorrido de metadatos fallara, el test pasaría en vacío.
    expect(escrituras.length).toBeGreaterThan(100);

    const excepciones = escrituras
      .filter((r) => r.permiteLector)
      .map((r) => `${r.metodo} ${r.ruta}`);
    expect(excepciones).toEqual(['PATCH /auth/password']);

    const client = authed(app, lectorToken);
    const fallos: string[] = [];
    for (const r of escrituras) {
      if (r.publica || r.permiteLector) continue;
      const url = r.ruta.replace(/:[A-Za-z0-9_]+/g, UUID);
      const verbo = r.metodo.toLowerCase() as
        'post' | 'put' | 'patch' | 'delete';
      const res = await client[verbo](url).send({});
      const mensaje = (res.body as { message?: string })?.message ?? '';
      if (res.status !== 403 || !/solo lectura/i.test(String(mensaje))) {
        fallos.push(`${r.metodo} ${r.ruta} -> ${res.status}`);
      }
    }
    expect(fallos).toEqual([]);
  });
});
