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

  describe('GET /comparativos/ahorro — recomendaciones de ahorro (Fase 15)', () => {
    it('detecta una oportunidad cuando el precio adjudicado supera el mínimo visto en otra obra', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });

      // Obra 1: la más barata vista para el código "P01" (nunca se adjudica,
      // solo sirve de referencia de precio mínimo).
      const project1 = await createProject(app, admin.accessToken);
      const phase1 = await createPhase(app, admin.accessToken, project1.id);
      const budget1 = await createBudget(app, admin.accessToken, project1.id);
      const item1 = await addBudgetItem(app, admin.accessToken, budget1.id, {
        code: 'P01',
        name: 'Hormigón HA-25',
        phaseId: phase1.id,
      });
      const comparativo1 = await authed(app, admin.accessToken)
        .post('/comparativos')
        .send({
          projectId: project1.id,
          phaseId: phase1.id,
          title: 'Comparativo obra 1',
        })
        .expect(201);
      const proveedorBarato = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
        legalName: 'Proveedor Barato SL',
      });
      await authed(app, admin.accessToken)
        .post(`/comparativos/${comparativo1.body.id}/ofertas`)
        .send({
          contactId: proveedorBarato.id,
          lineas: [{ budgetItemId: item1.id, unitPrice: 80, quantity: 10 }],
        })
        .expect(201);

      // Obra 2: mismo código "P01", adjudicado a un precio mucho más alto.
      const project2 = await createProject(app, admin.accessToken);
      const phase2 = await createPhase(app, admin.accessToken, project2.id);
      const budget2 = await createBudget(app, admin.accessToken, project2.id);
      const item2 = await addBudgetItem(app, admin.accessToken, budget2.id, {
        code: 'P01',
        name: 'Hormigón HA-25',
        phaseId: phase2.id,
      });
      const comparativo2 = await authed(app, admin.accessToken)
        .post('/comparativos')
        .send({
          projectId: project2.id,
          phaseId: phase2.id,
          title: 'Comparativo obra 2',
        })
        .expect(201);
      const proveedorCaro = await createContact(app, admin.accessToken, {
        kind: 'proveedor',
        legalName: 'Proveedor Caro SL',
      });
      const oferta2 = await authed(app, admin.accessToken)
        .post(`/comparativos/${comparativo2.body.id}/ofertas`)
        .send({
          contactId: proveedorCaro.id,
          lineas: [{ budgetItemId: item2.id, unitPrice: 100, quantity: 10 }],
        })
        .expect(201);
      await authed(app, admin.accessToken)
        .post(`/comparativos/${comparativo2.body.id}/adjudicar`)
        .send({ ofertaId: oferta2.body.id })
        .expect(201);

      const res = await authed(app, admin.accessToken)
        .get('/comparativos/ahorro')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        budgetItemCode: 'P01',
        paidProjectId: project2.id,
        paidContactName: 'Proveedor Caro SL',
        paidUnitPrice: 100,
        minUnitPrice: 80,
        minProjectId: project1.id,
        minContactName: 'Proveedor Barato SL',
        overpayPct: 25,
        potentialSavingsAmount: 200,
      });
    });

    it('un usuario `obra` sin acceso a la obra adjudicada no ve la oportunidad', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const project1 = await createProject(app, admin.accessToken);
      const phase1 = await createPhase(app, admin.accessToken, project1.id);
      const budget1 = await createBudget(app, admin.accessToken, project1.id);
      const item1 = await addBudgetItem(app, admin.accessToken, budget1.id, {
        code: 'P01',
        phaseId: phase1.id,
      });
      const comparativo1 = await authed(app, admin.accessToken)
        .post('/comparativos')
        .send({ projectId: project1.id, phaseId: phase1.id, title: 'C1' })
        .expect(201);
      const proveedor = await createContact(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .post(`/comparativos/${comparativo1.body.id}/ofertas`)
        .send({
          contactId: proveedor.id,
          lineas: [{ budgetItemId: item1.id, unitPrice: 80, quantity: 10 }],
        })
        .expect(201);

      const project2 = await createProject(app, admin.accessToken);
      const phase2 = await createPhase(app, admin.accessToken, project2.id);
      const budget2 = await createBudget(app, admin.accessToken, project2.id);
      const item2 = await addBudgetItem(app, admin.accessToken, budget2.id, {
        code: 'P01',
        phaseId: phase2.id,
      });
      const comparativo2 = await authed(app, admin.accessToken)
        .post('/comparativos')
        .send({ projectId: project2.id, phaseId: phase2.id, title: 'C2' })
        .expect(201);
      const oferta2 = await authed(app, admin.accessToken)
        .post(`/comparativos/${comparativo2.body.id}/ofertas`)
        .send({
          contactId: proveedor.id,
          lineas: [{ budgetItemId: item2.id, unitPrice: 100, quantity: 10 }],
        })
        .expect(201);
      await authed(app, admin.accessToken)
        .post(`/comparativos/${comparativo2.body.id}/adjudicar`)
        .send({ ofertaId: oferta2.body.id })
        .expect(201);

      const { tokens: obraTokens } = await createObraUser(
        app,
        admin.accessToken,
        [project1.id],
      );
      const res = await authed(app, obraTokens.accessToken)
        .get('/comparativos/ahorro')
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('sin oportunidades, devuelve vacío', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const res = await authed(app, admin.accessToken)
        .get('/comparativos/ahorro')
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('exige token', async () => {
      await request(app.getHttpServer())
        .get('/comparativos/ahorro')
        .expect(401);
    });
  });

  describe('POST /comparativos/ahorro/resumen — resumen narrativo opcional (Fase 15)', () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;

    beforeAll(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    afterAll(() => {
      if (originalKey !== undefined)
        process.env.ANTHROPIC_API_KEY = originalKey;
    });

    it('responde 400 sin ANTHROPIC_API_KEY', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const res = await authed(app, admin.accessToken)
        .post('/comparativos/ahorro/resumen')
        .send({ opportunities: [] })
        .expect(400);
      expect(res.body.message).toContain('ANTHROPIC_API_KEY');
    });

    it('valida el cuerpo (400 del ZodValidationPipe, antes de llegar al servicio)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      await authed(app, admin.accessToken)
        .post('/comparativos/ahorro/resumen')
        .send({})
        .expect(400);
    });
  });
});
