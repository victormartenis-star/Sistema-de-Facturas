import { INestApplication } from '@nestjs/common';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createObraUser,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Provisión por pérdidas previstas (contratos onerosos, NRV 14): pérdida total
 * = coste estimado al cierre (cuadro de márgenes) − contrato; menos la ya
 * reconocida por el grado de avance; cada cierre contabiliza el ajuste frente
 * a la provisión vigente (6954 obra / 4994 en dotación, 4994 / 7954 obra en
 * exceso). Obra rentable, dotación, ajuste incremental, reversión, obra
 * terminada, anulación por contra-asiento, periodo contable cerrado, cierre
 * masivo, roles y cadena de auditoría.
 */
describe('Provisión por pérdidas previstas (integración)', () => {
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

  const api = () => authed(app, token);
  const u = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  /** Obra con contrato y presupuesto de coste activo (coste estimado al cierre). */
  async function obra(contrato: number, presupuesto: number) {
    const o = await createProject(app, token, {
      code: `OB-${u()}`,
      contractAmount: contrato,
    });
    const b = await createBudget(app, token, o.id);
    await addBudgetItem(app, token, b.id, {
      unitPrice: 10,
      quantity: presupuesto / 10,
    });
    await activateBudget(app, token, b.id);
    return o.id as string;
  }

  async function editarObra(id: string, cambios: Record<string, unknown>) {
    const actual = await api().get(`/projects/${id}`).expect(200);
    await api()
      .patch(`/projects/${id}`)
      .set('If-Match', `"${actual.body.version}"`)
      .send(cambios)
      .expect(200);
  }

  const certificar = (projectId: string, certDate: string, pct: number) =>
    api()
      .post('/certifications')
      .send({ projectId, certDate, cumulativePct: pct })
      .expect(201);

  const cerrar = (periodo: string, projectId: string) =>
    api().post('/provision-perdidas').send({ periodo, projectId });

  const ultimoAsiento = async (periodo: string) => {
    const r = await api()
      .get(
        `/contabilidad/asientos?origen=provision_perdidas&desde=${periodo}-01`,
      )
      .expect(200);
    return r.body.items[r.body.items.length - 1];
  };

  const saldo4994 = async () => {
    const r = await api().get('/contabilidad/sumas-saldos').expect(200);
    const f = r.body.filas.find((x: { codigo: string }) => x.codigo === '4994');
    return f ? f.saldoAcreedor - f.saldoDeudor : 0;
  };

  it('obra rentable: sin pérdida, sin provisión ni asiento', async () => {
    const id = await obra(100_000, 90_000);
    await certificar(id, '2026-01-20', 30);
    const prop = await api()
      .get(`/provision-perdidas/propuesta?periodo=2026-01&projectId=${id}`)
      .expect(200);
    expect(prop.body[0]).toMatchObject({
      contrato: 100000,
      costeEstimadoCierre: 90000,
      perdidaTotal: 0,
      provisionNecesaria: 0,
      ajuste: 0,
    });
    // El listado general solo trae obras con pérdida o provisión vigente.
    const todas = await api()
      .get('/provision-perdidas/propuesta?periodo=2026-01')
      .expect(200);
    expect(todas.body).toEqual([]);
    const r = await cerrar('2026-01', id).expect(201);
    expect(r.body).toMatchObject({ ajuste: 0, asientoId: null });
  });

  it('dotación, ajuste incremental sin duplicar, reversión al mejorar y obra terminada', async () => {
    // Contrato 100.000, coste estimado 110.000: pérdida 10.000. Producción
    // 20.000 sin coste real todavía: nada reconocido, se provisiona entera.
    const id = await obra(100_000, 110_000);
    await certificar(id, '2026-01-20', 20);
    const ene = await cerrar('2026-01', id).expect(201);
    expect(ene.body).toMatchObject({
      periodo: '2026-01',
      estado: 'contabilizado',
      perdidaTotal: 10000,
      perdidaReconocida: 0,
      provisionNecesaria: 10000,
      provisionAnterior: 0,
      ajuste: 10000,
      produccion: 20000,
    });
    const a1 = await ultimoAsiento('2026-01');
    expect(a1.fecha).toBe('2026-01-31');
    expect(a1.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '6954', debe: 10000, projectId: id }),
        expect.objectContaining({ cuenta: '4994', haber: 10000 }),
      ]),
    );
    const otra = await cerrar('2026-01', id);
    expect(otra.status).toBe(409);
    expect(otra.headers['content-type']).toContain('application/problem+json');
    expect(otra.headers['x-request-id']).toEqual(expect.any(String));
    expect(otra.body.errorCode).toBe('LOSS_PROVISION_ALREADY_POSTED');

    // Febrero: el contrato baja a 95.000 → pérdida 15.000; solo se dota +5.000.
    await editarObra(id, { contractAmount: 95_000 });
    const feb = await cerrar('2026-02', id).expect(201);
    expect(feb.body).toMatchObject({
      provisionNecesaria: 15000,
      provisionAnterior: 10000,
      ajuste: 5000,
    });
    expect(await saldo4994()).toBe(15000);

    // Marzo: modificado a 108.000 → pérdida 2.000: exceso de 13.000.
    await editarObra(id, { contractAmount: 108_000 });
    const mar = await cerrar('2026-03', id).expect(201);
    expect(mar.body).toMatchObject({
      provisionNecesaria: 2000,
      ajuste: -13000,
    });
    const a3 = await ultimoAsiento('2026-03');
    expect(a3.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '4994', debe: 13000 }),
        expect.objectContaining({
          cuenta: '7954',
          haber: 13000,
          projectId: id,
        }),
      ]),
    );
    expect(await saldo4994()).toBe(2000);

    // Abril: obra terminada → la pérdida ya está realizada; provisión a 0.
    await editarObra(id, { status: 'finalizada' });
    const abr = await cerrar('2026-04', id).expect(201);
    expect(abr.body).toMatchObject({ provisionNecesaria: 0, ajuste: -2000 });
    expect(await saldo4994()).toBe(0);
  });

  it('anulación por contra-asiento: solo el último cierre, If-Match y nuevo cierre', async () => {
    const id = await obra(100_000, 110_000);
    await certificar(id, '2026-01-20', 10);
    const ene = (await cerrar('2026-01', id).expect(201)).body;
    await editarObra(id, { contractAmount: 90_000 });
    const feb = (await cerrar('2026-02', id).expect(201)).body;
    expect(feb.ajuste).toBe(10000);

    const noUltimo = await api()
      .post(`/provision-perdidas/${ene.id}/anular`)
      .send({ motivo: 'Estimación errónea' });
    expect(noUltimo.status).toBe(409);
    expect(noUltimo.body.errorCode).toBe('LOSS_PROVISION_NOT_LATEST');
    const sinMotivo = await api()
      .post(`/provision-perdidas/${feb.id}/anular`)
      .send({});
    expect(sinMotivo.status).toBe(400);
    const vieja = await api()
      .post(`/provision-perdidas/${feb.id}/anular`)
      .set('If-Match', `"${feb.version + 1}"`)
      .send({ motivo: 'Estimación errónea' });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const anulado = await api()
      .post(`/provision-perdidas/${feb.id}/anular`)
      .set('If-Match', `"${feb.version}"`)
      .send({ motivo: 'Estimación errónea' })
      .expect(200);
    expect(anulado.body).toMatchObject({
      estado: 'anulado',
      motivoAnulacion: 'Estimación errónea',
    });
    expect(anulado.body.contraAsientoId).toEqual(expect.any(String));
    // La provisión vuelve a la de enero y febrero puede cerrarse otra vez.
    expect(await saldo4994()).toBe(10000);
    const de_nuevo = await cerrar('2026-02', id).expect(201);
    expect(de_nuevo.body).toMatchObject({
      provisionAnterior: 10000,
      ajuste: 10000,
    });
  });

  it('cierres en orden; periodo contable cerrado: no se cierra ni se anula', async () => {
    const id = await obra(100_000, 120_000);
    await certificar(id, '2026-03-20', 10);
    await cerrar('2026-03', id).expect(201);
    const atras = await cerrar('2026-01', id);
    expect(atras.status).toBe(409);
    expect(atras.body.errorCode).toBe('LOSS_PROVISION_PERIOD_OUT_OF_ORDER');

    const id2 = await obra(50_000, 60_000);
    await api().post('/contabilidad/periodos/2026/4/cerrar').expect(200);
    const cerrado = await cerrar('2026-04', id2);
    expect(cerrado.status).toBe(409);
    expect(cerrado.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const nada = await api()
      .get(`/provision-perdidas?periodo=2026-04&projectId=${id2}`)
      .expect(200);
    expect(nada.body).toEqual([]);

    await api().post('/contabilidad/periodos/2026/3/cerrar').expect(200);
    const [marzo] = (
      await api().get(`/provision-perdidas?projectId=${id}`).expect(200)
    ).body;
    const anular = await api()
      .post(`/provision-perdidas/${marzo.id}/anular`)
      .send({ motivo: 'Revisión' });
    expect(anular.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const sigue = await api()
      .get(`/provision-perdidas?projectId=${id}`)
      .expect(200);
    expect(sigue.body[0].estado).toBe('contabilizado');
    expect(await saldo4994()).toBe(20000);
  });

  it('cierre masivo, roles, acceso y cadena de auditoría', async () => {
    const a = await obra(100_000, 104_000);
    const b = await obra(50_000, 53_000);
    await obra(80_000, 70_000); // rentable: no entra
    const r = await api()
      .post('/provision-perdidas/cierre')
      .send({ periodo: '2026-05' })
      .expect(200);
    expect(r.body).toMatchObject({
      periodo: '2026-05',
      contabilizados: 2,
      ajuste: 7000,
      omitidos: [],
    });
    const otra = await api()
      .post('/provision-perdidas/cierre')
      .send({ periodo: '2026-05' })
      .expect(200);
    expect(otra.body.contabilizados).toBe(0);

    const jefe = await createObraUser(app, token, [a]);
    await authed(app, jefe.tokens.accessToken)
      .get('/provision-perdidas')
      .expect(403);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get('/provision-perdidas/propuesta?periodo=2026-05')
      .expect(200);
    await authed(app, lector.accessToken)
      .post('/provision-perdidas')
      .send({ periodo: '2026-06', projectId: b })
      .expect(403);
    const noExiste = await cerrar(
      '2026-06',
      '00000000-0000-4000-8000-000000000000',
    );
    expect(noExiste.status).toBe(404);
    expect(noExiste.body.errorCode).toBe('PROJECT_NOT_FOUND');

    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
    const audit = await api()
      .get('/audit?entityType=loss_provision')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBeGreaterThanOrEqual(2);
  });
});
