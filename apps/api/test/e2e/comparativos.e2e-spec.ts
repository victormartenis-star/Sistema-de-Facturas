import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createObraUser,
  createPhase,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Comparativos (integración) — matriz de ofertas y adjudicación', () => {
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

  /** Obra + fase + presupuesto con 2 partidas en esa fase, listos para comparar. */
  async function setupComparativoFixture(adminToken: string) {
    const project = await createProject(app, adminToken);
    const phase = await createPhase(app, adminToken, project.id);
    const budget = await createBudget(app, adminToken, project.id);
    const itemA = await addBudgetItem(app, adminToken, budget.id, {
      code: 'P01',
      name: 'Movimiento de tierras',
      unitPrice: 20,
      quantity: 100,
      phaseId: phase.id,
    });
    const itemB = await addBudgetItem(app, adminToken, budget.id, {
      code: 'P02',
      name: 'Cimentación',
      unitPrice: 50,
      quantity: 40,
      phaseId: phase.id,
    });
    return { project, phase, budget, itemA, itemB };
  }

  it('crea un comparativo y la matriz arranca con las partidas de la fase y sin ofertas', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const { project, phase, itemA, itemB } = await setupComparativoFixture(
      admin.accessToken,
    );

    const comparativo = await authed(app, admin.accessToken)
      .post('/comparativos')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        title: 'Comparativo cimentación',
      })
      .expect(201);
    expect(comparativo.body.status).toBe('abierto');

    const matriz = await authed(app, admin.accessToken)
      .get(`/comparativos/${comparativo.body.id}/matriz`)
      .expect(200);
    expect(matriz.body.partidas).toHaveLength(2);
    expect(matriz.body.targetTotal).toBeCloseTo(20 * 100 + 50 * 40, 2); // 4000
    expect(matriz.body.ofertas).toEqual([]);
    expect(matriz.body.cheapestOfertaId).toBeNull();
    const codes = matriz.body.partidas.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining([itemA.code, itemB.code]));
  });

  it('añade ofertas de dos proveedores y detecta la más barata con su desviación', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const { project, phase, itemA, itemB } = await setupComparativoFixture(
      admin.accessToken,
    );
    const comparativo = await authed(app, admin.accessToken)
      .post('/comparativos')
      .send({ projectId: project.id, phaseId: phase.id, title: 'Comparativo' })
      .expect(201);
    const proveedorCaro = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      legalName: 'Proveedor Caro SL',
    });
    const proveedorBarato = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      legalName: 'Proveedor Barato SL',
    });

    await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/ofertas`)
      .send({
        contactId: proveedorCaro.id,
        leadTimeDays: 30,
        lineas: [
          { budgetItemId: itemA.id, unitPrice: 25, quantity: 100 },
          { budgetItemId: itemB.id, unitPrice: 55, quantity: 40 },
        ],
      })
      .expect(201);
    const ofertaBarata = await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/ofertas`)
      .send({
        contactId: proveedorBarato.id,
        leadTimeDays: 45,
        lineas: [
          { budgetItemId: itemA.id, unitPrice: 18, quantity: 100 },
          { budgetItemId: itemB.id, unitPrice: 48, quantity: 40 },
        ],
      })
      .expect(201);
    // 18*100 + 48*40 = 1800 + 1920 = 3720
    expect(ofertaBarata.body.totalAmount).toBeCloseTo(3720, 2);

    const matriz = await authed(app, admin.accessToken)
      .get(`/comparativos/${comparativo.body.id}/matriz`)
      .expect(200);
    expect(matriz.body.ofertas).toHaveLength(2);
    expect(matriz.body.cheapestOfertaId).toBe(ofertaBarata.body.id);
    const barataRow = matriz.body.ofertas.find(
      (o: { ofertaId: string }) => o.ofertaId === ofertaBarata.body.id,
    );
    // objetivo (target) = 4000; oferta barata = 3720 → desviación -280
    expect(barataRow.deviationVsTarget).toBeCloseTo(-280, 2);
  });

  it('rechaza una línea de oferta con una partida que no pertenece a la fase del comparativo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const { project, phase, itemA } = await setupComparativoFixture(
      admin.accessToken,
    );
    // Partida de OTRA fase de la misma obra
    const otraFase = await createPhase(app, admin.accessToken, project.id);
    const otroPresupuesto = await createBudget(
      app,
      admin.accessToken,
      project.id,
    );
    const itemAjeno = await addBudgetItem(
      app,
      admin.accessToken,
      otroPresupuesto.id,
      {
        phaseId: otraFase.id,
      },
    );
    const comparativo = await authed(app, admin.accessToken)
      .post('/comparativos')
      .send({ projectId: project.id, phaseId: phase.id, title: 'Comparativo' })
      .expect(201);
    const proveedor = await createContact(app, admin.accessToken);

    await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/ofertas`)
      .send({
        contactId: proveedor.id,
        lineas: [
          { budgetItemId: itemA.id, unitPrice: 20, quantity: 100 },
          { budgetItemId: itemAjeno.id, unitPrice: 10, quantity: 10 },
        ],
      })
      .expect(404);
  });

  it('adjudicar marca la oferta ganadora, cierra el comparativo y genera el pedido borrador', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const { project, phase, itemA, itemB } = await setupComparativoFixture(
      admin.accessToken,
    );
    const comparativo = await authed(app, admin.accessToken)
      .post('/comparativos')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        title: 'Comparativo cimentación',
      })
      .expect(201);
    const proveedor = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
    });
    const oferta = await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/ofertas`)
      .send({
        contactId: proveedor.id,
        leadTimeDays: 20,
        paymentTerms: '30 días fin de mes',
        lineas: [
          { budgetItemId: itemA.id, unitPrice: 18, quantity: 100 },
          { budgetItemId: itemB.id, unitPrice: 48, quantity: 40 },
        ],
      })
      .expect(201);

    const adjudicado = await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/adjudicar`)
      .send({ ofertaId: oferta.body.id })
      .expect(201);
    expect(adjudicado.body.status).toBe('adjudicado');
    expect(adjudicado.body.purchaseOrderId).toBeTruthy();

    const order = await authed(app, admin.accessToken)
      .get('/purchase-orders')
      .expect(200);
    const generated = order.body.find(
      (o: { id: string }) => o.id === adjudicado.body.purchaseOrderId,
    );
    expect(generated).toBeDefined();
    expect(generated.contactId).toBe(proveedor.id);
    expect(generated.amount).toBeCloseTo(3720, 2);
    expect(generated.phaseId).toBe(phase.id);

    const matriz = await authed(app, admin.accessToken)
      .get(`/comparativos/${comparativo.body.id}/matriz`)
      .expect(200);
    const winnerRow = matriz.body.ofertas.find(
      (o: { ofertaId: string }) => o.ofertaId === oferta.body.id,
    );
    expect(winnerRow.isAwarded).toBe(true);
  });

  it('rechaza adjudicar dos veces el mismo comparativo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const { project, phase, itemA } = await setupComparativoFixture(
      admin.accessToken,
    );
    const comparativo = await authed(app, admin.accessToken)
      .post('/comparativos')
      .send({ projectId: project.id, phaseId: phase.id, title: 'Comparativo' })
      .expect(201);
    const proveedor = await createContact(app, admin.accessToken);
    const oferta = await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/ofertas`)
      .send({
        contactId: proveedor.id,
        lineas: [{ budgetItemId: itemA.id, unitPrice: 20, quantity: 100 }],
      })
      .expect(201);

    await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/adjudicar`)
      .send({ ofertaId: oferta.body.id })
      .expect(201);
    await authed(app, admin.accessToken)
      .post(`/comparativos/${comparativo.body.id}/adjudicar`)
      .send({ ofertaId: oferta.body.id })
      .expect(409);
  });

  it('un usuario `obra` sin acceso a la obra no ve el comparativo', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const { project, phase } = await setupComparativoFixture(admin.accessToken);
    const comparativo = await authed(app, admin.accessToken)
      .post('/comparativos')
      .send({ projectId: project.id, phaseId: phase.id, title: 'Comparativo' })
      .expect(201);

    const { tokens: obraTokens } = await createObraUser(
      app,
      admin.accessToken,
      [],
    );
    await authed(app, obraTokens.accessToken)
      .get(`/comparativos/${comparativo.body.id}/matriz`)
      .expect(404);
    const list = await authed(app, obraTokens.accessToken)
      .get('/comparativos')
      .expect(200);
    expect(list.body).toEqual([]);
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer()).get('/comparativos').expect(401);
  });
});
