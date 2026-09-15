import { INestApplication } from '@nestjs/common';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Investors (integración) — inversores y cuentas en participación', () => {
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

  it('alta de inversor, cuenta a nivel de empresa, participaciones, cashflows, reparto e informe TIR/VAN', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);

    const investorA = (
      await client
        .post('/investors')
        .send({ kind: 'persona_fisica', legalName: 'Inversor A' })
        .expect(201)
    ).body;
    const investorB = (
      await client
        .post('/investors')
        .send({ kind: 'persona_juridica', legalName: 'Inversor B, S.L.' })
        .expect(201)
    ).body;

    const account = (
      await client
        .post('/investment-accounts')
        .send({
          name: 'Promoción Central',
          committedAmount: 300000,
          startDate: '2024-01-01',
        })
        .expect(201)
    ).body;
    expect(account.totalParticipationPct).toBe(0);

    await client
      .post(`/investment-accounts/${account.id}/participations`)
      .send({
        investorId: investorA.id,
        participationPct: 60,
        committedAmount: 180000,
        joinedAt: '2024-01-01',
      })
      .expect(201);
    const partB = (
      await client
        .post(`/investment-accounts/${account.id}/participations`)
        .send({
          investorId: investorB.id,
          participationPct: 40,
          committedAmount: 120000,
          joinedAt: '2024-01-01',
        })
        .expect(201)
    ).body;
    expect(partB.participationPct).toBe(40);

    const accountAfter = (
      await client.get(`/investment-accounts/${account.id}`).expect(200)
    ).body;
    expect(accountAfter.totalParticipationPct).toBe(100);

    // Aportaciones iniciales (una por inversor, proporcionales al %).
    await client
      .post(`/investment-accounts/${account.id}/cashflows`)
      .send({
        investorId: investorA.id,
        direction: 'aportacion',
        flowDate: '2024-01-01',
        amount: 180000,
      })
      .expect(201);
    await client
      .post(`/investment-accounts/${account.id}/cashflows`)
      .send({
        investorId: investorB.id,
        direction: 'aportacion',
        flowDate: '2024-01-01',
        amount: 120000,
      })
      .expect(201);

    // Reparto de dividendo pro-rata: la suma repartida debe cuadrar exacto.
    // Reparto pequeño intermedio: solo comprueba que el redondeo a céntimo
    // cuadra exacto (300.000 aportado entre 2, un reparto que no divide limpio).
    const distribuido = (
      await client
        .post(`/investment-accounts/${account.id}/distribuir`)
        .send({ totalAmount: 10000.01, flowDate: '2024-06-01' })
        .expect(201)
    ).body;
    expect(distribuido.created).toHaveLength(2);
    const sumaRepartida = distribuido.created.reduce(
      (s: number, c: { amount: number }) => s + c.amount,
      0,
    );
    expect(Math.round(sumaRepartida * 100) / 100).toBe(10000.01);

    // Reparto final que devuelve más de lo aportado (300.000 + plusvalía):
    // con esto sí, la TIR de cada inversor debe salir positiva.
    await client
      .post(`/investment-accounts/${account.id}/distribuir`)
      .send({ totalAmount: 330000, flowDate: '2025-01-01' })
      .expect(201);

    const informe = (
      await client
        .get(`/investment-accounts/${account.id}/informe?discountRate=0.08`)
        .expect(200)
    ).body;
    expect(informe.investors).toHaveLength(2);
    for (const row of informe.investors) {
      expect(row.irr).not.toBeNull();
      expect(row.irr).toBeGreaterThan(0);
    }

    const cashflows = (
      await client
        .get(`/investment-accounts/${account.id}/cashflows`)
        .expect(200)
    ).body;
    expect(cashflows).toHaveLength(6); // 2 aportaciones + 2 repartos x 2
  });

  it('una cuenta a nivel de empresa no es visible para un usuario con RBAC de obra', async () => {
    const admin = await registerUser(app);
    const client = authed(app, admin.accessToken);

    await client
      .post('/investment-accounts')
      .send({
        name: 'Fondo corporativo',
        committedAmount: 50000,
        startDate: '2024-01-01',
      })
      .expect(201);

    const obraUser = await registerUser(app, { role: 'obra' });
    const obraClient = authed(app, obraUser.accessToken);
    const list = (await obraClient.get('/investment-accounts').expect(200))
      .body;
    expect(list).toEqual([]);
  });
});
