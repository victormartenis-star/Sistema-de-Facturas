import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, invoices } from '@erp/db';
import request from 'supertest';
import {
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  ifMatch,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import { validateFacturaeXsd } from './xsd-facturae';

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
    const editada = await authed(app, admin.accessToken)
      .patch(`${lines}/${line.body.id}`)
      .set('If-Match', ifMatch(line.body.version))
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
      .set('If-Match', ifMatch(editada.body.version))
      .send({ periodAmount: 999 })
      .expect(409);
    await authed(app, admin.accessToken)
      .delete(`${lines}/${line.body.id}`)
      .set('If-Match', ifMatch(editada.body.version))
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
          // <= 20 caracteres: es el máximo que admite Facturae en el bloque Corrective.
          invoiceNumber: `CERT-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
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
      const cliente = await createContact(app, token, {
        kind: 'cliente',
        taxId: 'B11111111', // Facturae exige NIF del cliente
      });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);

      const rect = await authed(app, token)
        .post(`/certifications/${c1.id}/rectificar`)
        .send({
          certDate: '2026-10-01',
          rectificationMotive: 'R4',
          rectificationType: 'I',
          facturaeReasonCode: '16',
          cumulativePct: 35,
          motivo: 'La medición real era del 35 %',
        })
        .expect(201);
      expect(rect.body.rectificationMotive).toBe('R4');
      expect(rect.body.rectificationType).toBe('I');
      expect(rect.body.facturaeReasonCode).toBe('16');
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
      expect(inv.body.rectificationMotive).toBe('R4');
      expect(inv.body.rectificationType).toBe('I');
      // La factura hereda el código de motivo Facturae de la certificación.
      expect(inv.body.facturaeReasonCode).toBe('16');
      const fx = await authed(app, token)
        .get(`/invoices/${facturada.body.invoiceId}/facturae`)
        .expect(200);
      const xsd = await validateFacturaeXsd(fx.text);
      expect(xsd.errors).toEqual([]);
      expect(xsd.valid).toBe(true);
      expect(fx.text).toContain('<InvoiceClass>OR</InvoiceClass>');
      expect(fx.text).toContain('<Corrective>');
      expect(fx.text).toContain('<ReasonCode>16</ReasonCode>');
      expect(fx.text).toContain('<CorrectionMethod>02</CorrectionMethod>');
      expect(inv.body.baseAmount).toBe(-5000);
      expect(inv.body.invoiceNumber).toMatch(/^R-\d{4}-\d{4}$/);

      // La factura original sigue vigente.
      const orig = await authed(app, token)
        .get(`/invoices/${c1.invoiceId}`)
        .expect(200);
      expect(orig.body.status).toBe('aprobada');
    });

    it('motivo y tipo oficiales: obligatorios y coherentes (400)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const cliente = await createContact(app, token, { kind: 'cliente' });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);
      const base = {
        certDate: '2026-10-01',
        cumulativePct: 35,
        motivo: 'La medición real era del 35 %',
      };
      const enviar = (cuerpo: object) =>
        authed(app, token)
          .post(`/certifications/${c1.id}/rectificar`)
          .send(cuerpo);
      const cod = { facturaeReasonCode: '16' };
      // Sin motivo
      await enviar({ ...base, ...cod, rectificationType: 'I' }).expect(400);
      // Sin tipo
      await enviar({ ...base, ...cod, rectificationMotive: 'R4' }).expect(400);
      // Motivo y tipo fuera de catálogo
      await enviar({
        ...base,
        ...cod,
        rectificationMotive: 'R9',
        rectificationType: 'I',
      }).expect(400);
      await enviar({
        ...base,
        ...cod,
        rectificationMotive: 'R4',
        rectificationType: 'X',
      }).expect(400);
      // Tipo incoherente: la certificación rectificativa es por diferencias (I)
      const incoherente = await enviar({
        ...base,
        ...cod,
        rectificationMotive: 'R4',
        rectificationType: 'S',
      }).expect(400);
      expect(JSON.stringify(incoherente.body)).toContain("tipo 'S'");
      const ok = await enviar({
        ...base,
        facturaeReasonCode: '85',
        rectificationMotive: 'R2',
        rectificationType: 'I',
      }).expect(201);
      expect(ok.body.rectificationMotive).toBe('R2');
      expect(ok.body.rectificationType).toBe('I');
      expect(ok.body.rectifiesCertificationId).toBe(c1.id);
    });

    it('código de motivo Facturae: obligatorio y acorde al motivo R1-R4 (400)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const token = admin.accessToken;
      const project = await createProject(app, token, {
        contractAmount: 100_000,
      });
      const cliente = await createContact(app, token, { kind: 'cliente' });
      const c1 = await certFacturada(token, project.id, cliente.id, 40);
      const base = {
        certDate: '2026-10-01',
        cumulativePct: 35,
        motivo: 'La medición real era del 35 %',
        rectificationMotive: 'R1',
        rectificationType: 'I',
      };
      const enviar = (cuerpo: object) =>
        authed(app, token)
          .post(`/certifications/${c1.id}/rectificar`)
          .send(cuerpo);
      // Sin código
      const sin = await enviar(base).expect(400);
      expect(JSON.stringify(sin.body)).toContain('código de motivo Facturae');
      // Código de otro motivo (85 es de R2/R3, no de R1)
      const otro = await enviar({ ...base, facturaeReasonCode: '85' }).expect(
        400,
      );
      expect(JSON.stringify(otro.body)).toContain(
        'no es válido para el motivo R1',
      );
      // Código inexistente
      await enviar({ ...base, facturaeReasonCode: '99' }).expect(400);
      // Nada se creó: sigue habiendo solo la certificación original
      const lista = await authed(app, token)
        .get(`/certifications?projectId=${project.id}`)
        .expect(200);
      expect(lista.body).toHaveLength(1);
      // Válido
      const ok = await enviar({ ...base, facturaeReasonCode: '83' }).expect(
        201,
      );
      expect(ok.body.facturaeReasonCode).toBe('83');
    });

    it('rectificativa de certificación antigua sin código: su factura da Facturae 409 claro', async () => {
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
          rectificationMotive: 'R4',
          rectificationType: 'I',
          facturaeReasonCode: '16',
          cumulativePct: 35,
          motivo: 'La medición real era del 35 %',
        })
        .expect(201);
      const facturada = await authed(app, token)
        .post(`/certifications/${rect.body.id}/facturar`)
        .send({
          contactId: cliente.id,
          invoiceNumber: 'IGNORADO',
          issueDate: '2026-10-01',
        })
        .expect(201);
      // Simula una rectificativa anterior a la regla (sin código).
      await getDb()
        .update(invoices)
        .set({ facturaeReasonCode: null })
        .where(eq(invoices.id, facturada.body.invoiceId));
      const fx = await authed(app, token)
        .get(`/invoices/${facturada.body.invoiceId}/facturae`)
        .expect(409);
      expect(fx.body.message).toContain('código de motivo Facturae');
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
          rectificationMotive: 'R4',
          rectificationType: 'I',
          facturaeReasonCode: '16',
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
          rectificationMotive: 'R4',
          rectificationType: 'I',
          facturaeReasonCode: '16',
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
          rectificationMotive: 'R4',
          rectificationType: 'S',
          facturaeReasonCode: '16',
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
          rectificationMotive: 'R4',
          rectificationType: 'I',
          facturaeReasonCode: '16',
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
          rectificationMotive: 'R4',
          rectificationType: 'I',
          facturaeReasonCode: '16',
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
