import { INestApplication } from '@nestjs/common';
import {
  authed,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Obra en curso (WIP) al cierre: producción ejecutada (certificación a
 * origen) frente a facturado a origen, regularización contabilizada en
 * 4309 / 4389 contra 7050 de la obra, cierres en orden, anulación por
 * contra-asiento, periodo contable cerrado, cierre masivo, roles y cadena de
 * auditoría.
 */
describe('Obra en curso — WIP (integración)', () => {
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

  async function obra() {
    const o = await createProject(app, token, {
      code: `OB-${u()}`,
      contractAmount: 100_000,
    });
    return o.id as string;
  }

  const certificar = (projectId: string, certDate: string, pct: number) =>
    api()
      .post('/certifications')
      .send({ projectId, certDate, cumulativePct: pct })
      .expect(201);

  let cliente: string | null = null;
  async function facturar(projectId: string, fecha: string, base: number) {
    cliente ??= (
      await createContact(app, token, {
        kind: 'cliente',
        legalName: `Promotora ${u()} SA`,
      })
    ).id as string;
    const f = await api()
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente,
        invoiceNumber: `FV-${u()}`,
        issueDate: fecha,
        dueDate: fecha,
        lines: [
          {
            description: 'Certificación',
            baseAmount: base,
            vatPct: 21,
            projectId,
          },
        ],
      })
      .expect(201);
    await api().post(`/invoices/${f.body.id}/aprobar`).expect(201);
  }

  const cerrar = (periodo: string, projectId: string) =>
    api().post('/wip').send({ periodo, projectId });

  const asientoWip = async (periodo: string) => {
    const r = await api()
      .get(`/contabilidad/asientos?origen=obra_en_curso&desde=${periodo}-01`)
      .expect(200);
    return r.body.items[r.body.items.length - 1];
  };

  beforeEach(() => {
    cliente = null;
  });

  it('cierre mensual: regulariza solo la variación y cambia de 4309 a 4389 si se factura por anticipado', async () => {
    const id = await obra();
    // Enero: ejecutado 20.000, facturado 15.000 → pendiente de facturar 5.000.
    await certificar(id, '2026-01-20', 20);
    await facturar(id, '2026-01-25', 15_000);

    const prop = await api()
      .get(`/wip/propuesta?periodo=2026-01&projectId=${id}`)
      .expect(200);
    expect(prop.body[0]).toMatchObject({
      produccion: 20000,
      facturado: 15000,
      wip: 5000,
      wipAnterior: 0,
      regularizacion: 5000,
      margenReconocido: 20000,
      contabilizado: false,
      fechaCierre: '2026-01-31',
    });

    const ene = await cerrar('2026-01', id).expect(201);
    expect(ene.body).toMatchObject({
      periodo: '2026-01',
      estado: 'contabilizado',
      wip: 5000,
      regularizacion: 5000,
    });
    expect(ene.body.asientoId).toEqual(expect.any(String));
    const a1 = await asientoWip('2026-01');
    expect(a1.fecha).toBe('2026-01-31');
    expect(a1.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '4309', debe: 5000 }),
        expect.objectContaining({ cuenta: '7050', haber: 5000, projectId: id }),
      ]),
    );
    const otra = await cerrar('2026-01', id);
    expect(otra.status).toBe(409);
    expect(otra.headers['content-type']).toContain('application/problem+json');
    expect(otra.body.errorCode).toBe('WIP_ALREADY_POSTED');

    // Febrero: ejecutado 22.000, facturado 25.000 → anticipado 3.000; se
    // regulariza −8.000: se cancela 4309 y se abre 4389.
    await certificar(id, '2026-02-20', 22);
    await facturar(id, '2026-02-10', 10_000);
    const feb = await cerrar('2026-02', id).expect(201);
    expect(feb.body).toMatchObject({
      wip: -3000,
      wipAnterior: 5000,
      regularizacion: -8000,
    });
    const a2 = await asientoWip('2026-02');
    expect(a2.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '4309', haber: 5000 }),
        expect.objectContaining({ cuenta: '4389', haber: 3000 }),
        expect.objectContaining({ cuenta: '7050', debe: 8000, projectId: id }),
      ]),
    );
    const pendiente = await api().get('/contabilidad/mayor/4309').expect(200);
    expect(pendiente.body.saldoFinal).toBe(0);

    // Con las facturas pasadas por la interfaz contable, el ingreso de la
    // obra queda en la producción ejecutada: 25.000 facturado − 3.000 = 22.000.
    await api().post('/contabilidad/interfaz/contabilizar').expect(200);
    const porObra = await api()
      .get(`/contabilidad/sumas-saldos?projectId=${id}`)
      .expect(200);
    const ingreso = porObra.body.filas.find(
      (f: { codigo: string }) => f.codigo === '7050',
    );
    expect(ingreso.saldoAcreedor).toBe(22000);
  });

  it('anulación por contra-asiento: solo el último cierre, y se puede volver a cerrar', async () => {
    const id = await obra();
    await certificar(id, '2026-01-20', 10);
    const ene = (await cerrar('2026-01', id).expect(201)).body;
    await certificar(id, '2026-02-20', 30);
    const feb = (await cerrar('2026-02', id).expect(201)).body;

    const noUltimo = await api()
      .post(`/wip/${ene.id}/anular`)
      .send({ motivo: 'Error de medición' });
    expect(noUltimo.status).toBe(409);
    expect(noUltimo.body.errorCode).toBe('WIP_NOT_LATEST');

    const sinMotivo = await api().post(`/wip/${feb.id}/anular`).send({});
    expect(sinMotivo.status).toBe(400);
    const vieja = await api()
      .post(`/wip/${feb.id}/anular`)
      .set('If-Match', `"${feb.version + 1}"`)
      .send({ motivo: 'Error de medición' });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const anulado = await api()
      .post(`/wip/${feb.id}/anular`)
      .set('If-Match', `"${feb.version}"`)
      .send({ motivo: 'Error de medición' })
      .expect(200);
    expect(anulado.body).toMatchObject({
      estado: 'anulado',
      motivoAnulacion: 'Error de medición',
    });
    expect(anulado.body.contraAsientoId).toEqual(expect.any(String));
    // Tras anular febrero, 4309 vuelve al WIP de enero (10.000).
    const m = await api().get('/contabilidad/mayor/4309').expect(200);
    expect(m.body.saldoFinal).toBe(10000);
    // Y febrero se puede volver a cerrar.
    await cerrar('2026-02', id).expect(201);
  });

  it('cierres en orden; periodo contable cerrado: no se cierra ni se anula', async () => {
    const id = await obra();
    await certificar(id, '2026-01-20', 10);
    await certificar(id, '2026-03-20', 20);
    await cerrar('2026-03', id).expect(201);
    const atras = await cerrar('2026-01', id);
    expect(atras.status).toBe(409);
    expect(atras.body.errorCode).toBe('WIP_PERIOD_OUT_OF_ORDER');

    const id2 = await obra();
    await certificar(id2, '2026-04-10', 5);
    await api().post('/contabilidad/periodos/2026/4/cerrar').expect(200);
    const cerrado = await cerrar('2026-04', id2);
    expect(cerrado.status).toBe(409);
    expect(cerrado.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const nada = await api()
      .get(`/wip?periodo=2026-04&projectId=${id2}`)
      .expect(200);
    expect(nada.body).toEqual([]);

    // Un cierre de un periodo después cerrado no se puede anular.
    await api().post('/contabilidad/periodos/2026/3/cerrar').expect(200);
    const [marzo] = (await api().get(`/wip?projectId=${id}`).expect(200)).body;
    const anular = await api()
      .post(`/wip/${marzo.id}/anular`)
      .send({ motivo: 'Revisión' });
    expect(anular.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const sigue = await api().get(`/wip?projectId=${id}`).expect(200);
    expect(sigue.body[0].estado).toBe('contabilizado');
  });

  it('cierre masivo del periodo: todas las obras con actividad, sin repetir', async () => {
    const a = await obra();
    const b = await obra();
    await obra(); // sin actividad: no entra
    await certificar(a, '2026-05-10', 10);
    await certificar(b, '2026-05-12', 20);
    await facturar(b, '2026-05-15', 25_000);
    const r = await api()
      .post('/wip/cierre')
      .send({ periodo: '2026-05' })
      .expect(200);
    expect(r.body).toMatchObject({
      periodo: '2026-05',
      contabilizados: 2,
      // a: +10.000; b: 20.000 − 25.000 = −5.000.
      regularizacion: 5000,
      omitidos: [],
    });
    const otra = await api()
      .post('/wip/cierre')
      .send({ periodo: '2026-05' })
      .expect(200);
    expect(otra.body.contabilizados).toBe(0);
  });

  it('roles, acceso y cadena de auditoría', async () => {
    const id = await obra();
    await certificar(id, '2026-06-10', 10);
    const jefe = await createObraUser(app, token, [id]);
    await authed(app, jefe.tokens.accessToken).get('/wip').expect(403);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get(`/wip/propuesta?periodo=2026-06`)
      .expect(200);
    await authed(app, lector.accessToken)
      .post('/wip')
      .send({ periodo: '2026-06', projectId: id })
      .expect(403);
    const noExiste = await cerrar(
      '2026-06',
      '00000000-0000-4000-8000-000000000000',
    );
    expect(noExiste.status).toBe(404);
    expect(noExiste.body.errorCode).toBe('PROJECT_NOT_FOUND');

    await cerrar('2026-06', id).expect(201);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
    const audit = await api()
      .get('/audit?entityType=work_in_progress')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBeGreaterThanOrEqual(1);
  });
});
