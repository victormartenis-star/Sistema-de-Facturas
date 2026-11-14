import { INestApplication } from '@nestjs/common';
import {
  activateBudget,
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

/** Fase 3, paso 8: GET /projects/:id/economics. */
describe('Economía de obra (integración) — GET /projects/:id/economics', () => {
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

  const unico = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  it('calcula margen, desviaciones con "Sin partida", retenciones e IVA con la pareja rectificada neteada', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const project = await createProject(app, token); // contrato 100 000
    const phase = await createPhase(app, token, project.id);
    const budget = await createBudget(app, token, project.id);
    await addBudgetItem(app, token, budget.id, {
      unitPrice: 1000,
      quantity: 10, // 10 000 en la partida
      phaseId: phase.id,
    });
    await addBudgetItem(app, token, budget.id, {
      unitPrice: 200,
      quantity: 10, // 2 000 sin partida
    });
    await activateBudget(app, token, budget.id);

    const cliente = await createContact(app, token, { kind: 'cliente' });
    const proveedor = await createContact(app, token, { kind: 'proveedor' });

    // Compras: 1 500 en la partida y 300 sin partida (ambas en borrador).
    for (const [base, phaseId] of [
      [1500, phase.id],
      [300, undefined],
    ] as const) {
      await authed(app, token)
        .post('/invoices')
        .send({
          kind: 'compra',
          contactId: proveedor.id,
          invoiceNumber: `FC-${unico()}`,
          issueDate: '2026-09-14',
          lines: [
            {
              description: 'Material',
              baseAmount: base,
              vatPct: 21,
              projectId: project.id,
              phaseId,
            },
          ],
        })
        .expect(201);
    }

    const venta = async (base: number) => {
      const res = await authed(app, token)
        .post('/invoices')
        .send({
          kind: 'venta',
          contactId: cliente.id,
          invoiceNumber: `FV-${unico()}`,
          issueDate: '2026-09-14',
          dueDate: '2026-10-14',
          retentionPct: 5,
          lines: [
            {
              description: 'Certificación',
              baseAmount: base,
              vatPct: 21,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${res.body.id}/aprobar`)
        .expect(201);
      return res.body.id as string;
    };

    // Una venta de 1 000 rectificada por completo y otra de 2 000 vigente.
    const rectificada = await venta(1000);
    const rect = await authed(app, token)
      .post(`/invoices/${rectificada}/rectificar`)
      .send({
        clase: 'total',
        rectificationMotive: 'R4',
        rectificationType: 'S',
        issueDate: '2026-10-01',
        motivo: 'Cliente equivocado',
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${rect.body.id}/aprobar`)
      .expect(201);
    await venta(2000);

    await authed(app, token)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 30,
      })
      .expect(201); // EV = 30 000

    const res = await authed(app, token)
      .get(`/projects/${project.id}/economics`)
      .expect(200);
    const body = res.body;

    expect(body.projectId).toBe(project.id);
    expect(body.margen.certificado).toBe(30_000);
    // 1 000 − 1 000 + 2 000: la pareja rectificada netea a cero.
    expect(body.margen.facturadoVenta).toBe(2_000);
    expect(body.margen.costeReal).toBe(1_800);
    expect(body.margen.margenSobreCertificado).toBe(28_200);
    expect(body.margen.pendienteFacturar).toBe(28_000);
    expect(body.margen.facturasCompraEnBorrador).toBe(1_800);

    const conPartida = body.desviaciones.find(
      (d: { phaseId: string | null }) => d.phaseId === phase.id,
    );
    const sinPartida = body.desviaciones.find(
      (d: { phaseId: string | null }) => d.phaseId === null,
    );
    expect(conPartida.budget).toBe(10_000);
    expect(conPartida.actual).toBe(1_500);
    expect(sinPartida.name).toBe('Sin partida');
    expect(sinPartida.budget).toBe(2_000);
    expect(sinPartida.actual).toBe(300);
    // Cuadre: la suma de lo real por fila es el coste real total.
    const suma = body.desviaciones.reduce(
      (s: number, d: { actual: number }) => s + d.actual,
      0,
    );
    expect(suma).toBe(body.margen.costeReal);

    // Retención: solo la de la venta vigente (5 % de 2 000); la de la
    // rectificada se eliminó al aprobar la rectificativa.
    expect(body.retenciones.aCobrarDeCliente.pendiente).toBe(100);

    expect(body.iva.totalRepercutido).toBe(420);
    expect(body.iva.repercutido).toEqual([
      { vatPct: 21, baseAmount: 2_000, vatAmount: 420 },
    ]);
    expect(body.iva.totalSoportado).toBe(0); // las compras siguen en borrador

    // Previsto: contrato 100 000 − presupuesto activo 12 000 (coste previsto).
    expect(body.previsto).toEqual({
      contrato: 100_000,
      totalPresupuestado: 12_000,
      margenPrevisto: 88_000,
      margenPrevistoPct: 88,
      // margen actual 94 % (28 200 / 30 000) − 88 %
      diferenciaPuntos: 6,
    });
  });

  it('previsto: sin presupuesto activo usa el presupuesto de las partidas', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const project = await createProject(app, token); // contrato 100 000
    await createPhase(app, token, project.id, { budgetAmount: 60_000 });
    await createPhase(app, token, project.id, { budgetAmount: 15_000 });

    const { body } = await authed(app, token)
      .get(`/projects/${project.id}/economics`)
      .expect(200);
    expect(body.previsto.totalPresupuestado).toBe(75_000);
    expect(body.previsto.margenPrevisto).toBe(25_000);
    expect(body.previsto.margenPrevistoPct).toBe(25);
    // Nada certificado: margen actual sin porcentaje -> sin diferencia.
    expect(body.previsto.diferenciaPuntos).toBeNull();
  });

  it('previsto: obra sin contrato no tiene margen previsto pero sí total presupuestado', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const project = await createProject(app, token, { contractAmount: null });
    await createPhase(app, token, project.id, { budgetAmount: 5_000 });

    const { body } = await authed(app, token)
      .get(`/projects/${project.id}/economics`)
      .expect(200);
    expect(body.previsto).toEqual({
      contrato: null,
      totalPresupuestado: 5_000,
      margenPrevisto: null,
      margenPrevistoPct: null,
      diferenciaPuntos: null,
    });
  });

  /** Venta aprobada de 100,07 + 100,07 al 21 % repartida en dos obras, retención 5 %. */
  async function ventaRepartida(token: string, a: string, b: string) {
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-${unico()}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        retentionPct: 5,
        lines: [
          {
            description: 'Obra A',
            baseAmount: 100.07,
            vatPct: 21,
            projectId: a,
          },
          {
            description: 'Obra B',
            baseAmount: 100.07,
            vatPct: 21,
            projectId: b,
          },
        ],
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${res.body.id}/aprobar`)
      .expect(201);
    return res.body.id as string;
  }

  const cents = (n: number) => Math.round(n * 100);

  it('una factura repartida entre dos obras se prorratea y la suma cuadra con la factura', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const obraA = await createProject(app, token);
    const obraB = await createProject(app, token);
    await ventaRepartida(token, obraA.id, obraB.id);

    const [menor, mayor] = [obraA.id, obraB.id].sort();
    const eco = async (id: string) =>
      (await authed(app, token).get(`/projects/${id}/economics`).expect(200))
        .body;
    const eMenor = await eco(menor);
    const eMayor = await eco(mayor);

    expect(eMenor.margen.facturadoVenta).toBe(100.07);
    expect(eMayor.margen.facturadoVenta).toBe(100.07);
    // Retención de la factura: 10,01 -> 5,01 + 5,00 (antes 10,01 en cada obra).
    expect(eMenor.retenciones.aCobrarDeCliente.pendiente).toBe(5.01);
    expect(eMayor.retenciones.aCobrarDeCliente.pendiente).toBe(5);
    expect(
      cents(eMenor.retenciones.aCobrarDeCliente.pendiente) +
        cents(eMayor.retenciones.aCobrarDeCliente.pendiente),
    ).toBe(1001);
    // IVA de la factura: 42,03 -> 21,02 + 21,01 (antes 21,01 + 21,01).
    expect(eMenor.iva.totalRepercutido).toBe(21.02);
    expect(eMayor.iva.totalRepercutido).toBe(21.01);
    expect(
      cents(eMenor.iva.totalRepercutido) + cents(eMayor.iva.totalRepercutido),
    ).toBe(4203);
    expect(eMenor.iva.repercutido[0].baseAmount).toBe(100.07);
    expect(eMayor.iva.repercutido[0].baseAmount).toBe(100.07);
  });

  it('un usuario obra solo ve la economía de sus obras (404 en las ajenas)', async () => {
    const admin = await registerUser(app);
    const propia = await createProject(app, admin.accessToken);
    const ajena = await createProject(app, admin.accessToken);
    const obra = await createObraUser(app, admin.accessToken, [propia.id]);

    await authed(app, obra.tokens.accessToken)
      .get(`/projects/${propia.id}/economics`)
      .expect(200);
    await authed(app, obra.tokens.accessToken)
      .get(`/projects/${ajena.id}/economics`)
      .expect(404);
  });
});
