import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  addBudgetItem,
  authed,
  createBudget,
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

  it('las líneas de una certificación facturada no se pueden crear, editar ni borrar (409)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken, {
      contractAmount: 100_000,
    });
    const client = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    const budget = await createBudget(app, admin.accessToken, project.id);
    const item1 = await addBudgetItem(app, admin.accessToken, budget.id);
    const item2 = await addBudgetItem(app, admin.accessToken, budget.id);
    const cert = await authed(app, admin.accessToken)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 40,
      })
      .expect(201);
    const lines = `/certifications/${cert.body.id}/lines`;
    const line = await authed(app, admin.accessToken)
      .post(lines)
      .send({
        budgetItemId: item1.id,
        cumulativePct: 40,
        cumulativeAmount: 400,
        periodAmount: 400,
      })
      .expect(201);

    // En borrador sí se puede editar.
    await authed(app, admin.accessToken)
      .patch(`${lines}/${line.body.id}`)
      .send({ periodAmount: 410 })
      .expect(200);

    await authed(app, admin.accessToken)
      .post(`/certifications/${cert.body.id}/facturar`)
      .send({
        contactId: client.id,
        invoiceNumber: `CERT-${Date.now()}`,
        issueDate: '2026-09-14',
        isp: true,
      })
      .expect(201);

    await authed(app, admin.accessToken)
      .post(lines)
      .send({
        budgetItemId: item2.id,
        cumulativePct: 10,
        cumulativeAmount: 100,
        periodAmount: 100,
      })
      .expect(409);
    await authed(app, admin.accessToken)
      .patch(`${lines}/${line.body.id}`)
      .send({ periodAmount: 999 })
      .expect(409);
    await authed(app, admin.accessToken)
      .delete(`${lines}/${line.body.id}`)
      .expect(409);
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

    it('un usuario `obra` sin acceso a la obra no puede crear una certificación en ella (404)', async () => {
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

      await authed(app, obraTokens.accessToken)
        .post('/certifications')
        .send({
          projectId: projectB.id,
          certDate: '2026-09-14',
          cumulativePct: 10,
        })
        .expect(404);
    });
  });

  describe('certificación rectificativa', () => {
    async function certFacturada(
      token: string,
      projectId: string,
      clienteId: string,
      pct: number,
    ) {
      const cert = await authed(app, token)
        .post('/certifications')
        .send({ projectId, certDate: '2026-09-14', cumulativePct: pct })
        .expect(201);
      const res = await authed(app, token)
        .post(`/certifications/${cert.body.id}/facturar`)
        .send({
          contactId: clienteId,
          invoiceNumber: `CERT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          issueDate: '2026-09-14',
          isp: true,
        })
        .expect(201);
      return res.body as { id: string; invoiceId: string };
    }

    it('rectificar con un % menor crea periodo negativo y su facturación genera una rectificativa por diferencias', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const cliente = await createContact(app, token, { kind: 'cliente' });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);

      const rect = await authed(app, token)
        .post(`/certifications/${c1.id}/rectificar`)
        .send({
          certDate: '2026-10-01',
          cumulativePct: 35,
          motivo: 'La medición real era del 35 %',
        })
        .expect(201);
      expect(rect.body.status).toBe('borrador');
      expect(rect.body.seq).toBe(2);
      expect(rect.body.rectifiesCertificationId).toBe(c1.id);
      expect(rect.body.periodAmount).toBe(-5000);
      expect(rect.body.cumulativeAmount).toBe(35_000);

      const facturada = await authed(app, token)
        .post(`/certifications/${rect.body.id}/facturar`)
        .send({
          contactId: cliente.id,
          invoiceNumber: 'IGNORADO',
          issueDate: '2026-10-01',
        })
        .expect(201);
      expect(facturada.body.status).toBe('facturada');

      const inv = await authed(app, token)
        .get(`/invoices/${facturada.body.invoiceId}`)
        .expect(200);
      expect(inv.body.rectifiesInvoiceId).toBe(c1.invoiceId);
      expect(inv.body.rectificationKind).toBe('diferencias');
      expect(inv.body.baseAmount).toBe(-5000);
      expect(inv.body.invoiceNumber).toMatch(/^R-\d{4}-\d{4}$/);

      // La factura original sigue vigente.
      const orig = await authed(app, token)
        .get(`/invoices/${c1.invoiceId}`)
        .expect(200);
      expect(orig.body.status).toBe('aprobada');
    });

    it('rechaza rectificar una certificación en borrador (409)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const borrador = await authed(app, token)
        .post('/certifications')
        .send({
          projectId: project.id,
          certDate: '2026-09-14',
          cumulativePct: 20,
        })
        .expect(201);
      await authed(app, token)
        .post(`/certifications/${borrador.body.id}/rectificar`)
        .send({
          certDate: '2026-10-01',
          cumulativePct: 10,
          motivo: 'Sin facturar',
        })
        .expect(409);
    });

    it('un % superior al ya certificado no es una rectificación (409)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const cliente = await createContact(app, token, { kind: 'cliente' });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);
      await authed(app, token)
        .post(`/certifications/${c1.id}/rectificar`)
        .send({
          certDate: '2026-10-01',
          cumulativePct: 50,
          motivo: 'Subir no vale',
        })
        .expect(409);
    });

    it('la rectificativa total de la factura devuelve la certificación a borrador', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const cliente = await createContact(app, token, { kind: 'cliente' });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);

      const rect = await authed(app, token)
        .post(`/invoices/${c1.invoiceId}/rectificar`)
        .send({
          clase: 'total',
          issueDate: '2026-10-01',
          motivo: 'Cliente equivocado',
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(201);

      const list = await authed(app, token)
        .get(`/certifications?projectId=${project.id}`)
        .expect(200);
      const cert = (
        list.body as { id: string; status: string; invoiceId: string | null }[]
      ).find((c) => c.id === c1.id);
      expect(cert?.status).toBe('borrador');
      expect(cert?.invoiceId).toBeNull();
      const orig = await authed(app, token)
        .get(`/invoices/${c1.invoiceId}`)
        .expect(200);
      expect(orig.body.status).toBe('rectificada');
    });

    it('facturar la rectificativa a otro cliente que el de la factura original da 409', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const cliente = await createContact(app, token, { kind: 'cliente' });
      const otro = await createContact(app, token, {
        kind: 'cliente',
        legalName: 'Otro cliente SL',
      });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);
      const rect = await authed(app, token)
        .post(`/certifications/${c1.id}/rectificar`)
        .send({
          certDate: '2026-10-01',
          cumulativePct: 30,
          motivo: 'Medición a la baja',
        })
        .expect(201);
      await authed(app, token)
        .post(`/certifications/${rect.body.id}/facturar`)
        .send({
          contactId: otro.id,
          invoiceNumber: 'X',
          issueDate: '2026-10-01',
        })
        .expect(409);
    });

    it('RBAC: el rol obra no puede rectificar una certificación (403)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const cliente = await createContact(app, token, { kind: 'cliente' });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);
      const { tokens } = await createObraUser(app, token, [project.id]);
      await authed(app, tokens.accessToken)
        .post(`/certifications/${c1.id}/rectificar`)
        .send({
          certDate: '2026-10-01',
          cumulativePct: 30,
          motivo: 'Sin permiso',
        })
        .expect(403);
    });
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer()).get('/certifications').expect(401);
  });
});
