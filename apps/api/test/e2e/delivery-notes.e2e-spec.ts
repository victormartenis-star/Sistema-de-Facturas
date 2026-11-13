import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { getDb, purchaseOrders } from '@erp/db';
import {
  authed,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * CRUD de `delivery-notes` (Fase 11, cierre de cobertura): `create()` y
 * `validate()` ya estaban ejercitados de paso por `prl-guard.e2e-spec.ts`
 * (necesita el flujo pedido → albarán → factura completo), pero `list()`,
 * `update()` y `remove()` seguían sin ningún test de integración propio.
 */
describe('Delivery Notes (integración) — CRUD de albaranes', () => {
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

  it('un admin puede crear, listar, actualizar y borrar un albarán sin pedido asociado', async () => {
    const admin = await registerUser(app);
    const contact = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
    });

    const createRes = await authed(app, admin.accessToken)
      .post('/delivery-notes')
      .send({
        contactId: contact.id,
        noteNumber: `ALB-${Date.now()}`,
        noteDate: '2026-09-14',
        amount: 500,
      })
      .expect(201);
    const noteId = createRes.body.id as string;
    // Sin `orderId`: bloqueado para validar, pero eso no impide el resto del CRUD.
    expect(createRes.body.status).toBe('pendiente');
    expect(createRes.body.blockReason).toContain('pedido');

    const listRes = await authed(app, admin.accessToken)
      .get('/delivery-notes')
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(noteId);

    const filteredRes = await authed(app, admin.accessToken)
      .get(`/delivery-notes?contactId=${contact.id}`)
      .expect(200);
    expect(filteredRes.body).toHaveLength(1);

    const updateRes = await authed(app, admin.accessToken)
      .patch(`/delivery-notes/${noteId}`)
      .send({ amount: 750, description: 'Corrección de importe' })
      .expect(200);
    expect(updateRes.body.amount).toBe(750);
    expect(updateRes.body.description).toBe('Corrección de importe');

    await authed(app, admin.accessToken)
      .delete(`/delivery-notes/${noteId}`)
      .expect(204);
    const afterDelete = await authed(app, admin.accessToken)
      .get('/delivery-notes')
      .expect(200);
    expect(afterDelete.body).toHaveLength(0);
  });

  it('rechaza con 409 dos albaranes con el mismo número de proveedor', async () => {
    const admin = await registerUser(app);
    const contact = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
    });
    const noteNumber = `ALB-DUP-${Date.now()}`;

    await authed(app, admin.accessToken)
      .post('/delivery-notes')
      .send({
        contactId: contact.id,
        noteNumber,
        noteDate: '2026-09-14',
        amount: 100,
      })
      .expect(201);

    const res = await authed(app, admin.accessToken)
      .post('/delivery-notes')
      .send({
        contactId: contact.id,
        noteNumber,
        noteDate: '2026-09-14',
        amount: 200,
      })
      .expect(409);
    expect(res.body.message).toContain(noteNumber);
  });

  it('rechaza con 409 editar o borrar un albarán ya facturado', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const contact = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
    });
    const orderRes = await authed(app, admin.accessToken)
      .post('/purchase-orders')
      .send({
        projectId: project.id,
        contactId: contact.id,
        orderDate: '2026-09-14',
        description: 'Suministro de pruebas',
        amount: 500,
      })
      .expect(201);

    const noteRes = await authed(app, admin.accessToken)
      .post('/delivery-notes')
      .send({
        contactId: contact.id,
        orderId: orderRes.body.id,
        noteNumber: `ALB-${Date.now()}`,
        noteDate: '2026-09-14',
        amount: 500,
      })
      .expect(201);
    const noteId = noteRes.body.id as string;
    await authed(app, admin.accessToken)
      .post(`/delivery-notes/${noteId}/validar`)
      .expect(201);

    const invoiceRes = await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: contact.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        deliveryNoteIds: [noteId],
        lines: [{ description: 'Material', baseAmount: 500, vatPct: 21 }],
      })
      .expect(201);
    // El albarán queda enlazado (`invoiceId`) al crear la factura, pero solo
    // pasa a `facturado` (y por tanto bloqueado para editar/borrar) al
    // aprobarla — ver `InvoicesService.approve()`.
    await authed(app, admin.accessToken)
      .post(`/invoices/${invoiceRes.body.id}/aprobar`)
      .expect(201);

    const updateRes = await authed(app, admin.accessToken)
      .patch(`/delivery-notes/${noteId}`)
      .send({ amount: 600 })
      .expect(409);
    expect(updateRes.body.message).toContain('facturado');

    const removeRes = await authed(app, admin.accessToken)
      .delete(`/delivery-notes/${noteId}`)
      .expect(409);
    expect(removeRes.body.message).toContain('facturado');
  });

  describe('máquina de estados', () => {
    /** Albarán con pedido, ya validado (listo para devolver o facturar). */
    async function validatedNote(token: string, amount = 500) {
      const project = await createProject(app, token);
      const contact = await createContact(app, token, { kind: 'proveedor' });
      const order = await authed(app, token)
        .post('/purchase-orders')
        .send({
          projectId: project.id,
          contactId: contact.id,
          orderDate: '2026-09-14',
          description: 'Suministro',
          amount,
        })
        .expect(201);
      const note = await authed(app, token)
        .post('/delivery-notes')
        .send({
          contactId: contact.id,
          projectId: project.id,
          orderId: order.body.id,
          noteNumber: `ALB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          noteDate: '2026-09-14',
          amount,
        })
        .expect(201);
      await authed(app, token)
        .post(`/delivery-notes/${note.body.id}/validar`)
        .expect(201);
      return { project, contact, order: order.body, noteId: note.body.id };
    }

    it('un albarán validado solo admite cambiar la descripción; el importe da 409', async () => {
      const admin = await registerUser(app);
      const { noteId } = await validatedNote(admin.accessToken);
      await authed(app, admin.accessToken)
        .patch(`/delivery-notes/${noteId}`)
        .send({ amount: 100 })
        .expect(409);
      await authed(app, admin.accessToken)
        .patch(`/delivery-notes/${noteId}`)
        .send({ description: 'Solo texto' })
        .expect(200);
    });

    it('no se borra un albarán validado (409)', async () => {
      const admin = await registerUser(app);
      const { noteId } = await validatedNote(admin.accessToken);
      await authed(app, admin.accessToken)
        .delete(`/delivery-notes/${noteId}`)
        .expect(409);
    });

    it('devolver: validado → pendiente con motivo y permite corregir el importe', async () => {
      const admin = await registerUser(app);
      const { noteId } = await validatedNote(admin.accessToken);

      // El motivo es obligatorio.
      await authed(app, admin.accessToken)
        .post(`/delivery-notes/${noteId}/devolver`)
        .send({})
        .expect(400);

      const res = await authed(app, admin.accessToken)
        .post(`/delivery-notes/${noteId}/devolver`)
        .send({ motivo: 'El importe del albarán estaba mal' })
        .expect(201);
      expect(res.body.status).toBe('pendiente');
      expect(res.body.validatedAt).toBeNull();

      await authed(app, admin.accessToken)
        .patch(`/delivery-notes/${noteId}`)
        .send({ amount: 450 })
        .expect(200);

      // Queda auditado con el motivo.
      const audit = await authed(app, admin.accessToken)
        .get(`/audit?entityType=delivery_note&entityId=${noteId}`)
        .expect(200);
      expect(JSON.stringify(audit.body)).toContain(
        'El importe del albarán estaba mal',
      );
    });

    it('devolver un albarán pendiente da 409', async () => {
      const admin = await registerUser(app);
      const contact = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
      });
      const note = await authed(app, admin.accessToken)
        .post('/delivery-notes')
        .send({
          contactId: contact.id,
          noteNumber: `ALB-${Date.now()}`,
          noteDate: '2026-09-14',
          amount: 10,
        })
        .expect(201);
      await authed(app, admin.accessToken)
        .post(`/delivery-notes/${note.body.id}/devolver`)
        .send({ motivo: 'No procede devolverlo' })
        .expect(409);
    });

    it('devolver un albarán vinculado a una factura en borrador da 409 y tampoco se edita ni se borra', async () => {
      const admin = await registerUser(app);
      const { contact, noteId } = await validatedNote(admin.accessToken);
      await authed(app, admin.accessToken)
        .post('/invoices')
        .send({
          kind: 'compra',
          contactId: contact.id,
          invoiceNumber: `F-${Date.now()}`,
          issueDate: '2026-09-14',
          deliveryNoteIds: [noteId],
          lines: [{ description: 'Material', baseAmount: 500, vatPct: 21 }],
        })
        .expect(201);

      await authed(app, admin.accessToken)
        .post(`/delivery-notes/${noteId}/devolver`)
        .send({ motivo: 'Intento con factura vinculada' })
        .expect(409);
      await authed(app, admin.accessToken)
        .patch(`/delivery-notes/${noteId}`)
        .send({ description: 'Cambio' })
        .expect(409);
      await authed(app, admin.accessToken)
        .delete(`/delivery-notes/${noteId}`)
        .expect(409);
    });

    it('el lector no puede devolver (403)', async () => {
      const admin = await registerUser(app);
      const { noteId } = await validatedNote(admin.accessToken);
      const lector = await createUserWithRole(app, admin.accessToken, 'lector');
      await authed(app, lector.accessToken)
        .post(`/delivery-notes/${noteId}/devolver`)
        .send({ motivo: 'Intento del lector' })
        .expect(403);
    });

    it('un usuario `obra` recibe 404 al editar, validar, devolver o borrar un albarán de otra obra', async () => {
      const admin = await registerUser(app);
      const { noteId } = await validatedNote(admin.accessToken);
      const { tokens } = await createObraUser(app, admin.accessToken, []);
      const api = authed(app, tokens.accessToken);

      await api
        .patch(`/delivery-notes/${noteId}`)
        .send({ description: 'Intruso' })
        .expect(404);
      await api.post(`/delivery-notes/${noteId}/validar`).expect(404);
      await api.delete(`/delivery-notes/${noteId}`).expect(404);
    });

    /** Pedido de `amount` € con su proveedor, listo para recibir albaranes. */
    async function pedido(token: string, amount: number) {
      const project = await createProject(app, token);
      const contact = await createContact(app, token, { kind: 'proveedor' });
      const order = await authed(app, token)
        .post('/purchase-orders')
        .send({
          projectId: project.id,
          contactId: contact.id,
          orderDate: '2026-09-14',
          description: 'Suministro',
          amount,
        })
        .expect(201);
      return { project, contact, orderId: order.body.id as string };
    }
    async function albaran(
      token: string,
      p: { contact: { id: string }; orderId: string },
      amount: number,
    ) {
      const res = await authed(app, token)
        .post('/delivery-notes')
        .send({
          contactId: p.contact.id,
          orderId: p.orderId,
          noteNumber: `ALB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          noteDate: '2026-09-14',
          amount,
        })
        .expect(201);
      return res.body.id as string;
    }
    async function estadoPedido(token: string, orderId: string) {
      const res = await authed(app, token)
        .get(`/purchase-orders/${orderId}`)
        .expect(200);
      return res.body.status as string;
    }

    it('el pedido pasa a servido al VALIDAR el albarán, no al registrarlo; devolver lo deshace', async () => {
      const admin = await registerUser(app);
      const t = admin.accessToken;
      const p = await pedido(t, 100);
      const n1 = await albaran(t, p, 40);
      expect(await estadoPedido(t, p.orderId)).toBe('emitido');
      await authed(app, t).post(`/delivery-notes/${n1}/validar`).expect(201);
      expect(await estadoPedido(t, p.orderId)).toBe('servido_parcial');

      const n2 = await albaran(t, p, 60);
      expect(await estadoPedido(t, p.orderId)).toBe('servido_parcial');
      await authed(app, t).post(`/delivery-notes/${n2}/validar`).expect(201);
      expect(await estadoPedido(t, p.orderId)).toBe('servido');

      await authed(app, t)
        .post(`/delivery-notes/${n2}/devolver`)
        .send({ motivo: 'Importe mal anotado' })
        .expect(201);
      expect(await estadoPedido(t, p.orderId)).toBe('servido_parcial');
    });

    it('al borrar un albarán pendiente se refresca el estado del pedido', async () => {
      const admin = await registerUser(app);
      const t = admin.accessToken;
      const p = await pedido(t, 100);
      const noteId = await albaran(t, p, 100);
      expect(await estadoPedido(t, p.orderId)).toBe('emitido');
      // Estado desfasado a propósito: solo un refresco real al borrar lo corrige.
      await getDb()
        .update(purchaseOrders)
        .set({ status: 'servido' })
        .where(eq(purchaseOrders.id, p.orderId));
      expect(await estadoPedido(t, p.orderId)).toBe('servido');

      await authed(app, t).delete(`/delivery-notes/${noteId}`).expect(204);
      expect(await estadoPedido(t, p.orderId)).toBe('emitido');
    });

    it('albaranes concurrentes sobre un mismo pedido: estado final coherente y sin interbloqueos', async () => {
      const admin = await registerUser(app);
      const t = admin.accessToken;
      const p = await pedido(t, 80);
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        const ids = await Promise.all(
          Array.from({ length: 8 }, () => albaran(t, p, 10)),
        );
        const val = await Promise.all(
          ids.map((id) => authed(app, t).post(`/delivery-notes/${id}/validar`)),
        );
        expect(val.map((r) => r.status)).toEqual(ids.map(() => 201));
        expect(await estadoPedido(t, p.orderId)).toBe('servido');

        const dev = await Promise.all(
          ids.map((id) =>
            authed(app, t)
              .post(`/delivery-notes/${id}/devolver`)
              .send({ motivo: 'Prueba de concurrencia' }),
          ),
        );
        expect(dev.map((r) => r.status)).toEqual(ids.map(() => 201));
        expect(await estadoPedido(t, p.orderId)).toBe('emitido');

        const del = await Promise.all(
          ids.map((id) => authed(app, t).delete(`/delivery-notes/${id}`)),
        );
        expect(del.map((r) => r.status)).toEqual(ids.map(() => 204));
        expect(await estadoPedido(t, p.orderId)).toBe('emitido');
      }
    });
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/delivery-notes').expect(401);
  });
});
