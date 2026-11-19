import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  ifMatch,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Bloque 2 (maestros): control optimista en obras y contactos (If-Match) y
 * contrato RFC 7807 con `errorCode` de dominio.
 */
describe('Maestros (integración) — concurrencia y errores RFC 7807', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    token = (await registerUser(app, { email: 'admin@test.dintel.es' }))
      .accessToken;
  });

  function verificarContrato(
    res: request.Response,
    status: number,
    errorCode: string,
  ) {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.errorCode).toBe(errorCode);
    expect(res.body.type).toBe(`https://erp-dintel/errores/${errorCode}`);
    expect(res.body.correlationId).toBe(res.headers['x-request-id']);
  }

  it('obra: el PATCH sin If-Match responde 428 PRECONDITION_REQUIRED', async () => {
    const obra = await createProject(app, token);
    const res = await authed(app, token)
      .patch(`/projects/${obra.id}`)
      .send({ name: 'Sin versión' });
    verificarContrato(res, 428, 'PRECONDITION_REQUIRED');
  });

  it('obra: con versión obsoleta responde 409 VERSION_CONFLICT y no escribe', async () => {
    const obra = await createProject(app, token);
    // Otro usuario modifica la obra: la versión avanza.
    await authed(app, token)
      .patch(`/projects/${obra.id}`)
      .set('If-Match', ifMatch(obra.version))
      .send({ name: 'Primera edición' })
      .expect(200);

    const res = await authed(app, token)
      .patch(`/projects/${obra.id}`)
      .set('If-Match', ifMatch(obra.version))
      .send({ name: 'Edición con versión vieja' });
    verificarContrato(res, 409, 'VERSION_CONFLICT');
    expect(res.body.versionActual).toBe(Number(obra.version) + 1);

    const actual = await authed(app, token).get(`/projects/${obra.id}`);
    expect(actual.body.name).toBe('Primera edición');
  });

  it('obra inexistente en PATCH: 404 PROJECT_NOT_FOUND', async () => {
    const res = await authed(app, token)
      .patch(`/projects/${randomUUID()}`)
      .set('If-Match', ifMatch(1))
      .send({ name: 'x' });
    verificarContrato(res, 404, 'PROJECT_NOT_FOUND');
  });

  it('contacto: el DELETE con versión obsoleta responde 409 y el contacto sigue activo', async () => {
    const contacto = await createContact(app, token);
    await authed(app, token)
      .patch(`/contacts/${contacto.id}`)
      .set('If-Match', ifMatch(contacto.version))
      .send({ email: 'nuevo@test.dintel.es' })
      .expect(200);

    const res = await authed(app, token)
      .delete(`/contacts/${contacto.id}`)
      .set('If-Match', ifMatch(contacto.version));
    verificarContrato(res, 409, 'VERSION_CONFLICT');

    await authed(app, token).get(`/contacts`).expect(200);
  });

  it('contacto: NIF/CIF repetido: 409 CONTACT_TAX_ID_DUPLICATED', async () => {
    await createContact(app, token, { taxId: 'B12345678' });
    const res = await authed(app, token).post('/contacts').send({
      kind: 'proveedor',
      legalName: 'Otro proveedor SL',
      taxId: 'B12345678',
    });
    verificarContrato(res, 409, 'CONTACT_TAX_ID_DUPLICATED');
  });

  it('contacto inexistente en PATCH: 404 CONTACT_NOT_FOUND', async () => {
    const res = await authed(app, token)
      .patch(`/contacts/${randomUUID()}`)
      .set('If-Match', ifMatch(1))
      .send({ email: 'x@test.dintel.es' });
    verificarContrato(res, 404, 'CONTACT_NOT_FOUND');
  });
});
