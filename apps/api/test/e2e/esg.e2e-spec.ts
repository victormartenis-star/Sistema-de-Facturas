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

describe('ESG (integración) — emisiones y trazabilidad RCD', () => {
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

  it('registra un consumo, calcula sus emisiones y las agrega en el informe BREEAM/LEED', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);

    const factor = (
      await client
        .post('/esg/factores')
        .send({
          categoria: 'combustible',
          nombre: 'Gasóleo B',
          unidad: 'litro',
          factorKgCo2e: 2.68,
        })
        .expect(201)
    ).body;

    const registro = (
      await client
        .post('/esg/registros')
        .send({
          projectId: project.id,
          factorId: factor.id,
          fecha: '2026-09-14',
          cantidad: 100,
        })
        .expect(201)
    ).body;
    expect(registro.emisionesKgCo2e).toBeCloseTo(268, 2);

    const informe = (
      await client.get(`/esg/informe?projectId=${project.id}`).expect(200)
    ).body;
    expect(informe.totalKgCo2e).toBeCloseTo(268, 2);
    expect(informe.porCategoria).toEqual([
      { categoria: 'combustible', emisionesKgCo2e: 268 },
    ]);
  });

  it('da de alta un vale RCD y lo agrega en el informe de trazabilidad de residuos', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);
    const project = await createProject(app, admin.accessToken);
    const gestor = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      legalName: 'Gestora de Residuos SL',
    });

    const vale1 = (
      await client
        .post('/esg/rcd/vales')
        .send({
          projectId: project.id,
          lerCode: '17 01 01',
          description: 'Hormigón',
          quantity: 10,
          unit: 'tn',
          treatment: 'valorizacion',
          managerContactId: gestor.id,
          ticketNumber: 'V-001',
          ticketDate: '2026-09-14',
        })
        .expect(201)
    ).body;
    expect(vale1.managerName).toBe('Gestora de Residuos SL');

    await client
      .post('/esg/rcd/vales')
      .send({
        projectId: project.id,
        lerCode: '17 09 04',
        description: 'Mezcla de residuos de construcción',
        quantity: 5,
        unit: 'tn',
        treatment: 'eliminacion',
        managerContactId: gestor.id,
        ticketNumber: 'V-002',
        ticketDate: '2026-09-15',
      })
      .expect(201);

    // Mismo gestor no puede repetir número de vale.
    await client
      .post('/esg/rcd/vales')
      .send({
        projectId: project.id,
        lerCode: '17 01 01',
        description: 'Hormigón',
        quantity: 1,
        unit: 'tn',
        treatment: 'valorizacion',
        managerContactId: gestor.id,
        ticketNumber: 'V-001',
        ticketDate: '2026-09-16',
      })
      .expect(409);

    const informe = (
      await client.get(`/esg/rcd/informe?projectId=${project.id}`).expect(200)
    ).body;
    expect(informe.totalToneladas).toBe(15);
    expect(informe.valorizacionPct).toBeCloseTo(66.7, 1);
    expect(informe.porLer).toHaveLength(2);

    const vales = (
      await client.get(`/esg/rcd/vales?projectId=${project.id}`).expect(200)
    ).body;
    expect(vales).toHaveLength(2);
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/esg/rcd/vales').expect(401);
  });
});
