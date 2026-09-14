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

describe('Certifications (integración) — creación, facturación y RBAC por obra', () => {
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

  it('un admin puede crear una certificación a origen sobre una obra con importe de contrato', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken, {
      contractAmount: 200_000,
    });

    const res = await authed(app, admin.accessToken)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 25,
      })
      .expect(201);

    expect(res.body.status).toBe('borrador');
    expect(res.body.seq).toBe(1);
    expect(Number(res.body.cumulativeAmount)).toBeCloseTo(50_000, 2);
  });

  it('rechaza certificar una obra sin importe de contrato con 409', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken, {
      contractAmount: null,
    });
    await authed(app, admin.accessToken)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 10,
      })
      .expect(409);
  });

  it('rechaza una segunda certificación con % a origen igual o menor que la anterior', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken, {
      contractAmount: 100_000,
    });
    await authed(app, admin.accessToken)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 30,
      })
      .expect(201);
    await authed(app, admin.accessToken)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-15',
        cumulativePct: 30,
      })
      .expect(409);
  });

  it('POST /certifications/:id/facturar genera y aprueba la factura de venta correspondiente', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken, {
      contractAmount: 100_000,
    });
    const client = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    const cert = await authed(app, admin.accessToken)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 40,
      })
      .expect(201);

    const res = await authed(app, admin.accessToken)
      .post(`/certifications/${cert.body.id}/facturar`)
      .send({
        contactId: client.id,
        invoiceNumber: `CERT-${Date.now()}`,
        issueDate: '2026-09-14',
        isp: true,
      })
      .expect(201);

    expect(res.body.status).toBe('facturada');
  });

  describe('RBAC por obra (rol `obra`)', () => {
    it('un usuario `obra` solo ve en el listado las certificaciones de sus obras', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const projectA = await createProject(app, admin.accessToken, {
        code: `A-${Date.now()}`,
        contractAmount: 100_000,
      });
      const projectB = await createProject(app, admin.accessToken, {
        code: `B-${Date.now()}`,
        contractAmount: 100_000,
      });
      await authed(app, admin.accessToken)
        .post('/certifications')
        .send({
          projectId: projectA.id,
          certDate: '2026-09-14',
          cumulativePct: 10,
        })
        .expect(201);
      await authed(app, admin.accessToken)
        .post('/certifications')
        .send({
          projectId: projectB.id,
          certDate: '2026-09-14',
          cumulativePct: 10,
        })
        .expect(201);

      const { tokens: obraTokens } = await createObraUser(
        app,
        admin.accessToken,
        [projectA.id],
      );
      const res = await authed(app, obraTokens.accessToken)
        .get('/certifications')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].projectId).toBe(projectA.id);
    });

    it(
      'gap conocido (ver Roadmap y Fases, deuda técnica): `certifications.service.ts` solo filtra por obra en `list()`, ' +
        'no en la creación — este test documenta el comportamiento actual, no lo aprueba',
      async () => {
        const admin = await registerUser(app, {
          email: 'admin@test.dintel.es',
        });
        const projectB = await createProject(app, admin.accessToken, {
          contractAmount: 100_000,
        });
        const { tokens: obraTokens } = await createObraUser(
          app,
          admin.accessToken,
          [],
        );

        // Hoy responde 201 aunque el usuario `obra` no tiene ninguna obra
        // asignada — comportamiento real, no deseado.
        await authed(app, obraTokens.accessToken)
          .post('/certifications')
          .send({
            projectId: projectB.id,
            certDate: '2026-09-14',
            cumulativePct: 10,
          })
          .expect(201);
      },
    );
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer()).get('/certifications').expect(401);
  });
});
