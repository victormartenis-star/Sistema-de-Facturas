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

describe('Real Estate (integración) — unidades, reservas, cobros, entrega y postventa', () => {
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

  it('ciclo completo: unidad → reserva → contrato → cobros → escritura → llaves → postventa', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);
    const comprador = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });

    const unit = (
      await client
        .post('/real-estate/units')
        .send({ projectId: project.id, code: '1ºA', salePrice: 200000 })
        .expect(201)
    ).body;
    expect(unit.status).toBe('disponible');

    const reservation = (
      await client
        .post('/real-estate/reservations')
        .send({
          unitId: unit.id,
          buyerContactId: comprador.id,
          reservationDate: '2026-09-14',
          agreedPrice: 195000,
          signalAmount: 3000,
        })
        .expect(201)
    ).body;
    expect(reservation.status).toBe('reservada');

    expect(
      (await client.get(`/real-estate/units/${unit.id}`).expect(200)).body
        .status,
    ).toBe('reservada');

    // No se puede reservar dos veces la misma unidad.
    await client
      .post('/real-estate/reservations')
      .send({
        unitId: unit.id,
        buyerContactId: comprador.id,
        reservationDate: '2026-09-15',
        agreedPrice: 195000,
      })
      .expect(400);

    await client
      .post(`/real-estate/reservations/${reservation.id}/contrato`)
      .send({ contractDate: '2026-09-20' })
      .expect(201);

    const payment = (
      await client
        .post(`/real-estate/reservations/${reservation.id}/cobros`)
        .send({
          concept: 'Contrato privado 20%',
          dueDate: '2026-09-25',
          amount: 39000,
        })
        .expect(201)
    ).body;
    await client.post(`/real-estate/cobros/${payment.id}/cobrar`).expect(204);
    const payments = (
      await client
        .get(`/real-estate/reservations/${reservation.id}/cobros`)
        .expect(200)
    ).body;
    expect(payments[0].status).toBe('cobrado');

    await client
      .post(`/real-estate/reservations/${reservation.id}/escritura`)
      .send({ deedDate: '2026-10-01' })
      .expect(201);
    expect(
      (await client.get(`/real-estate/units/${unit.id}`).expect(200)).body
        .status,
    ).toBe('vendida');

    await client
      .post(`/real-estate/reservations/${reservation.id}/entrega-llaves`)
      .send({ handoverDate: '2026-10-15', notes: 'Entrega sin incidencias' })
      .expect(201);
    expect(
      (await client.get(`/real-estate/units/${unit.id}`).expect(200)).body
        .status,
    ).toBe('entregada');

    const comercializacion = (
      await client
        .get(`/real-estate/comercializacion?projectId=${project.id}`)
        .expect(200)
    ).body;
    expect(comercializacion.vendidasPct).toBe(100);
    expect(comercializacion.entregadasPct).toBe(100);

    const incident = (
      await client
        .post('/real-estate/postventa')
        .send({
          unitId: unit.id,
          reportedByContactId: comprador.id,
          category: 'fontaneria',
          description: 'Goteo en el baño principal',
          reportedAt: '2026-10-20',
          warrantyDeadline: '2027-10-20',
        })
        .expect(201)
    ).body;
    expect(incident.status).toBe('abierta');
    expect(incident.warrantyExpired).toBe(false);

    const closed = (
      await client
        .patch(`/real-estate/postventa/${incident.id}/estado`)
        .send({ status: 'cerrada' })
        .expect(200)
    ).body;
    expect(closed.status).toBe('cerrada');
    expect(closed.resolvedAt).not.toBeNull();
  });

  it('cancelar una reserva devuelve la unidad a disponible', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);
    const comprador = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    const unit = (
      await client
        .post('/real-estate/units')
        .send({ projectId: project.id, code: '2ºB', salePrice: 180000 })
        .expect(201)
    ).body;
    const reservation = (
      await client
        .post('/real-estate/reservations')
        .send({
          unitId: unit.id,
          buyerContactId: comprador.id,
          reservationDate: '2026-09-14',
          agreedPrice: 180000,
        })
        .expect(201)
    ).body;

    await client
      .post(`/real-estate/reservations/${reservation.id}/cancelar`)
      .send({ reason: 'El comprador se echa atrás' })
      .expect(201);

    expect(
      (await client.get(`/real-estate/units/${unit.id}`).expect(200)).body
        .status,
    ).toBe('disponible');
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/real-estate/units').expect(401);
  });
});
