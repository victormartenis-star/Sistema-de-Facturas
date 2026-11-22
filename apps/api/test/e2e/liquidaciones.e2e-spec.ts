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
 * Cobros y pagos parciales (`payment_settlements`): liquidaciones totales o
 * parciales contra un vencimiento, saldo vivo exacto, estado derivado,
 * anulación con reapertura, concurrencia (If-Match), idempotencia,
 * auditoría, efecto en previsión de caja, rectificativa total e interfaz
 * contable (un asiento por liquidación).
 */
describe('Tesorería (integración) — cobros y pagos parciales', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    token = (await registerUser(app)).accessToken;
  });

  const HOY = new Date().toISOString().slice(0, 10);

  /** Factura de venta de 1.000 + 21 % aprobada: un vencimiento de cobro de 1.210. */
  async function vencimientoDeCobro(): Promise<{
    invoiceId: string;
    milestoneId: string;
    version: number;
  }> {
    const obra = await createProject(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const f = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        lines: [
          {
            description: 'Certificación',
            baseAmount: 1000,
            vatPct: 21,
            projectId: obra.id,
          },
        ],
      })
      .expect(201);
    await authed(app, token).post(`/invoices/${f.body.id}/aprobar`).expect(201);
    const [m] = (await authed(app, token).get('/treasury/milestones')).body;
    return { invoiceId: f.body.id, milestoneId: m.id, version: m.version };
  }

  const liquidar = (id: string, importe: number, extra = {}) =>
    authed(app, token)
      .post(`/treasury/milestones/${id}/liquidaciones`)
      .send({ importe, fecha: HOY, ...extra });

  it('dos cobros parciales: parcial → liquidado, saldo exacto y factura pagada al final', async () => {
    const { invoiceId, milestoneId } = await vencimientoDeCobro();

    const r1 = await liquidar(milestoneId, 500.1, {
      referencia: 'TRF-1',
    }).expect(201);
    expect(r1.body).toMatchObject({
      amount: 1210,
      settledAmount: 500.1,
      pendingAmount: 709.9,
      settlementState: 'parcial',
      status: 'previsto',
    });
    expect(
      (await authed(app, token).get(`/invoices/${invoiceId}`)).body.status,
    ).toBe('aprobada');

    const parciales = await authed(app, token)
      .get('/treasury/milestones?liquidacion=parcial')
      .expect(200);
    expect(parciales.body).toHaveLength(1);

    const r2 = await liquidar(milestoneId, 709.9).expect(201);
    expect(r2.body).toMatchObject({
      settledAmount: 1210,
      pendingAmount: 0,
      settlementState: 'liquidado',
      status: 'pagado',
      paidAt: HOY,
    });
    expect(r2.body.settlements).toHaveLength(2);
    expect(r2.body.settlements[0]).toMatchObject({
      amount: 500.1,
      status: 'vigente',
      reference: 'TRF-1',
    });
    expect(
      (await authed(app, token).get(`/invoices/${invoiceId}`)).body.status,
    ).toBe('pagada');
  });

  it('rechaza superar el saldo, fechas futuras y liquidar lo ya liquidado (RFC 7807)', async () => {
    const { milestoneId } = await vencimientoDeCobro();
    await liquidar(milestoneId, 1000).expect(201);

    const exceso = await liquidar(milestoneId, 210.01);
    expect(exceso.status).toBe(422);
    expect(exceso.headers['content-type']).toMatch(
      /application\/problem\+json/,
    );
    expect(exceso.body.errorCode).toBe('SETTLEMENT_EXCEEDS_OUTSTANDING');
    expect(exceso.body.correlationId).toBe(exceso.headers['x-request-id']);

    const futura = await liquidar(milestoneId, 1, { fecha: '2999-01-01' });
    expect(futura.body.errorCode).toBe('SETTLEMENT_DATE_IN_FUTURE');

    const cero = await liquidar(milestoneId, 0);
    expect(cero.status).toBe(400);

    await liquidar(milestoneId, 210).expect(201);
    const otra = await liquidar(milestoneId, 1);
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('DUE_ALREADY_SETTLED');
  });

  it('anular una liquidación reabre el vencimiento y la factura; no se anula dos veces', async () => {
    const { invoiceId, milestoneId } = await vencimientoDeCobro();
    const total = await liquidar(milestoneId, 1210).expect(201);
    const liq = total.body.settlements[0];

    const anulada = await authed(app, token)
      .post(`/treasury/liquidaciones/${liq.id}/anular`)
      .send({ motivo: 'Transferencia devuelta' })
      .expect(200);
    expect(anulada.body).toMatchObject({
      status: 'previsto',
      settledAmount: 0,
      pendingAmount: 1210,
      settlementState: 'pendiente',
      paidAt: null,
    });
    expect(anulada.body.settlements[0]).toMatchObject({
      status: 'anulada',
      reversalReason: 'Transferencia devuelta',
    });
    expect(
      (await authed(app, token).get(`/invoices/${invoiceId}`)).body.status,
    ).toBe('aprobada');

    const otraVez = await authed(app, token)
      .post(`/treasury/liquidaciones/${liq.id}/anular`)
      .send({ motivo: 'Otra vez' });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.errorCode).toBe('SETTLEMENT_ALREADY_CANCELLED');
  });

  it('If-Match con versión antigua: 409 VERSION_CONFLICT; Idempotency-Key no duplica', async () => {
    const { milestoneId, version } = await vencimientoDeCobro();
    await liquidar(milestoneId, 100)
      .set('If-Match', `"${version}"`)
      .expect(201);
    const vieja = await liquidar(milestoneId, 100).set(
      'If-Match',
      `"${version}"`,
    );
    expect(vieja.status).toBe(409);
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');

    const clave = 'liq-0001-idem';
    const a = await liquidar(milestoneId, 50)
      .set('Idempotency-Key', clave)
      .expect(201);
    const b = await liquidar(milestoneId, 50)
      .set('Idempotency-Key', clave)
      .expect(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body).toEqual(a.body);
    const detalle = await authed(app, token)
      .get(`/treasury/milestones/${milestoneId}`)
      .expect(200);
    expect(detalle.body.settlements).toHaveLength(2);
    expect(detalle.body.settledAmount).toBe(150);
  });

  it('dos cobros concurrentes que juntos superan el saldo: solo uno entra', async () => {
    const { milestoneId } = await vencimientoDeCobro();
    const [x, y] = await Promise.all([
      liquidar(milestoneId, 800),
      liquidar(milestoneId, 800),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 422]);
    const detalle = await authed(app, token)
      .get(`/treasury/milestones/${milestoneId}`)
      .expect(200);
    expect(detalle.body.settledAmount).toBe(800);
  });

  it('pagar liquida el resto, reabrir anula todas, y queda auditado', async () => {
    const { milestoneId } = await vencimientoDeCobro();
    await liquidar(milestoneId, 210).expect(201);
    await authed(app, token)
      .post(`/treasury/milestones/${milestoneId}/pagar`)
      .expect(204);
    let d = (
      await authed(app, token).get(`/treasury/milestones/${milestoneId}`)
    ).body;
    expect(d.settlements.map((s: { amount: number }) => s.amount)).toEqual([
      210, 1000,
    ]);
    expect(d.settlementState).toBe('liquidado');

    await authed(app, token)
      .post(`/treasury/milestones/${milestoneId}/reabrir`)
      .expect(204);
    d = (await authed(app, token).get(`/treasury/milestones/${milestoneId}`))
      .body;
    expect(d.settledAmount).toBe(0);
    expect(
      d.settlements.every((s: { status: string }) => s.status === 'anulada'),
    ).toBe(true);

    const audit = await authed(app, token)
      .get('/audit?entityType=payment_settlement')
      .expect(200);
    // 2 altas + 2 anulaciones.
    expect(audit.body).toHaveLength(4);
  });

  it('la previsión de caja solo cuenta el saldo vivo', async () => {
    const { milestoneId } = await vencimientoDeCobro();
    await liquidar(milestoneId, 210).expect(201);
    const cf = await authed(app, token)
      .get('/treasury/cashflow?from=2026-10-01&to=2026-10-31&groupBy=mes')
      .expect(200);
    expect(cf.body.totalCobros).toBe(1000);
  });

  it('rectificativa total tras un cobro parcial: el vencimiento se cierra por lo cobrado', async () => {
    const { invoiceId, milestoneId } = await vencimientoDeCobro();
    await liquidar(milestoneId, 500).expect(201);
    const rect = await authed(app, token)
      .post(`/invoices/${invoiceId}/rectificar`)
      .send({
        clase: 'total',
        rectificationMotive: 'R4',
        rectificationType: 'S',
        facturaeReasonCode: '16',
        issueDate: '2026-10-01',
        motivo: 'Cliente equivocado',
      })
      .expect(201);
    // Los vencimientos del original se recortan al aprobar la rectificativa.
    await authed(app, token)
      .post(`/invoices/${rect.body.id}/aprobar`)
      .expect(201);
    const d = (
      await authed(app, token).get(`/treasury/milestones/${milestoneId}`)
    ).body;
    expect(d).toMatchObject({
      amount: 500,
      settledAmount: 500,
      status: 'pagado',
    });
    expect(d.settlements).toHaveLength(1);
  });

  it('interfaz contable: un asiento por cobro parcial y contra-asiento al anularlo', async () => {
    const { milestoneId } = await vencimientoDeCobro();
    await liquidar(milestoneId, 400).expect(201);
    const segundo = await liquidar(milestoneId, 300).expect(201);
    const r1 = await authed(app, token)
      .post('/contabilidad/interfaz/contabilizar')
      .expect(200);
    // Factura + 2 cobros.
    expect(r1.body.contabilizados).toBe(3);
    let bancos = await authed(app, token)
      .get('/contabilidad/mayor/5720')
      .expect(200);
    expect(bancos.body.saldoFinal).toBe(700);

    await authed(app, token)
      .post(`/treasury/liquidaciones/${segundo.body.settlements[1].id}/anular`)
      .send({ motivo: 'Error de importe' })
      .expect(200);
    const r2 = await authed(app, token)
      .post('/contabilidad/interfaz/contabilizar')
      .expect(200);
    expect(r2.body).toMatchObject({ contabilizados: 0, anulados: 1 });
    bancos = await authed(app, token)
      .get('/contabilidad/mayor/5720')
      .expect(200);
    expect(bancos.body.saldoFinal).toBe(400);
  });

  it('sin sesión 401 y vencimiento inexistente 404 DUE_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .post(
        '/treasury/milestones/00000000-0000-4000-8000-000000000000/liquidaciones',
      )
      .send({ importe: 1, fecha: HOY });
    expect(res.status).toBe(401);
    const noExiste = await liquidar('00000000-0000-4000-8000-000000000000', 1);
    expect(noExiste.status).toBe(404);
    expect(noExiste.body.errorCode).toBe('DUE_NOT_FOUND');
  });
});
