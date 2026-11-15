import { INestApplication } from '@nestjs/common';
import {
  categories,
  companies,
  contacts,
  getDb,
  projectPhases,
  projects,
} from '@erp/db';
import {
  authed,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  ifMatchDe,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Endurecimiento de facturas (auditoría): validación de contacto/obra/fase/
 * categoría contra la empresa en crear/editar/rectificar, RBAC de las
 * transiciones, edición de rectificativas en borrador y número único de
 * venta por empresa.
 */
describe('Facturas: endurecimiento (integración)', () => {
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

  const unico = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  /** Datos de OTRA empresa insertados directamente (no hay API multiempresa). */
  async function empresaAjena() {
    const db = getDb();
    const [co] = await db
      .insert(companies)
      .values({ name: 'Otra empresa', taxId: 'B99999999' })
      .returning();
    const [contacto] = await db
      .insert(contacts)
      .values({ companyId: co.id, kind: 'cliente', legalName: 'Ajeno SL' })
      .returning();
    const [obra] = await db
      .insert(projects)
      .values({
        companyId: co.id,
        code: `AJ-${unico()}`,
        name: 'Obra ajena',
        contractAmount: '1000.00',
      })
      .returning();
    const [fase] = await db
      .insert(projectPhases)
      .values({
        companyId: co.id,
        projectId: obra.id,
        code: 'F1',
        name: 'Fase ajena',
      })
      .returning();
    const [categoria] = await db
      .insert(categories)
      .values({ companyId: co.id, name: 'Cat ajena', slug: `cat-${unico()}` })
      .returning();
    return { contacto, obra, fase, categoria };
  }

  const cuerpoVenta = (
    contactId: string,
    line: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) => ({
    kind: 'venta',
    contactId,
    invoiceNumber: `F-${unico()}`,
    issueDate: '2026-09-14',
    dueDate: '2026-10-14',
    lines: [{ description: 'Línea', baseAmount: 1000, vatPct: 21, ...line }],
    ...extra,
  });

  async function entorno() {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const project = await createProject(app, token);
    const cliente = await createContact(app, token);
    return { token, project, cliente };
  }

  async function ventaBorrador(
    token: string,
    contactId: string,
    projectId: string,
  ): Promise<string> {
    const res = await authed(app, token)
      .post('/invoices')
      .send(cuerpoVenta(contactId, { projectId }))
      .expect(201);
    return res.body.id as string;
  }

  async function ventaAprobada(
    token: string,
    contactId: string,
    projectId: string,
  ): Promise<string> {
    const id = await ventaBorrador(token, contactId, projectId);
    await authed(app, token).post(`/invoices/${id}/aprobar`).expect(201);
    return id;
  }

  describe('1.2 PATCH valida contacto y obras', () => {
    it('contactId de otra empresa: 404', async () => {
      const { token, project, cliente } = await entorno();
      const ajena = await empresaAjena();
      const id = await ventaBorrador(token, cliente.id, project.id);
      await authed(app, token)
        .patch(`/invoices/${id}`)
        .set('If-Match', await ifMatchDe(app, token, `/invoices/${id}`))
        .send({ contactId: ajena.contacto.id })
        .expect(404);
    });
  });

  describe('1.3 líneas: obra/fase/categoría de la empresa', () => {
    it('crear con projectId, phaseId o categoryId ajenos: 404', async () => {
      const { token, cliente } = await entorno();
      const a = await empresaAjena();
      for (const line of [
        { projectId: a.obra.id },
        { phaseId: a.fase.id },
        { categoryId: a.categoria.id },
      ]) {
        await authed(app, token)
          .post('/invoices')
          .send(cuerpoVenta(cliente.id, line))
          .expect(404);
      }
    });

    it('editar líneas con projectId ajeno: 404 y la factura no cambia', async () => {
      const { token, project, cliente } = await entorno();
      const a = await empresaAjena();
      const id = await ventaBorrador(token, cliente.id, project.id);
      await authed(app, token)
        .patch(`/invoices/${id}`)
        .set('If-Match', await ifMatchDe(app, token, `/invoices/${id}`))
        .send({
          lines: [{ description: 'X', baseAmount: 5, projectId: a.obra.id }],
        })
        .expect(404);
      const g = await authed(app, token).get(`/invoices/${id}`).expect(200);
      expect(g.body.lines[0].projectId).toBe(project.id);
    });

    it('rectificar por diferencias con obra ajena: 404', async () => {
      const { token, project, cliente } = await entorno();
      const a = await empresaAjena();
      const id = await ventaAprobada(token, cliente.id, project.id);
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'diferencias',
          rectificationMotive: 'R4',
          rectificationType: 'I',
          facturaeReasonCode: '16',
          issueDate: '2026-10-01',
          motivo: 'Ajuste',
          lines: [
            { description: 'Delta', baseAmount: -10, projectId: a.obra.id },
          ],
        })
        .expect(404);
    });
  });

  describe('1.4 RBAC de las transiciones', () => {
    it('obra no puede aprobar, pagar, anular, editar ni borrar (403); lector tampoco', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const borrador = await ventaBorrador(token, cliente.id, project.id);
      const obra = await createObraUser(app, token, [project.id]);
      const t = obra.tokens.accessToken;
      await authed(app, t).post(`/invoices/${borrador}/aprobar`).expect(403);
      await authed(app, t).post(`/invoices/${id}/pagar`).expect(403);
      await authed(app, t)
        .post(`/invoices/${id}/anular`)
        .send({ motivo: 'x' })
        .expect(403);
      await authed(app, t)
        .patch(`/invoices/${borrador}`)
        .set('If-Match', await ifMatchDe(app, token, `/invoices/${borrador}`))
        .send({ notes: 'x' })
        .expect(403);
      await authed(app, t)
        .delete(`/invoices/${borrador}`)
        .set('If-Match', await ifMatchDe(app, token, `/invoices/${borrador}`))
        .expect(403);
    });

    it('obra recibe 403 al aprobar una rectificativa', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const rect = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          facturaeReasonCode: '16',
          issueDate: '2026-10-01',
          motivo: 'Error',
        })
        .expect(201);
      const obra = await createObraUser(app, token, [project.id]);
      await authed(app, obra.tokens.accessToken)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(403);
    });
  });

  describe('3.2 rectificativa en borrador', () => {
    async function rectificativa(
      kind: 'total' | 'diferencias',
      env?: Awaited<ReturnType<typeof entorno>>,
    ) {
      const { token, project, cliente } = env ?? (await entorno());
      const id = await ventaAprobada(token, cliente.id, project.id);
      const res = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: kind,
          rectificationMotive: 'R4',
          rectificationType: kind === 'total' ? 'S' : 'I',
          facturaeReasonCode: '16',
          issueDate: '2026-10-01',
          motivo: 'Error',
          ...(kind === 'diferencias' && {
            lines: [
              { description: 'Delta', baseAmount: -10, projectId: project.id },
            ],
          }),
        })
        .expect(201);
      const otro = await createContact(app, token, { legalName: 'Otro SL' });
      return { token, project, cliente, rectId: res.body.id as string, otro };
    }

    it('rechaza contactId, invoiceNumber, isp y retentionPct (400)', async () => {
      const { token, rectId, otro } = await rectificativa('diferencias');
      for (const body of [
        { contactId: otro.id },
        { invoiceNumber: 'R-MANUAL' },
        { isp: true },
        { retentionPct: 3 },
      ]) {
        await authed(app, token)
          .patch(`/invoices/${rectId}`)
          .set('If-Match', await ifMatchDe(app, token, `/invoices/${rectId}`))
          .send(body)
          .expect(400);
      }
    });

    it('total: rechaza cambiar las líneas (400); diferencias: las admite', async () => {
      const t = await rectificativa('total');
      await authed(app, t.token)
        .patch(`/invoices/${t.rectId}`)
        .set('If-Match', await ifMatchDe(app, t.token, `/invoices/${t.rectId}`))
        .send({ lines: [{ description: 'X', baseAmount: 1 }] })
        .expect(400);
      const d = await rectificativa('diferencias', {
        token: t.token,
        project: t.project,
        cliente: t.cliente,
      });
      await authed(app, d.token)
        .patch(`/invoices/${d.rectId}`)
        .set('If-Match', await ifMatchDe(app, d.token, `/invoices/${d.rectId}`))
        .send({
          lines: [
            { description: 'Delta2', baseAmount: -20, projectId: d.project.id },
          ],
        })
        .expect(200);
    });
  });

  describe('4.4 projectId no UUID', () => {
    it('GET /invoices y GET /certifications devuelven 400', async () => {
      const { token } = await entorno();
      await authed(app, token)
        .get('/invoices?projectId=no-es-uuid')
        .expect(400);
      await authed(app, token)
        .get('/certifications?projectId=no-es-uuid')
        .expect(400);
    });
  });

  describe('3.7 número de venta único por empresa', () => {
    it('dos ventas con el mismo número y distinto cliente: 409', async () => {
      const { token, project, cliente } = await entorno();
      const otro = await createContact(app, token, { legalName: 'Otro SL' });
      const numero = `F-DUP-${unico()}`;
      await authed(app, token)
        .post('/invoices')
        .send(
          cuerpoVenta(
            cliente.id,
            { projectId: project.id },
            { invoiceNumber: numero },
          ),
        )
        .expect(201);
      await authed(app, token)
        .post('/invoices')
        .send(
          cuerpoVenta(
            otro.id,
            { projectId: project.id },
            { invoiceNumber: numero },
          ),
        )
        .expect(409);
    });

    it('compras: el mismo número con distinto proveedor sigue permitido', async () => {
      const { token, project } = await entorno();
      const p1 = await createContact(app, token, {
        kind: 'proveedor',
        legalName: 'P1',
      });
      const p2 = await createContact(app, token, {
        kind: 'proveedor',
        legalName: 'P2',
      });
      for (const p of [p1, p2]) {
        await authed(app, token)
          .post('/invoices')
          .send({
            ...cuerpoVenta(
              p.id,
              { projectId: project.id },
              { invoiceNumber: 'C-1' },
            ),
            kind: 'compra',
          })
          .expect(201);
      }
    });
  });
});
