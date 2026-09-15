import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `documents` (Fase 11, cierre de cobertura): sube ficheros de verdad a
 * disco (`STORAGE_DIR` apunta a `storage/test/`, ver `jest.setup-env.ts`,
 * en vez del `storage/` de desarrollo) — no hay mock de `StorageService`,
 * igual que el resto de la suite no mockea Postgres.
 */
describe('Documents (integración) — subida y ciclo de vida', () => {
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

  it('sube un PDF, lo lista, lo descarga, lo actualiza y lo borra', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);

    const uploadRes = await authed(app, admin.accessToken)
      .post('/documents')
      .field('projectId', project.id)
      .field('docType', 'albaran')
      .attach('file', Buffer.from('%PDF-1.4 contenido de prueba'), {
        filename: 'albaran-001.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const docId = uploadRes.body.id as string;
    expect(uploadRes.body.status).toBe('subido');
    expect(uploadRes.body.docType).toBe('albaran');
    expect(uploadRes.body.projectId).toBe(project.id);

    const listRes = await authed(app, admin.accessToken)
      .get('/documents')
      .expect(200);
    expect(listRes.body).toHaveLength(1);

    const filteredByType = await authed(app, admin.accessToken)
      .get('/documents?docType=factura_compra')
      .expect(200);
    expect(filteredByType.body).toEqual([]);

    const fileRes = await authed(app, admin.accessToken)
      .get(`/documents/${docId}/file`)
      .expect(200);
    expect(fileRes.headers['content-type']).toBe('application/pdf');
    // `application/pdf` no es un tipo textual para supertest: los bytes
    // llegan en `res.body` (Buffer), no en `res.text` (que queda `undefined`).
    expect(Buffer.from(fileRes.body).toString()).toContain(
      'contenido de prueba',
    );

    const updateRes = await authed(app, admin.accessToken)
      .patch(`/documents/${docId}`)
      .send({ docType: 'factura_compra' })
      .expect(200);
    expect(updateRes.body.docType).toBe('factura_compra');

    await authed(app, admin.accessToken)
      .delete(`/documents/${docId}`)
      .expect(204);
    const afterDelete = await authed(app, admin.accessToken)
      .get('/documents')
      .expect(200);
    expect(afterDelete.body).toEqual([]);
    // Borrado lógico: 404 al pedirlo, pero el original queda en disco (retención legal).
    await authed(app, admin.accessToken).get(`/documents/${docId}`).expect(404);
  });

  it('rechaza con 400 un tipo de archivo no admitido', async () => {
    const admin = await registerUser(app);
    const res = await authed(app, admin.accessToken)
      .post('/documents')
      .attach('file', Buffer.from('no soy un pdf'), {
        filename: 'nota.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    expect(res.body.message).toContain('no admitido');
  });

  it('rechaza con 400 si no se adjunta ningún archivo', async () => {
    const admin = await registerUser(app);
    const res = await authed(app, admin.accessToken)
      .post('/documents')
      .field('docType', 'otro')
      .expect(400);
    expect(res.body.message).toContain('archivo');
  });

  it('rechaza con 409 subir dos veces el mismo archivo (mismo hash)', async () => {
    const admin = await registerUser(app);
    const content = Buffer.from('%PDF-1.4 mismo contenido siempre');

    await authed(app, admin.accessToken)
      .post('/documents')
      .attach('file', content, {
        filename: 'original.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const res = await authed(app, admin.accessToken)
      .post('/documents')
      .attach('file', content, {
        filename: 'duplicado.pdf',
        contentType: 'application/pdf',
      })
      .expect(409);
    expect(res.body.message).toContain('ya está en el sistema');
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/documents').expect(401);
  });
});
