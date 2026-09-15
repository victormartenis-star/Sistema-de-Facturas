import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
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

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/delivery-notes').expect(401);
  });
});
