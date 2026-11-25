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
 * Cierre y apertura del ejercicio PGC (regularización 6/7 contra 129, cierre
 * de balance y apertura), bloqueo de asientos en un ejercicio cerrado,
 * reversión controlada; estimación al cierre (EAC) editable reflejada en el
 * cuadro de márgenes y en la provisión por pérdidas; coste de avales en el
 * coste real; líneas de avales por entidad y ejecución financiada; RFC 7807
 * y cadena de auditoría.
 */
describe('Cierre de ejercicio, EAC y líneas de avales (integración)', () => {
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

  const problema = (r: {
    status: number;
    headers: Record<string, string>;
    body: { errorCode?: string };
  }) => {
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.headers['x-request-id']).toEqual(expect.any(String));
  };

  type Linea = {
    cuenta: string;
    debe?: number;
    haber?: number;
    projectId?: string;
  };
  const asiento = (fecha: string, lineas: Linea[]) =>
    api()
      .post('/contabilidad/asientos')
      .send({ fecha, concepto: `Prueba ${fecha}`, lineas });

  const saldos = async (desde: string, hasta: string) => {
    const r = await api()
      .get(`/contabilidad/sumas-saldos?desde=${desde}&hasta=${hasta}`)
      .expect(200);
    return new Map<string, number>(
      r.body.filas.map((f: { codigo: string; debe: number; haber: number }) => [
        f.codigo,
        Math.round((f.debe - f.haber) * 100) / 100,
      ]),
    );
  };

  /** Ejercicio 2024: capital, venta de obra, compra y una comisión. */
  async function libro2024(obra: string) {
    await asiento('2024-01-10', [
      { cuenta: '5720', debe: 10_000 },
      { cuenta: '1000', haber: 10_000 },
    ]).expect(201);
    await asiento('2024-06-30', [
      { cuenta: '4300', debe: 12_100 },
      { cuenta: '7050', haber: 10_000, projectId: obra },
      { cuenta: '4770', haber: 2_100 },
    ]).expect(201);
    await asiento('2024-07-15', [
      { cuenta: '6000', debe: 5_000, projectId: obra },
      { cuenta: '4720', debe: 1_050 },
      { cuenta: '4000', haber: 6_050 },
    ]).expect(201);
    await asiento('2024-12-31', [
      { cuenta: '6260', debe: 0.01, projectId: obra },
      { cuenta: '5720', haber: 0.01 },
    ]).expect(201);
  }

  it('regularización, cierre y apertura PGC cuadrados al céntimo y bloqueo del ejercicio', async () => {
    const obra = (await createProject(app, token)).id as string;
    await libro2024(obra);

    const prop = await api()
      .get('/contabilidad/ejercicios/2024/cierre')
      .expect(200);
    expect(prop.body).toMatchObject({
      ejercicio: 2024,
      ingresos: 10000,
      gastos: 5000.01,
      resultado: 4999.99,
      impedimentos: [],
      cierreVigente: null,
    });
    expect(prop.body.regularizacion.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cuenta: '1290',
          haber: '4999.99',
          nombreCuenta: 'Resultado del ejercicio',
        }),
      ]),
    );

    const c = await api()
      .post('/contabilidad/ejercicios/2024/cerrar')
      .expect(200);
    expect(c.body).toMatchObject({
      ejercicio: 2024,
      estado: 'cerrado',
      resultado: 4999.99,
      mesesCerrados: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      version: 1,
    });
    expect(c.body.asientoRegularizacionId).toEqual(expect.any(String));
    expect(c.body.asientoAperturaId).toEqual(expect.any(String));

    // 2024 queda a cero (todas las cuentas, por cuenta y obra).
    const s2024 = await saldos('2024-01-01', '2024-12-31');
    for (const [cuenta, saldo] of s2024) {
      expect([cuenta, saldo]).toEqual([cuenta, 0]);
    }
    // La apertura de 2025 trae exactamente el balance de cierre.
    const ap = await api()
      .get(`/contabilidad/asientos/${c.body.asientoAperturaId}`)
      .expect(200);
    expect(ap.body.fecha).toBe('2025-01-01');
    const s2025 = await saldos('2025-01-01', '2025-12-31');
    expect(Object.fromEntries(s2025)).toEqual({
      '1000': -10000,
      '1290': -4999.99,
      '4000': -6050,
      '4300': 12100,
      '4720': 1050,
      '4770': -2100,
      '5720': 9999.99,
    });

    // Ejercicio cerrado: ni asientos, ni reabrir un mes, ni cerrar otra vez.
    const tarde = await asiento('2024-05-05', [
      { cuenta: '5720', debe: 1 },
      { cuenta: '1000', haber: 1 },
    ]);
    expect(tarde.status).toBe(409);
    problema(tarde);
    expect(tarde.body.errorCode).toBe('FISCAL_YEAR_CLOSED');
    const reabrir = await api().post('/contabilidad/periodos/2024/5/reabrir');
    expect(reabrir.body.errorCode).toBe('FISCAL_YEAR_CLOSED');
    const otra = await api().post('/contabilidad/ejercicios/2024/cerrar');
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('FISCAL_YEAR_ALREADY_CLOSED');
    const encurso = await api().post('/contabilidad/ejercicios/2026/cerrar');
    expect(encurso.body.errorCode).toBe('FISCAL_YEAR_NOT_ENDED');
    // 2025 sí admite asientos.
    await asiento('2025-02-01', [
      { cuenta: '5720', debe: 1 },
      { cuenta: '1000', haber: 1 },
    ]).expect(201);
  });

  it('el cierre ignora el mes de diciembre ya cerrado; ejercicio anterior abierto', async () => {
    await asiento('2023-03-01', [
      { cuenta: '5720', debe: 100 },
      { cuenta: '1000', haber: 100 },
    ]).expect(201);
    await asiento('2024-03-01', [
      { cuenta: '5720', debe: 50 },
      { cuenta: '7050', haber: 50 },
    ]).expect(201);
    const antes = await api().post('/contabilidad/ejercicios/2024/cerrar');
    expect(antes.status).toBe(409);
    expect(antes.body.errorCode).toBe('FISCAL_YEAR_PREVIOUS_OPEN');
    const prop = await api()
      .get('/contabilidad/ejercicios/2024/cierre')
      .expect(200);
    expect(prop.body.impedimentos.map((i: { code: string }) => i.code)).toEqual(
      ['FISCAL_YEAR_PREVIOUS_OPEN'],
    );
    await api().post('/contabilidad/ejercicios/2023/cerrar').expect(200);
    await api().post('/contabilidad/periodos/2024/12/cerrar').expect(200);
    const c = await api()
      .post('/contabilidad/ejercicios/2024/cerrar')
      .expect(200);
    // Diciembre ya estaba cerrado: no es de este cierre.
    expect(c.body.mesesCerrados).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(c.body.resultado).toBe(50);
  });

  it('reversión: solo el último, If-Match, contra-asientos y nuevo cierre idéntico', async () => {
    const obra = (await createProject(app, token)).id as string;
    await libro2024(obra);
    const c24 = (
      await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200)
    ).body;
    const c25 = (
      await api().post('/contabilidad/ejercicios/2025/cerrar').expect(200)
    ).body;
    expect(c25.resultado).toBe(0);

    const noUltimo = await api()
      .post('/contabilidad/ejercicios/2024/revertir')
      .send({ motivo: 'Ajuste de auditoría' });
    expect(noUltimo.status).toBe(409);
    expect(noUltimo.body.errorCode).toBe('FISCAL_YEAR_NOT_LATEST');
    const sinMotivo = await api()
      .post('/contabilidad/ejercicios/2025/revertir')
      .send({});
    expect(sinMotivo.status).toBe(400);
    const vieja = await api()
      .post('/contabilidad/ejercicios/2025/revertir')
      .set('If-Match', `"${c25.version + 1}"`)
      .send({ motivo: 'Ajuste de auditoría' });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    await api()
      .post('/contabilidad/ejercicios/2025/revertir')
      .set('If-Match', `"${c25.version}"`)
      .send({ motivo: 'Ajuste de auditoría' })
      .expect(200);
    const r24 = await api()
      .post('/contabilidad/ejercicios/2024/revertir')
      .set('If-Match', `"${c24.version}"`)
      .send({ motivo: 'Ajuste de auditoría' })
      .expect(200);
    expect(r24.body).toMatchObject({
      estado: 'revertido',
      motivoReversion: 'Ajuste de auditoría',
    });
    const yaNo = await api()
      .post('/contabilidad/ejercicios/2024/revertir')
      .send({ motivo: 'Otra vez' });
    expect(yaNo.body.errorCode).toBe('FISCAL_YEAR_NOT_CLOSED');

    // Los asientos de cierre quedan anulados por contra-asiento; 2024 vuelve
    // a tener sus saldos y admite asientos y meses abiertos.
    const reg = await api()
      .get(`/contabilidad/asientos/${c24.asientoRegularizacionId}`)
      .expect(200);
    expect(reg.body.estado).toBe('anulado');
    const s = await saldos('2024-01-01', '2024-12-31');
    expect(s.get('7050')).toBe(-10000);
    expect(s.get('1290') ?? 0).toBe(0);
    await asiento('2024-12-30', [
      { cuenta: '6000', debe: 100, projectId: obra },
      { cuenta: '4000', haber: 100 },
    ]).expect(201);
    const de_nuevo = await api()
      .post('/contabilidad/ejercicios/2024/cerrar')
      .expect(200);
    expect(de_nuevo.body.resultado).toBe(4899.99);
    const lista = await api().get('/contabilidad/ejercicios').expect(200);
    expect(
      lista.body
        .filter((x: { ejercicio: number }) => x.ejercicio === 2024)
        .map((x: { estado: string }) => x.estado),
    ).toEqual(['revertido', 'cerrado']);

    // Segregación: administración y lector no cierran ni revierten.
    const adm = await createUserWithRole(app, token, 'administracion');
    await authed(app, adm.accessToken)
      .post('/contabilidad/ejercicios/2025/cerrar')
      .expect(403);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get('/contabilidad/ejercicios/2025/cierre')
      .expect(200);
  });

  it('EAC editable: margen, provisión por pérdidas, coste de avales, historial y acceso', async () => {
    const o = await createProject(app, token, {
      code: `OB-${u()}`,
      contractAmount: 100_000,
    });
    const b = await createBudget(app, token, o.id);
    await addBudgetItem(app, token, b.id, { unitPrice: 10, quantity: 9_000 });
    await activateBudget(app, token, b.id);
    // Coste real por avales: comisión 1.000 imputada a la obra.
    const aval = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'garantia_definitiva',
          direccion: 'emitido',
          entidad: 'Banco EAC',
          importe: 50_000,
          fechaEmision: '2026-01-10',
          projectId: o.id,
        })
        .expect(201)
    ).body;
    await api()
      .post(`/avales/${aval.id}/comision`)
      .send({ fecha: '2026-02-01', importe: 1_000 })
      .expect(200);

    const ini = await api()
      .get(`/projects/${o.id}/estimacion-cierre`)
      .expect(200);
    expect(ini.body).toMatchObject({
      costeReal: 1000,
      costeEstimadoCierreAutomatico: 90000,
      costeEstimadoCierre: 90000,
      origen: 'automatica',
      version: 0,
      vigente: null,
    });
    const m0 = await api().get(`/projects/${o.id}/margenes`).expect(200);
    expect(m0.body.obra.costeRealDesglose.avales).toBe(1000);

    const bajo = await api()
      .post(`/projects/${o.id}/estimacion-cierre`)
      .send({ costeEstimado: 999.99, motivo: 'Demasiado optimista' });
    expect(bajo.status).toBe(422);
    problema(bajo);
    expect(bajo.body.errorCode).toBe('EAC_BELOW_ACTUAL_COST');

    // Primera versión: no hay versión previa, así que no se envía If-Match.
    const v1 = await api()
      .post(`/projects/${o.id}/estimacion-cierre`)
      .set('Idempotency-Key', `eac-${u()}`)
      .send({
        costeEstimado: 120_000,
        motivo: 'Revisión de mediciones',
        fecha: '2026-03-01',
      })
      .expect(200);
    expect(v1.body).toMatchObject({
      costeEstimadoCierre: 120000,
      origen: 'manual',
      margenProyectado: -20000,
      version: 1,
      vigente: { version: 1, costeEstimado: 120000, fecha: '2026-03-01' },
    });
    const m1 = await api().get(`/projects/${o.id}/margenes`).expect(200);
    expect(m1.body.obra).toMatchObject({
      costeEstimadoCierre: 120000,
      origenEstimacion: 'manual',
    });
    // La provisión por pérdidas usa la EAC vigente al cierre del periodo.
    const prov = await api()
      .get(`/provision-perdidas/propuesta?periodo=2026-03&projectId=${o.id}`)
      .expect(200);
    expect(prov.body[0]).toMatchObject({
      costeEstimadoCierre: 120000,
      perdidaTotal: 20000,
    });
    const febrero = await api()
      .get(`/provision-perdidas/propuesta?periodo=2026-02&projectId=${o.id}`)
      .expect(200);
    expect(febrero.body[0]).toMatchObject({
      costeEstimadoCierre: 90000,
      perdidaTotal: 0,
    });

    const vieja = await api()
      .post(`/projects/${o.id}/estimacion-cierre`)
      .set('If-Match', '"2"')
      .send({ costeEstimado: 110_000, motivo: 'Versión vieja' });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const atras = await api().post(`/projects/${o.id}/estimacion-cierre`).send({
      costeEstimado: 110_000,
      motivo: 'Fecha atrás',
      fecha: '2026-02-01',
    });
    expect(atras.body.errorCode).toBe('EAC_DATE_OUT_OF_ORDER');

    // El jefe de obra fija la de su obra; otra obra no la ve.
    const jefe = await createObraUser(app, token, [o.id]);
    const v2 = await authed(app, jefe.tokens.accessToken)
      .post(`/projects/${o.id}/estimacion-cierre`)
      .set('If-Match', '"1"')
      .send({
        costeEstimado: null,
        motivo: 'Volver al cálculo automático',
        fecha: '2026-04-01',
      })
      .expect(200);
    expect(v2.body).toMatchObject({
      origen: 'automatica',
      costeEstimadoCierre: 90000,
      version: 2,
    });
    expect(
      v2.body.historial.map((h: { version: number }) => h.version),
    ).toEqual([2, 1]);
    const otra = (await createProject(app, token)).id as string;
    const ajena = await authed(app, jefe.tokens.accessToken).get(
      `/projects/${otra}/estimacion-cierre`,
    );
    expect(ajena.status).toBe(404);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .post(`/projects/${o.id}/estimacion-cierre`)
      .send({ costeEstimado: 1, motivo: 'No puedo' })
      .expect(403);

    const audit = await api()
      .get('/audit?entityType=project_cost_estimate')
      .expect(200);
    const items = audit.body.items ?? audit.body;
    expect(items.length).toBe(2);
  });

  it('líneas de avales por entidad: límite, edición con If-Match y ejecución financiada', async () => {
    const l = await api()
      .post('/avales/lineas')
      .send({ entidad: 'Banco Línea', limite: 1_000 })
      .expect(201);
    expect(l.body).toMatchObject({
      limite: 1000,
      dispuesto: 0,
      disponible: 1000,
    });
    const dup = await api()
      .post('/avales/lineas')
      .send({ entidad: 'banco línea', limite: 5 });
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('BANK_GUARANTEE_LINE_DUPLICATE');

    const alta = (importe: number, direccion = 'emitido') =>
      api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'anticipo',
          direccion,
          entidad: 'Banco Línea',
          importe,
          fechaEmision: '2026-03-01',
        });
    const a1 = (await alta(600).expect(201)).body;
    const excede = await alta(400.01);
    expect(excede.status).toBe(409);
    problema(excede);
    expect(excede.body.errorCode).toBe('BANK_GUARANTEE_LIMIT_EXCEEDED');
    // Los recibidos no consumen nuestra línea.
    const recibido = (await alta(5_000, 'recibido').expect(201)).body;
    await alta(400).expect(201);
    const lista = await api().get('/avales/lineas').expect(200);
    expect(lista.body[0]).toMatchObject({
      dispuesto: 1000,
      disponible: 0,
      usoPct: 100,
    });

    const sinIfMatch = await api()
      .patch(`/avales/lineas/${l.body.id}`)
      .send({ limite: 2_000 });
    expect(sinIfMatch.status).toBe(428);
    const amp = await api()
      .patch(`/avales/lineas/${l.body.id}`)
      .set('If-Match', `"${l.body.version}"`)
      .send({ limite: 2_000 })
      .expect(200);
    expect(amp.body).toMatchObject({
      limite: 2000,
      disponible: 1000,
      version: 2,
    });
    await api()
      .patch(`/avales/lineas/${l.body.id}`)
      .set('If-Match', '"2"')
      .send({ activa: false })
      .expect(200);
    const inactiva = await alta(1);
    expect(inactiva.body.errorCode).toBe('BANK_GUARANTEE_LIMIT_EXCEEDED');

    // Ejecución financiada: 6780 a 5200; un recibido no se financia.
    const ej = await api()
      .post(`/avales/${a1.id}/ejecutar`)
      .send({
        fecha: '2026-04-01',
        motivo: 'Incumplimiento',
        liquidacion: 'financiacion',
      })
      .expect(200);
    const mov = ej.body.movimientos.find(
      (m: { tipo: string }) => m.tipo === 'ejecucion',
    );
    expect(mov.financiada).toBe(true);
    const as = await api()
      .get(`/contabilidad/asientos/${mov.asientoId}`)
      .expect(200);
    expect(as.body.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '6780', debe: 600 }),
        expect.objectContaining({ cuenta: '5200', haber: 600 }),
      ]),
    );
    const noFin = await api().post(`/avales/${recibido.id}/ejecutar`).send({
      fecha: '2026-04-01',
      motivo: 'Incumplimiento',
      liquidacion: 'financiacion',
    });
    expect(noFin.status).toBe(422);
    expect(noFin.body.errorCode).toBe(
      'BANK_GUARANTEE_FINANCING_NOT_APPLICABLE',
    );

    // Rastro antes/después en la auditoría de la línea.
    const audit = await api()
      .get('/audit?entityType=bank_guarantee_line')
      .expect(200);
    const items = (audit.body.items ?? audit.body) as {
      action: string;
      newData: {
        cambios?: { campo: string; antes: unknown; despues: unknown }[];
      };
    }[];
    const cambios = items.flatMap((i) => i.newData?.cambios ?? []);
    expect(cambios).toEqual(
      expect.arrayContaining([
        { campo: 'limitAmount', antes: '1000.00', despues: '2000.00' },
        { campo: 'isActive', antes: true, despues: false },
      ]),
    );
  });

  it('cerrar el ejercicio no borra la amortización imputada a la obra en el cuadro', async () => {
    const obra = (await createProject(app, token)).id as string;
    await asiento('2024-06-30', [
      { cuenta: '6810', debe: 300, projectId: obra },
      { cuenta: '2813', haber: 300 },
    ]).expect(201);
    const antes = await api().get(`/projects/${obra}/margenes`).expect(200);
    expect(antes.body.obra.costeRealDesglose.amortizacion).toBe(300);
    await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200);
    const despues = await api().get(`/projects/${obra}/margenes`).expect(200);
    expect(despues.body.obra.costeRealDesglose.amortizacion).toBe(300);
    expect(despues.body.obra.costeReal).toBe(300);
  });

  it('cadena de auditoría íntegra tras cierre y reversión', async () => {
    await asiento('2024-02-01', [
      { cuenta: '5720', debe: 10 },
      { cuenta: '7050', haber: 10 },
    ]).expect(201);
    const c = (
      await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200)
    ).body;
    await api()
      .post('/contabilidad/ejercicios/2024/revertir')
      .set('If-Match', `"${c.version}"`)
      .send({ motivo: 'Prueba de reversión' })
      .expect(200);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
    const audit = await api()
      .get('/audit?entityType=fiscal_year_closing')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBe(2);
  });
});
