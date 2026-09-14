import { INestApplication } from '@nestjs/common';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Guard de compliance PRL (Fase 11) — `ProveedoresService.assertAptoParaPago()`
 * enlazado en `PurchaseOrdersService.create()` y `InvoicesService.approve()`
 * (facturas de compra). Ver `Módulo Proveedores` y [[Roadmap y Fases]].
 */
describe('Guard de compliance PRL (integración) — pedidos y facturas de compra', () => {
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

  /** Da de alta un proveedor (ficha extendida) enlazado a un contacto dado. */
  async function createProveedor(
    token: string,
    contactId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await authed(app, token)
      .post('/proveedores')
      .send({
        contactId,
        razonSocial: 'Subcontrata de Pruebas SL',
        cifNif: `B${Date.now()}`.slice(0, 9),
        ...overrides,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** Sube un documento PRL bloqueante ya vencido. */
  async function addExpiredDoc(token: string, proveedorId: string) {
    await authed(app, token)
      .post(`/proveedores/${proveedorId}/documentos-prl`)
      .send({
        docType: 'seguro_rc',
        numeroExpediente: 'EXP-001',
        fechaEmision: '2020-01-01',
        fechaVencimiento: '2020-06-01', // muy en el pasado: siempre vencido
      })
      .expect(201);
  }

  describe('POST /purchase-orders', () => {
    async function poBody(contactId: string, projectId: string) {
      return {
        projectId,
        contactId,
        orderDate: '2026-09-14',
        description: 'Suministro de pruebas',
        amount: 1000,
      };
    }

    it('rechaza con 409 un pedido a un proveedor con PRL vencido', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project = await createProject(app, admin.accessToken);
      const contact = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
      });
      const proveedorId = await createProveedor(admin.accessToken, contact.id);
      await addExpiredDoc(admin.accessToken, proveedorId);

      const res = await authed(app, admin.accessToken)
        .post('/purchase-orders')
        .send(await poBody(contact.id, project.id))
        .expect(409);
      expect(res.body.message).toContain('PRL');
    });

    it('permite un pedido a un contacto sin ficha de proveedor (nada que validar)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project = await createProject(app, admin.accessToken);
      const contact = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
      });
      // Sin POST /proveedores: el contacto no tiene ficha extendida.
      await authed(app, admin.accessToken)
        .post('/purchase-orders')
        .send(await poBody(contact.id, project.id))
        .expect(201);
    });

    it('permite un pedido a un proveedor con ficha pero sin documentos PRL bloqueantes vencidos', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project = await createProject(app, admin.accessToken);
      const contact = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
      });
      await createProveedor(admin.accessToken, contact.id);
      // Ficha creada, pero sin documentos PRL subidos: nada vencido.
      await authed(app, admin.accessToken)
        .post('/purchase-orders')
        .send(await poBody(contact.id, project.id))
        .expect(201);
    });
  });

  describe('POST /invoices/:id/aprobar (compra)', () => {
    /**
     * Un albarán solo se valida si tiene pedido asociado en curso de
     * recepción (`deliveryNoteBlockReason` en `@erp/shared`), así que la
     * factura de compra necesita pedido → albarán → factura completo, no
     * solo el albarán. El pedido se emite **antes** de que la
     * documentación PRL caduque (si toca) para no chocar con el guard de
     * `PurchaseOrdersService.create()` — el escenario real es un pedido ya
     * en curso cuya PRL vence antes de llegar a aprobar la factura.
     */
    async function createOrder(
      token: string,
      contactId: string,
      projectId: string,
      amount: number,
    ): Promise<string> {
      const res = await authed(app, token)
        .post('/purchase-orders')
        .send({
          projectId,
          contactId,
          orderDate: '2026-09-14',
          description: 'Suministro de pruebas',
          amount,
        })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    async function createValidatedDeliveryNote(
      token: string,
      contactId: string,
      orderId: string,
      amount: number,
    ): Promise<string> {
      const res = await authed(app, token)
        .post('/delivery-notes')
        .send({
          contactId,
          orderId,
          noteNumber: `ALB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          noteDate: '2026-09-14',
          amount,
        })
        .expect(201);
      const id = (res.body as { id: string }).id;
      await authed(app, token)
        .post(`/delivery-notes/${id}/validar`)
        .expect(201);
      return id;
    }

    async function createCompraInvoice(
      token: string,
      contactId: string,
      deliveryNoteId: string,
    ): Promise<string> {
      const res = await authed(app, token)
        .post('/invoices')
        .send({
          kind: 'compra',
          contactId,
          invoiceNumber: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          issueDate: '2026-09-14',
          deliveryNoteIds: [deliveryNoteId],
          lines: [
            { description: 'Material de obra', baseAmount: 1000, vatPct: 21 },
          ],
        })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    it('rechaza con 409 aprobar una factura de compra a un proveedor con PRL vencido', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project = await createProject(app, admin.accessToken);
      const contact = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
      });
      const proveedorId = await createProveedor(admin.accessToken, contact.id);
      const orderId = await createOrder(
        admin.accessToken,
        contact.id,
        project.id,
        1000,
      );
      const noteId = await createValidatedDeliveryNote(
        admin.accessToken,
        contact.id,
        orderId,
        1000,
      );
      const invoiceId = await createCompraInvoice(
        admin.accessToken,
        contact.id,
        noteId,
      );
      // La PRL caduca después de emitir el pedido, antes de aprobar la
      // factura: el guard debe cortar aquí, no en `purchase-orders.create`.
      await addExpiredDoc(admin.accessToken, proveedorId);

      const res = await authed(app, admin.accessToken)
        .post(`/invoices/${invoiceId}/aprobar`)
        .expect(409);
      expect(res.body.message).toContain('PRL');
    });

    it('aprueba con normalidad una factura de compra a un contacto sin ficha de proveedor', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project = await createProject(app, admin.accessToken);
      const contact = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
      });
      const orderId = await createOrder(
        admin.accessToken,
        contact.id,
        project.id,
        1000,
      );
      const noteId = await createValidatedDeliveryNote(
        admin.accessToken,
        contact.id,
        orderId,
        1000,
      );
      const invoiceId = await createCompraInvoice(
        admin.accessToken,
        contact.id,
        noteId,
      );
      await authed(app, admin.accessToken)
        .post(`/invoices/${invoiceId}/aprobar`)
        .expect(201);
    });
  });
});
