import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Contrato RFC 7807 del dominio económico: cada rechazo de negocio lleva un
 * `errorCode` semántico (no el genérico del estado HTTP), el `detail` original
 * y el `correlationId` igual a `X-Request-Id`.
 */
describe('Dominio económico (integración) — errores RFC 7807 con errorCode semántico', () => {
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
    token = (await registerUser(app, { email: 'admin@test.dintel.es' }))
      .accessToken;
  });

  function verificarContrato(
    res: request.Response,
    status: number,
    errorCode: string,
    detail: string,
  ) {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.errorCode).toBe(errorCode);
    expect(res.body.type).toBe(`https://erp-dintel/errores/${errorCode}`);
    expect(res.body.detail).toBe(detail);
    expect(res.body.correlationId).toBe(res.headers['x-request-id']);
  }

  it('factura inexistente: 404 INVOICE_NOT_FOUND', async () => {
    const res = await authed(app, token).get(`/invoices/${randomUUID()}`);
    verificarContrato(res, 404, 'INVOICE_NOT_FOUND', 'Factura no encontrada');
  });

  it('certificación inexistente en sus líneas: 404 CERTIFICATION_NOT_FOUND', async () => {
    const id = randomUUID();
    const res = await authed(app, token).get(`/certifications/${id}/lines`);
    verificarContrato(
      res,
      404,
      'CERTIFICATION_NOT_FOUND',
      `Certificación ${id} no encontrada`,
    );
  });

  it('certificación de subcontrata inexistente: 404 con su código', async () => {
    const res = await authed(app, token).get(
      `/subcontratas/certificaciones/${randomUUID()}`,
    );
    verificarContrato(
      res,
      404,
      'SUBCONTRACT_CERT_NOT_FOUND',
      'Certificación no encontrada',
    );
  });
});
