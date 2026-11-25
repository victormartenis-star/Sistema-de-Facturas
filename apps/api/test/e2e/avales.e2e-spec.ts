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
 * Avales bancarios y garantías: alta con vínculos, liberación parcial y total,
 * ejecución con asiento (emitido 6780/5720, recibido 5720/7780), comisión
 * (6260/5720), prórroga, vencimiento, anulación, periodo contable cerrado,
 * concurrencia (If-Match) e idempotencia, acceso por obra, errores
 * BANK_GUARANTEE_* en RFC 7807 y cadena de auditoría íntegra.
 */
describe('Avales bancarios (integración)', () => {
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

  async function alta(extra: Record<string, unknown> = {}) {
    const r = await api()
      .post('/avales')
      .send({
        referencia: `AV-${u()}`,
        tipo: 'garantia_definitiva',
        direccion: 'emitido',
        entidad: 'Banco de Pruebas',
        importe: 100_000,
        fechaEmision: '2026-01-10',
        fechaVencimiento: '2026-12-31',
        ...extra,
      })
      .expect(201);
    return r.body;
  }

  const asientosAval = async () =>
    (
      await api()
        .get('/contabilidad/asientos?origen=aval&desde=2026-01-01')
        .expect(200)
    ).body.items;

  const problema = (r: { status: number; headers: Record<string, string> }) => {
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.headers['x-request-id']).toEqual(expect.any(String));
  };

  it('alta con obra, contacto y cuenta; validaciones y referencia duplicada', async () => {
    const obra = await createProject(app, token);
    const cliente = await createContact(app, token);
    const cuenta = await api()
      .post('/treasury/cuentas')
      .send({ name: 'Cuenta avales' })
      .expect(201);
    const a = await alta({
      referencia: 'AV-001',
      projectId: obra.id,
      contactId: cliente.id,
      bankAccountId: cuenta.body.id,
      tasaComisionAnualPct: 0.75,
      periodicidadComisionMeses: 3,
    });
    expect(a).toMatchObject({
      referencia: 'AV-001',
      estado: 'vigente',
      nominal: 100000,
      saldoVivo: 100000,
      liberado: 0,
      ejecutado: 0,
      projectCodigo: obra.code,
      contactNombre: 'Cliente de Pruebas SL',
      tasaComisionAnualPct: 0.75,
      version: 1,
    });
    expect(a.movimientos).toEqual([
      expect.objectContaining({
        tipo: 'alta',
        importe: 100000,
        saldoVivo: 100000,
      }),
    ]);

    const dup = await api().post('/avales').send({
      referencia: 'AV-001',
      tipo: 'anticipo',
      direccion: 'emitido',
      entidad: 'Banco de Pruebas',
      importe: 5,
      fechaEmision: '2026-01-10',
    });
    expect(dup.status).toBe(409);
    problema(dup);
    expect(dup.body.errorCode).toBe('BANK_GUARANTEE_REFERENCE_DUPLICATE');

    const malVinculo = await api().post('/avales').send({
      referencia: 'AV-X',
      tipo: 'otro',
      direccion: 'recibido',
      entidad: 'Banco',
      importe: 5,
      fechaEmision: '2026-01-10',
      contactId: '00000000-0000-4000-8000-000000000000',
    });
    expect(malVinculo.status).toBe(422);
    expect(malVinculo.body.errorCode).toBe('BANK_GUARANTEE_LINK_INVALID');

    const malas = await api().post('/avales').send({
      referencia: 'AV-Y',
      tipo: 'otro',
      direccion: 'emitido',
      entidad: 'Banco',
      importe: -1,
      fechaEmision: '2026-01-10',
    });
    expect(malas.status).toBe(400);
  });

  it('liberación parcial y total sin asiento; estado terminal', async () => {
    const a = await alta();
    const p1 = await api()
      .post(`/avales/${a.id}/liberar`)
      .set('If-Match', `"${a.version}"`)
      .send({
        fecha: '2026-03-01',
        importe: 30_000.55,
        motivo: 'Recepción parcial',
      })
      .expect(200);
    expect(p1.body).toMatchObject({
      estado: 'liberado_parcial',
      liberado: 30000.55,
      saldoVivo: 69999.45,
      version: 2,
    });
    const exceso = await api()
      .post(`/avales/${a.id}/liberar`)
      .send({ fecha: '2026-03-02', importe: 69_999.46, motivo: 'Demasiado' });
    expect(exceso.status).toBe(422);
    problema(exceso);
    expect(exceso.body.errorCode).toBe('BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE');

    const total = await api()
      .post(`/avales/${a.id}/liberar`)
      .send({ fecha: '2026-04-01', motivo: 'Recepción definitiva' })
      .expect(200);
    expect(total.body).toMatchObject({
      estado: 'liberado',
      liberado: 100000,
      saldoVivo: 0,
    });
    expect(total.body.movimientos.map((m: { tipo: string }) => m.tipo)).toEqual(
      ['alta', 'liberacion', 'liberacion'],
    );
    expect(await asientosAval()).toEqual([]);

    const otra = await api()
      .post(`/avales/${a.id}/liberar`)
      .send({ fecha: '2026-04-02', motivo: 'Otra vez' });
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('BANK_GUARANTEE_NOT_ACTIVE');
    const antes = await alta();
    const fechaMala = await api()
      .post(`/avales/${antes.id}/liberar`)
      .send({ fecha: '2025-12-31', motivo: 'Antes de emitir' });
    expect(fechaMala.status).toBe(422);
    expect(fechaMala.body.errorCode).toBe('BANK_GUARANTEE_DATE_INVALID');
  });

  it('ejecución emitida y recibida con asiento imputado a la obra y notificación', async () => {
    const obra = await createProject(app, token);
    const emitido = await alta({ projectId: obra.id, importe: 50_000 });
    const parcial = await api()
      .post(`/avales/${emitido.id}/ejecutar`)
      .send({
        fecha: '2026-05-15',
        importe: 20_000,
        motivo: 'Incumplimiento de plazos',
      })
      .expect(200);
    expect(parcial.body).toMatchObject({
      estado: 'liberado_parcial',
      ejecutado: 20000,
      saldoVivo: 30000,
    });
    const mov = parcial.body.movimientos.find(
      (m: { tipo: string }) => m.tipo === 'ejecucion',
    );
    expect(mov.asientoId).toEqual(expect.any(String));
    const [a1] = await asientosAval();
    expect(a1.fecha).toBe('2026-05-15');
    expect(a1.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cuenta: '6780',
          debe: 20000,
          projectId: obra.id,
        }),
        expect.objectContaining({ cuenta: '5720', haber: 20000 }),
      ]),
    );
    // El resto se libera: queda «ejecutado» porque hubo ejecución.
    const fin = await api()
      .post(`/avales/${emitido.id}/liberar`)
      .send({ fecha: '2026-06-01', motivo: 'Resto devuelto' })
      .expect(200);
    expect(fin.body).toMatchObject({ estado: 'ejecutado', saldoVivo: 0 });

    const recibido = await alta({
      direccion: 'recibido',
      tipo: 'buena_ejecucion',
      projectId: obra.id,
      importe: 8_000,
    });
    const total = await api()
      .post(`/avales/${recibido.id}/ejecutar`)
      .send({ fecha: '2026-06-10', motivo: 'Subcontrata abandona la obra' })
      .expect(200);
    expect(total.body).toMatchObject({ estado: 'ejecutado', ejecutado: 8000 });
    const asientos = await asientosAval();
    expect(asientos).toHaveLength(2);
    const a2 = asientos.find(
      (x: { fecha: string }) => x.fecha === '2026-06-10',
    );
    expect(a2.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '5720', debe: 8000 }),
        expect.objectContaining({
          cuenta: '7780',
          haber: 8000,
          projectId: obra.id,
        }),
      ]),
    );
    const notifs = await api().get('/alerts/notifications').expect(200);
    const lista = notifs.body.items ?? notifs.body;
    expect(
      lista.filter((x: { title: string; titulo?: string }) =>
        (x.title ?? x.titulo ?? '').includes('ejecutado'),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('comisión calculada (6260/5720), prórroga, vencimiento y anulación', async () => {
    const obra = await createProject(app, token);
    const a = await alta({
      projectId: obra.id,
      tasaComisionAnualPct: 0.75,
      periodicidadComisionMeses: 3,
    });
    const c = await api()
      .post(`/avales/${a.id}/comision`)
      .send({ fecha: '2026-03-31' })
      .expect(200);
    expect(c.body.comisiones).toBe(187.5);
    const [asiento] = await asientosAval();
    expect(asiento.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cuenta: '6260',
          debe: 187.5,
          projectId: obra.id,
        }),
        expect.objectContaining({ cuenta: '5720', haber: 187.5 }),
      ]),
    );
    const recibido = await alta({ direccion: 'recibido' });
    const noAplica = await api()
      .post(`/avales/${recibido.id}/comision`)
      .send({ fecha: '2026-03-31', importe: 10 });
    expect(noAplica.status).toBe(422);
    expect(noAplica.body.errorCode).toBe(
      'BANK_GUARANTEE_COMMISSION_NOT_APPLICABLE',
    );

    const pr = await api()
      .post(`/avales/${a.id}/prorrogar`)
      .send({ fecha: '2026-11-01', nuevaFechaVencimiento: '2027-06-30' })
      .expect(200);
    expect(pr.body.fechaVencimiento).toBe('2027-06-30');
    const atras = await api()
      .post(`/avales/${a.id}/prorrogar`)
      .send({ fecha: '2026-11-02', nuevaFechaVencimiento: '2027-01-01' });
    expect(atras.body.errorCode).toBe('BANK_GUARANTEE_EXTENSION_INVALID');

    const pronto = await api()
      .post(`/avales/${a.id}/vencer`)
      .send({ fecha: '2027-06-29' });
    expect(pronto.status).toBe(409);
    expect(pronto.body.errorCode).toBe('BANK_GUARANTEE_NOT_EXPIRED');
    const vencido = await api()
      .post(`/avales/${a.id}/vencer`)
      .send({ fecha: '2027-06-30' })
      .expect(200);
    expect(vencido.body).toMatchObject({ estado: 'vencido', saldoVivo: 0 });

    // Con movimientos no se anula; uno recién dado de alta, sí.
    const conMov = await api()
      .post(`/avales/${a.id}/anular`)
      .send({ motivo: 'Error' });
    expect(conMov.status).toBe(409);
    const limpio = await alta();
    const comision = await alta({ tasaComisionAnualPct: 1 });
    await api()
      .post(`/avales/${comision.id}/comision`)
      .send({ fecha: '2026-02-01', importe: 10 })
      .expect(200);
    const conComision = await api()
      .post(`/avales/${comision.id}/anular`)
      .send({ motivo: 'Error de alta' });
    expect(conComision.body.errorCode).toBe('BANK_GUARANTEE_HAS_MOVEMENTS');
    const anulado = await api()
      .post(`/avales/${limpio.id}/anular`)
      .send({ motivo: 'Duplicado en el alta' })
      .expect(200);
    expect(anulado.body).toMatchObject({
      estado: 'anulado',
      motivo: 'Duplicado en el alta',
    });
  });

  it('periodo contable cerrado: la ejecución no se aplica', async () => {
    const a = await alta();
    await api().post('/contabilidad/periodos/2026/7/cerrar').expect(200);
    const r = await api()
      .post(`/avales/${a.id}/ejecutar`)
      .send({ fecha: '2026-07-15', motivo: 'Incumplimiento' });
    expect(r.status).toBe(409);
    problema(r);
    expect(r.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const d = await api().get(`/avales/${a.id}`).expect(200);
    expect(d.body).toMatchObject({
      estado: 'vigente',
      saldoVivo: 100000,
      version: 1,
    });
  });

  it('concurrencia (If-Match) e idempotencia (Idempotency-Key)', async () => {
    const a = await alta();
    const vieja = await api()
      .post(`/avales/${a.id}/liberar`)
      .set('If-Match', `"${a.version + 1}"`)
      .send({ fecha: '2026-02-01', importe: 1, motivo: 'Versión vieja' });
    expect(vieja.status).toBe(409);
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const sinIfMatch = await api()
      .patch(`/avales/${a.id}`)
      .send({ notas: 'x' });
    expect(sinIfMatch.status).toBe(428);
    await api()
      .patch(`/avales/${a.id}`)
      .set('If-Match', `"${a.version}"`)
      .send({ notas: 'Depositado en caja fuerte' })
      .expect(200);

    const clave = `clave-${u()}`;
    const cuerpo = { fecha: '2026-02-01', importe: 1000, motivo: 'Parcial' };
    const r1 = await api()
      .post(`/avales/${a.id}/liberar`)
      .set('Idempotency-Key', clave)
      .send(cuerpo)
      .expect(200);
    const r2 = await api()
      .post(`/avales/${a.id}/liberar`)
      .set('Idempotency-Key', clave)
      .send(cuerpo)
      .expect(200);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.saldoVivo).toBe(r1.body.saldoVivo);
    const d = await api().get(`/avales/${a.id}`).expect(200);
    expect(d.body.saldoVivo).toBe(99000);

    // Dos liberaciones simultáneas por el saldo entero: solo una gana.
    const b = await alta({ importe: 500 });
    const [x, y] = await Promise.all([
      api()
        .post(`/avales/${b.id}/liberar`)
        .send({ fecha: '2026-02-02', importe: 500, motivo: 'Uno' }),
      api()
        .post(`/avales/${b.id}/liberar`)
        .send({ fecha: '2026-02-02', importe: 500, motivo: 'Dos' }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });

  it('filtros, resumen de exposición, avisos de vencimiento y acceso por obra', async () => {
    const o1 = await createProject(app, token);
    const o2 = await createProject(app, token);
    await alta({
      projectId: o1.id,
      fechaVencimiento: '2026-12-10',
      importe: 1000,
    });
    await alta({
      projectId: o2.id,
      fechaVencimiento: '2027-06-30',
      importe: 2000,
    });
    await alta({ direccion: 'recibido', fechaVencimiento: null, importe: 300 });

    const proximos = await api()
      .get('/avales?venceEnDias=30&hoy=2026-12-01')
      .expect(200);
    expect(proximos.body).toHaveLength(1);
    expect(proximos.body[0].diasHastaVencimiento).toBe(9);
    const recibidos = await api().get('/avales?direccion=recibido').expect(200);
    expect(recibidos.body).toHaveLength(1);
    const res = await api()
      .get('/avales/resumen?dias=30&hoy=2026-12-01')
      .expect(200);
    expect(res.body).toMatchObject({
      emitidos: { numero: 2, saldoVivo: 3000 },
      recibidos: { numero: 1, saldoVivo: 300 },
      proximosVencer: 1,
      saldoProximosVencer: 1000,
    });
    const av = await api()
      .post('/avales/avisos-vencimiento')
      .send({ dias: 30, hoy: '2026-12-01' })
      .expect(200);
    expect(av.body).toMatchObject({ avisados: 1, revisados: 1 });
    const otra = await api()
      .post('/avales/avisos-vencimiento')
      .send({ dias: 30, hoy: '2026-12-01' })
      .expect(200);
    expect(otra.body.avisados).toBe(0);

    // Jefe de obra: solo ve los avales de su obra (ni otras obras ni sin obra) y no muta.
    const jefe = await createObraUser(app, token, [o1.id]);
    const suyos = await authed(app, jefe.tokens.accessToken)
      .get('/avales')
      .expect(200);
    expect(suyos.body).toHaveLength(1);
    expect(suyos.body[0].projectId).toBe(o1.id);
    const ajeno = (await api().get(`/avales?projectId=${o2.id}`).expect(200))
      .body[0];
    const oculto = await authed(app, jefe.tokens.accessToken).get(
      `/avales/${ajeno.id}`,
    );
    expect(oculto.status).toBe(404);
    expect(oculto.body.errorCode).toBe('BANK_GUARANTEE_NOT_FOUND');
    await authed(app, jefe.tokens.accessToken)
      .post(`/avales/${suyos.body[0].id}/liberar`)
      .send({ fecha: '2026-12-01', motivo: 'No puedo' })
      .expect(403);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken).get('/avales/resumen').expect(200);
    await authed(app, lector.accessToken).post('/avales').send({}).expect(403);
  });

  it('cadena de auditoría íntegra', async () => {
    const a = await alta();
    await api()
      .post(`/avales/${a.id}/liberar`)
      .send({ fecha: '2026-02-01', importe: 10, motivo: 'Parcial' })
      .expect(200);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
    const audit = await api()
      .get('/audit?entityType=bank_guarantee')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBeGreaterThanOrEqual(2);
  });
});
