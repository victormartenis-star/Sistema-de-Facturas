import { INestApplication } from '@nestjs/common';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createPhase,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Cost control (integración) — GET /projects/:id/cost-control', () => {
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

  it('calcula BAC/AC/EV, margen, CPI y EAC a partir de presupuesto, facturas, partes y certificación', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    // contractAmount por defecto del helper: 100 000 € (lo usa la certificación).
    const project = await createProject(app, admin.accessToken);
    const phase = await createPhase(app, admin.accessToken, project.id);
    const budget = await createBudget(app, admin.accessToken, project.id);
    await addBudgetItem(app, admin.accessToken, budget.id, {
      code: 'P01',
      unitPrice: 1000,
      quantity: 50, // 50 000
      phaseId: phase.id,
    });
    await addBudgetItem(app, admin.accessToken, budget.id, {
      code: 'P02',
      unitPrice: 1000,
      quantity: 50, // 50 000
      phaseId: phase.id,
    });
    await activateBudget(app, admin.accessToken, budget.id); // BAC = 100 000

    const provider = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
    });
    await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: provider.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'Suministro de material',
            baseAmount: 15_000,
            vatPct: 21,
            projectId: project.id,
            phaseId: phase.id,
          },
        ],
      })
      .expect(201);

    await authed(app, admin.accessToken)
      .post('/partes-diarios/personal')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        workerName: 'Juan Pérez',
        workDate: '2026-09-14',
        ordinaryHours: 8,
        overtimeHours: 0,
        ordinaryRate: 375,
        overtimeRate: 0,
      })
      .expect(201); // 8 * 375 = 3 000

    await authed(app, admin.accessToken)
      .post('/partes-diarios/maquinaria')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        machineName: 'Retroexcavadora',
        ownership: 'alquilada',
        workDate: '2026-09-14',
        hoursUsed: 8,
        hourlyRate: 250,
      })
      .expect(201); // 8 * 250 = 2 000
    // AC total = 15 000 + 3 000 + 2 000 = 20 000

    await authed(app, admin.accessToken)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 30,
      })
      .expect(201); // EV = 30 % de 100 000 = 30 000

    const res = await authed(app, admin.accessToken)
      .get(`/projects/${project.id}/cost-control`)
      .expect(200);

    expect(res.body.bac).toBeCloseTo(100_000, 2);
    expect(res.body.ac).toBeCloseTo(20_000, 2);
    expect(res.body.ev).toBeCloseTo(30_000, 2);
    expect(res.body.acBreakdown).toEqual({
      facturasCompra: 15_000,
      partesPersonal: 3_000,
      partesMaquinaria: 2_000,
    });
    expect(res.body.currentMargin).toBeCloseTo(10_000, 2);
    expect(res.body.currentMarginPct).toBeCloseTo(33.33, 1);
    expect(res.body.cpi).toBeCloseTo(1.5, 2);
    expect(res.body.percentComplete).toBeCloseTo(30, 2);
    expect(res.body.eac).toBeCloseTo(66_666.67, 1);
    expect(res.body.varianceAtCompletion).toBeCloseTo(33_333.33, 1);

    const row = res.body.sobrecostePorPartida.find(
      (r: { phaseId: string }) => r.phaseId === phase.id,
    );
    expect(row).toBeDefined();
    expect(row.budget).toBeCloseTo(100_000, 2);
    expect(row.actual).toBeCloseTo(20_000, 2);
    expect(row.overBudget).toBe(false);

    expect(Array.isArray(res.body.curvaS)).toBe(true);
    expect(res.body.curvaS.length).toBeGreaterThan(0);
    expect(res.body.curvaS[0].period).toBe('2026-09');
  });

  it('marca overBudget cuando el gasto real de una partida supera su presupuesto', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    const phase = await createPhase(app, admin.accessToken, project.id);
    const budget = await createBudget(app, admin.accessToken, project.id);
    await addBudgetItem(app, admin.accessToken, budget.id, {
      unitPrice: 100,
      quantity: 10, // presupuesto de la partida: 1 000
      phaseId: phase.id,
    });
    await activateBudget(app, admin.accessToken, budget.id);

    await authed(app, admin.accessToken)
      .post('/partes-diarios/maquinaria')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        machineName: 'Grúa torre',
        workDate: '2026-09-14',
        hoursUsed: 10,
        hourlyRate: 500, // 5 000 de coste real, muy por encima del presupuesto
      })
      .expect(201);

    const res = await authed(app, admin.accessToken)
      .get(`/projects/${project.id}/cost-control`)
      .expect(200);
    const row = res.body.sobrecostePorPartida.find(
      (r: { phaseId: string }) => r.phaseId === phase.id,
    );
    expect(row.overBudget).toBe(true);
    expect(row.deviation).toBeCloseTo(4_000, 2);
  });

  it('obra sin presupuesto activo ni movimientos: BAC cae al importe de contrato, AC y EV en 0', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken, {
      contractAmount: 50_000,
    });

    const res = await authed(app, admin.accessToken)
      .get(`/projects/${project.id}/cost-control`)
      .expect(200);
    expect(res.body.bac).toBeCloseTo(50_000, 2);
    expect(res.body.ac).toBe(0);
    expect(res.body.ev).toBe(0);
    expect(res.body.eac).toBeCloseTo(50_000, 2);
    expect(res.body.curvaS).toEqual([]);
  });
});
