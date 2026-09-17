import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  authed,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Search (integración) — buscador global con trigramas', () => {
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

  it('encuentra un documento por nombre, tolerando una errata', async () => {
    const admin = await registerUser(app);
    await authed(app, admin.accessToken)
      .post('/documents')
      .attach('file', Buffer.from('%PDF-1.4 contenido'), {
        filename: 'certificacion-final-obra-A1.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const exact = (
      await authed(app, admin.accessToken)
        .get('/search?q=certificacion')
        .expect(200)
    ).body as { type: string; title: string }[];
    expect(exact.some((r) => r.type === 'documento')).toBe(true);

    // Errata deliberada: "certificacon" en vez de "certificación/certificacion".
    const typo = (
      await authed(app, admin.accessToken)
        .get('/search?q=certificacon')
        .expect(200)
    ).body as { type: string; title: string }[];
    expect(
      typo.some(
        (r) => r.type === 'documento' && r.title.includes('certificacion'),
      ),
    ).toBe(true);
  });

  it('encuentra una factura por el nombre del cliente', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      legalName: 'Construcciones Peñalver SL',
    });
    await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: contact.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-17',
        lines: [
          {
            description: 'Certificación',
            baseAmount: 500,
            vatPct: 21,
            projectId: project.id,
          },
        ],
      })
      .expect(201);

    const res = (
      await authed(app, admin.accessToken).get('/search?q=Peñalver').expect(200)
    ).body as { type: string; subtitle: string }[];
    expect(
      res.some((r) => r.type === 'factura' && r.subtitle.includes('Peñalver')),
    ).toBe(true);
  });

  it('un usuario `obra` sin acceso no ve documentos de una obra ajena', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    await authed(app, admin.accessToken)
      .post('/documents')
      .field('projectId', project.id)
      .attach('file', Buffer.from('%PDF-1.4 x'), {
        filename: 'albaran-restringido.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const { tokens: obraTokens } = await createObraUser(
      app,
      admin.accessToken,
      [],
    );
    const res = (
      await authed(app, obraTokens.accessToken)
        .get('/search?q=albaran')
        .expect(200)
    ).body as unknown[];
    expect(res).toEqual([]);
  });

  it('una búsqueda demasiado corta o sin coincidencias devuelve vacío', async () => {
    const admin = await registerUser(app);
    const short = (
      await authed(app, admin.accessToken).get('/search?q=a').expect(200)
    ).body;
    expect(short).toEqual([]);

    const noMatch = (
      await authed(app, admin.accessToken)
        .get('/search?q=xyzxyzqwerty')
        .expect(200)
    ).body;
    expect(noMatch).toEqual([]);
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/search?q=algo').expect(401);
  });
});
