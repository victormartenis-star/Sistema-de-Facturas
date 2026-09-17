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

describe('Invoices (integración) — creación y RBAC por obra', () => {
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

  /** Body mínimo válido de `POST /invoices` para una obra y contacto dados. */
  function invoiceBody(
    contactId: string,
    projectId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      kind: 'venta',
      contactId,
      invoiceNumber: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      issueDate: '2026-09-14',
      lines: [
        {
          description: 'Certificación mensual',
          baseAmount: 1000,
          vatPct: 21,
          projectId,
        },
      ],
      ...overrides,
    };
  }

  it('un admin puede crear una factura de venta con una línea imputada a una obra', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });

    const res = await authed(app, admin.accessToken)
      .post('/invoices')
      .send(invoiceBody(contact.id as string, project.id))
      .expect(201);

    expect(res.body.status).toBe('borrador');
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].projectId).toBe(project.id);
  });

  it('rechaza una factura sin líneas con 400 (ZodValidationPipe)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const contact = await createContact(app, admin.accessToken);
    await authed(app, admin.accessToken)
      .post('/invoices')
      .send(invoiceBody(contact.id as string, project.id, { lines: [] }))
      .expect(400);
  });

  it('rechaza un contacto inexistente con 404', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    await authed(app, admin.accessToken)
      .post('/invoices')
      .send(invoiceBody('00000000-0000-0000-0000-000000000000', project.id))
      .expect(404);
  });

  describe('RBAC por obra (rol `obra`)', () => {
    it('un usuario `obra` solo ve en el listado las facturas con líneas de sus obras', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const projectA = await createProject(app, admin.accessToken, {
        code: `A-${Date.now()}`,
      });
      const projectB = await createProject(app, admin.accessToken, {
        code: `B-${Date.now()}`,
      });
      const contact = await createContact(app, admin.accessToken);

      await authed(app, admin.accessToken)
        .post('/invoices')
        .send(invoiceBody(contact.id as string, projectA.id))
        .expect(201);
      await authed(app, admin.accessToken)
        .post('/invoices')
        .send(invoiceBody(contact.id as string, projectB.id))
        .expect(201);

      const { tokens: obraTokens } = await createObraUser(
        app,
        admin.accessToken,
        [projectA.id],
      );

      const res = await authed(app, obraTokens.accessToken)
        .get('/invoices')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].lines[0].projectId).toBe(projectA.id);
    });

    it('un usuario `obra` sin obras asignadas no ve ninguna factura', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project = await createProject(app, admin.accessToken);
      const contact = await createContact(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .post('/invoices')
        .send(invoiceBody(contact.id as string, project.id))
        .expect(201);

      const { tokens: obraTokens } = await createObraUser(
        app,
        admin.accessToken,
        [],
      );
      const res = await authed(app, obraTokens.accessToken)
        .get('/invoices')
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('un usuario `obra` recibe 404 (no 403) al pedir el detalle de una factura fuera de sus obras — no delata que exista', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const projectA = await createProject(app, admin.accessToken, {
        code: `A-${Date.now()}`,
      });
      const projectB = await createProject(app, admin.accessToken, {
        code: `B-${Date.now()}`,
      });
      const contact = await createContact(app, admin.accessToken);
      const invoiceB = await authed(app, admin.accessToken)
        .post('/invoices')
        .send(invoiceBody(contact.id as string, projectB.id))
        .expect(201);

      const { tokens: obraTokens } = await createObraUser(
        app,
        admin.accessToken,
        [projectA.id],
      );
      await authed(app, obraTokens.accessToken)
        .get(`/invoices/${invoiceB.body.id}`)
        .expect(404);
    });

    it(
      '`POST /invoices` rechaza con 404 una factura cuya obra no es accesible, sin dejarla huérfana ' +
        '(antes se insertaba igual y solo el `get()` posterior de `create()` la delataba con 404, dejando la fila creada e invisible para quien la creó)',
      async () => {
        const admin = await registerUser(app, {
          email: 'admin@test.dintel.es',
        });
        const projectA = await createProject(app, admin.accessToken, {
          code: `A-${Date.now()}`,
        });
        const projectB = await createProject(app, admin.accessToken, {
          code: `B-${Date.now()}`,
        });
        const contact = await createContact(app, admin.accessToken);
        const { tokens: obraTokens } = await createObraUser(
          app,
          admin.accessToken,
          [projectA.id],
        );

        await authed(app, obraTokens.accessToken)
          .post('/invoices')
          .send(invoiceBody(contact.id as string, projectB.id))
          .expect(404);

        // Nada huérfano: `InvoicesService.create()` comprueba
        // `getObrasAccesibles()` antes del INSERT, así que la factura
        // rechazada no llega a existir ni para un admin.
        const res = await authed(app, admin.accessToken)
          .get('/invoices')
          .expect(200);
        const orphan = (
          res.body as Array<{ lines: Array<{ projectId: string }> }>
        ).find((inv) => inv.lines.some((l) => l.projectId === projectB.id));
        expect(orphan).toBeUndefined();
      },
    );
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer()).get('/invoices').expect(401);
  });
});
