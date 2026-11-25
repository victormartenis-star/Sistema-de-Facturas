import { INestApplication } from '@nestjs/common';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Aplicación del resultado (129) y cuentas anuales; EAC y coste de avales en
 * la economía de obra y el EVM; devengo mensual de comisiones de aval sin
 * duplicar ni chocar con períodos cerrados; RFC 7807 y cadena de auditoría.
 */
describe('Aplicación del resultado, cuentas anuales, EVM y devengos (integración)', () => {
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
  const problema = (r: { headers: Record<string, string> }) => {
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

  const saldo = async (cuenta: string, desde: string, hasta: string) => {
    const r = await api()
      .get(`/contabilidad/sumas-saldos?desde=${desde}&hasta=${hasta}`)
      .expect(200);
    const f = r.body.filas.find((x: { codigo: string }) => x.codigo === cuenta);
    return f ? Math.round((f.debe - f.haber) * 100) / 100 : 0;
  };

  /** 2024 con beneficio 4.999,99 y capital 10.000. */
  async function libroConBeneficio() {
    await asiento('2024-01-10', [
      { cuenta: '5720', debe: 10_000 },
      { cuenta: '1000', haber: 10_000 },
    ]).expect(201);
    await asiento('2024-06-30', [
      { cuenta: '4300', debe: 12_100 },
      { cuenta: '7050', haber: 10_000 },
      { cuenta: '4770', haber: 2_100 },
    ]).expect(201);
    await asiento('2024-07-15', [
      { cuenta: '6000', debe: 5_000 },
      { cuenta: '4720', debe: 1_050 },
      { cuenta: '4000', haber: 6_050 },
    ]).expect(201);
    await asiento('2024-12-31', [
      { cuenta: '6260', debe: 0.01 },
      { cuenta: '5720', haber: 0.01 },
    ]).expect(201);
  }

  it('aplicación del beneficio: reserva legal, reglas, asiento, bloqueo del cierre y anulación', async () => {
    await libroConBeneficio();
    const sinCerrar = await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-06-30',
        acuerdo: 'Junta 2025',
        reparto: [{ cuenta: '1120', importe: 1 }],
      });
    expect(sinCerrar.status).toBe(409);
    expect(sinCerrar.body.errorCode).toBe('FISCAL_YEAR_NOT_CLOSED');
    const c24 = (
      await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200)
    ).body;

    const prop = await api()
      .get('/contabilidad/ejercicios/2024/aplicacion-resultado')
      .expect(200);
    expect(prop.body).toMatchObject({
      resultado: 4999.99,
      cerrado: true,
      capital: 10000,
      reservaLegal: 0,
      reservaLegalMinima: 500,
      aplicacionVigente: null,
    });
    expect(
      prop.body.destinos.map((d: { cuenta: string }) => d.cuenta),
    ).toContain('5260');

    const aplicar = (
      reparto: { cuenta: string; importe: number }[],
      fecha = '2025-06-30',
    ) =>
      api().post('/contabilidad/ejercicios/2024/aplicar-resultado').send({
        fecha,
        acuerdo: 'Acta de la junta general de 30-06-2025',
        reparto,
      });
    const poca = await aplicar([
      { cuenta: '1120', importe: 400 },
      { cuenta: '1130', importe: 4599.99 },
    ]);
    expect(poca.status).toBe(422);
    problema(poca);
    expect(poca.body.errorCode).toBe('RESULT_APPLICATION_LEGAL_RESERVE');
    const descuadre = await aplicar([{ cuenta: '1120', importe: 500 }]);
    expect(descuadre.body.errorCode).toBe('RESULT_APPLICATION_UNBALANCED');
    const fecha = await aplicar(
      [{ cuenta: '1120', importe: 4999.99 }],
      '2024-12-31',
    );
    expect(fecha.body.errorCode).toBe('RESULT_APPLICATION_DATE_INVALID');

    const ok = await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .set('Idempotency-Key', `apl-${u()}`)
      .send({
        fecha: '2025-06-30',
        acuerdo: 'Acta de la junta general de 30-06-2025',
        reparto: [
          { cuenta: '1120', importe: 500 },
          { cuenta: '1130', importe: 2499.99 },
          { cuenta: '5260', importe: 2000 },
        ],
      })
      .expect(200);
    expect(ok.body).toMatchObject({
      ejercicio: 2024,
      estado: 'aplicado',
      resultado: 4999.99,
      version: 1,
    });
    const as = await api()
      .get(`/contabilidad/asientos/${ok.body.asientoId}`)
      .expect(200);
    expect(as.body).toMatchObject({
      fecha: '2025-06-30',
      origen: 'aplicacion_resultado',
    });
    expect(as.body.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '1290', debe: 4999.99 }),
        expect.objectContaining({ cuenta: '1120', haber: 500 }),
        expect.objectContaining({ cuenta: '5260', haber: 2000 }),
      ]),
    );
    expect(await saldo('1290', '2025-01-01', '2025-12-31')).toBe(0);
    expect(await saldo('1120', '2025-01-01', '2025-12-31')).toBe(-500);

    const otra = await aplicar([{ cuenta: '1120', importe: 4999.99 }]);
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('RESULT_ALREADY_APPLIED');
    const revertir = await api()
      .post('/contabilidad/ejercicios/2024/revertir')
      .send({ motivo: 'Ajuste' });
    expect(revertir.body.errorCode).toBe('FISCAL_YEAR_RESULT_APPLIED');

    const vieja = await api()
      .post('/contabilidad/ejercicios/2024/aplicacion-resultado/anular')
      .set('If-Match', '"2"')
      .send({ motivo: 'Acuerdo rectificado' });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const anulada = await api()
      .post('/contabilidad/ejercicios/2024/aplicacion-resultado/anular')
      .set('If-Match', '"1"')
      .send({ motivo: 'Acuerdo rectificado' })
      .expect(200);
    expect(anulada.body).toMatchObject({
      estado: 'anulado',
      motivoAnulacion: 'Acuerdo rectificado',
    });
    expect(await saldo('1290', '2025-01-01', '2025-12-31')).toBe(-4999.99);
    await api()
      .post('/contabilidad/ejercicios/2024/revertir')
      .set('If-Match', `"${c24.version}"`)
      .send({ motivo: 'Ahora sí' })
      .expect(200);

    // Segregación: administración no aplica el resultado.
    const adm = await createUserWithRole(app, token, 'administracion');
    await authed(app, adm.accessToken)
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-06-30',
        acuerdo: 'Junta',
        reparto: [{ cuenta: '1120', importe: 1 }],
      })
      .expect(403);
  });

  it('pérdida: a resultados negativos y compensación con reservas, y dividendos bloqueados después', async () => {
    await asiento('2023-01-10', [
      { cuenta: '5720', debe: 1_000 },
      { cuenta: '1130', haber: 1_000 },
    ]).expect(201);
    await asiento('2023-05-10', [
      { cuenta: '6000', debe: 1_500 },
      { cuenta: '5720', haber: 1_500 },
    ]).expect(201);
    await api().post('/contabilidad/ejercicios/2023/cerrar').expect(200);
    const exceso = await api()
      .post('/contabilidad/ejercicios/2023/aplicar-resultado')
      .send({
        fecha: '2024-05-01',
        acuerdo: 'Junta 2024',
        reparto: [{ cuenta: '1130', importe: 1_500 }],
      });
    expect(exceso.body.errorCode).toBe(
      'RESULT_APPLICATION_RESERVES_INSUFFICIENT',
    );
    await api()
      .post('/contabilidad/ejercicios/2023/aplicar-resultado')
      .send({
        fecha: '2024-05-01',
        acuerdo: 'Junta 2024',
        reparto: [
          { cuenta: '1130', importe: 1_000 },
          { cuenta: '1210', importe: 500 },
        ],
      })
      .expect(200);
    // 2024: beneficio de 800 con 500 de pérdidas pendientes.
    await asiento('2024-03-01', [
      { cuenta: '5720', debe: 800 },
      { cuenta: '7050', haber: 800 },
    ]).expect(201);
    await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200);
    const prop = await api()
      .get('/contabilidad/ejercicios/2024/aplicacion-resultado')
      .expect(200);
    expect(prop.body).toMatchObject({
      resultado: 800,
      negativosAnteriores: 500,
      reservasVoluntarias: 0,
    });
    const dividendo = await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-04-01',
        acuerdo: 'Junta 2025',
        reparto: [
          { cuenta: '1120', importe: 80 },
          { cuenta: '5260', importe: 720 },
        ],
      });
    expect(dividendo.body.errorCode).toBe(
      'RESULT_APPLICATION_DIVIDEND_BLOCKED',
    );
    await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-04-01',
        acuerdo: 'Junta 2025',
        reparto: [
          { cuenta: '1120', importe: 80 },
          { cuenta: '1210', importe: 500 },
          { cuenta: '5260', importe: 220 },
        ],
      })
      .expect(200);
  });

  it('cuentas anuales: balance cuadrado y PyG, iguales antes y después del cierre', async () => {
    await libroConBeneficio();
    const antes = await api()
      .get('/contabilidad/ejercicios/2024/cuentas-anuales')
      .expect(200);
    expect(antes.body).toMatchObject({
      ejercicio: 2024,
      cerrado: false,
      aplicacion: null,
    });
    expect(antes.body.pyg).toMatchObject({
      resultado: 4999.99,
      resultadoExplotacion: 4999.99,
    });
    expect(antes.body.balance).toMatchObject({
      totalActivo: 23149.99,
      totalPatrimonioNetoYPasivo: 23149.99,
      resultadoEjercicio: 4999.99,
      cuadra: true,
      patrimonioNeto: { total: 14999.99 },
      pasivoCorriente: { total: 8150 },
    });
    await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200);
    const despues = await api()
      .get('/contabilidad/ejercicios/2024/cuentas-anuales')
      .expect(200);
    expect(despues.body.cerrado).toBe(true);
    expect(despues.body.balance).toEqual(antes.body.balance);
    expect(despues.body.pyg).toEqual(antes.body.pyg);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get('/contabilidad/ejercicios/2024/cuentas-anuales')
      .expect(200);
  });

  it('EAC manual y coste de avales en la economía de obra y el EVM', async () => {
    const o = await createProject(app, token, {
      code: `OB-${u()}`,
      contractAmount: 100_000,
    });
    const b = await createBudget(app, token, o.id);
    await addBudgetItem(app, token, b.id, { unitPrice: 10, quantity: 9_000 });
    await activateBudget(app, token, b.id);
    await api()
      .post('/certifications')
      .send({ projectId: o.id, certDate: '2026-02-20', cumulativePct: 10 })
      .expect(201);
    const aval = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'garantia_definitiva',
          direccion: 'emitido',
          entidad: 'Banco EVM',
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

    const evm0 = await api().get(`/projects/${o.id}/cost-control`).expect(200);
    expect(evm0.body.acBreakdown.avales).toBe(1000);
    expect(evm0.body).toMatchObject({ ac: 1000, origenEac: 'automatica' });
    expect(evm0.body.eac).toBe(evm0.body.eacCalculada);
    const eco0 = await api().get(`/projects/${o.id}/economics`).expect(200);
    expect(eco0.body.margen.costes.avales).toBe(1000);
    expect(eco0.body.margen.costeReal).toBe(1000);
    expect(eco0.body.estimacionCierre).toMatchObject({
      origen: 'automatica',
      efectiva: 90000,
    });
    const sinPartida = eco0.body.desviaciones.find(
      (d: { phaseId: string | null }) => d.phaseId === null,
    );
    expect(sinPartida.costes.avales).toBe(1000);
    const mes = evm0.body.curvaS.find(
      (p: { period: string }) => p.period === '2026-02',
    );
    expect(mes.actualCumulative).toBe(1000);

    await api()
      .post(`/projects/${o.id}/estimacion-cierre`)
      .send({ costeEstimado: 120_000, motivo: 'Revisión', fecha: '2026-03-01' })
      .expect(200);
    const evm1 = await api().get(`/projects/${o.id}/cost-control`).expect(200);
    expect(evm1.body).toMatchObject({
      eac: 120000,
      origenEac: 'manual',
      varianceAtCompletion: -30000,
      etc: 119000,
    });
    expect(evm1.body.eacCalculada).not.toBe(120000);
    const eco1 = await api().get(`/projects/${o.id}/economics`).expect(200);
    expect(eco1.body.estimacionCierre).toMatchObject({
      origen: 'manual',
      efectiva: 120000,
      automatica: 90000,
      margenProyectado: -20000,
    });
  });

  it('devengo mensual de comisiones: sin duplicar, liquidación contra devengo, período cerrado y anulación', async () => {
    const obra = (await createProject(app, token)).id as string;
    const alta = (extra: Record<string, unknown> = {}) =>
      api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'buena_ejecucion',
          direccion: 'emitido',
          entidad: 'Banco Devengo',
          importe: 100_000,
          fechaEmision: '2026-01-10',
          projectId: obra,
          tasaComisionAnualPct: 0.75,
          periodicidadComisionMeses: 3,
          ...extra,
        })
        .expect(201);
    const a = (await alta()).body;
    await alta({ direccion: 'recibido', tasaComisionAnualPct: null });

    const ene = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-01' })
      .expect(200);
    // 100.000 × 0,75 % × 22 / 365 = 45,205… → 45,21
    expect(ene.body).toMatchObject({
      periodo: '2026-01',
      contabilizados: 1,
      importe: 45.21,
      omitidos: [],
    });
    const otra = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-01' })
      .expect(200);
    expect(otra.body).toMatchObject({ contabilizados: 0 });
    expect(otra.body.omitidos).toHaveLength(1);
    const uno = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-01', avalId: a.id });
    expect(uno.status).toBe(409);
    problema(uno);
    expect(uno.body.errorCode).toBe('BANK_GUARANTEE_ACCRUAL_ALREADY_POSTED');
    const feb = await api()
      .post('/avales/devengos')
      .set('Idempotency-Key', `dev-${u()}`)
      .send({ periodo: '2026-02', avalId: a.id })
      .expect(200);
    expect(feb.body).toMatchObject({
      periodo: '2026-02',
      dias: 28,
      importe: 57.53,
      estado: 'contabilizado',
    });
    const asDev = await api()
      .get(`/contabilidad/asientos/${feb.body.asientoId}`)
      .expect(200);
    expect(asDev.body.fecha).toBe('2026-02-28');
    expect(asDev.body.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cuenta: '6260',
          debe: 57.53,
          projectId: obra,
        }),
        expect.objectContaining({ cuenta: '4100', haber: 57.53 }),
      ]),
    );

    // Liquidación trimestral del banco: salda los 102,74 devengados; el resto es gasto.
    const liq = await api()
      .post(`/avales/${a.id}/comision`)
      .send({ fecha: '2026-03-31' })
      .expect(200);
    expect(liq.body).toMatchObject({
      comisiones: 187.5,
      comisionDevengada: 102.74,
      devengoLiquidado: 102.74,
    });
    const mov = liq.body.movimientos.find(
      (m: { tipo: string }) => m.tipo === 'comision',
    );
    const asLiq = await api()
      .get(`/contabilidad/asientos/${mov.asientoId}`)
      .expect(200);
    expect(asLiq.body.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '4100', debe: 102.74 }),
        expect.objectContaining({ cuenta: '6260', debe: 84.76 }),
        expect.objectContaining({ cuenta: '5720', haber: 187.5 }),
      ]),
    );
    // El coste de la obra es exactamente la comisión: sin duplicar.
    const m = await api().get(`/projects/${obra}/margenes`).expect(200);
    expect(m.body.obra.costeRealDesglose.avales).toBe(187.5);
    expect(await saldo('4100', '2026-01-01', '2026-12-31')).toBe(0);

    const [devEne] = (
      await api()
        .get(`/avales/devengos?periodo=2026-01&avalId=${a.id}`)
        .expect(200)
    ).body;
    const noAnula = await api()
      .post(`/avales/devengos/${devEne.id}/anular`)
      .send({ motivo: 'Error de tasa' });
    expect(noAnula.status).toBe(409);
    expect(noAnula.body.errorCode).toBe('BANK_GUARANTEE_ACCRUAL_SETTLED');

    // Período cerrado: el devengo de marzo se rechaza sin grabar nada.
    await api().post('/contabilidad/periodos/2026/3/cerrar').expect(200);
    const marzo = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-03', avalId: a.id });
    expect(marzo.status).toBe(409);
    expect(marzo.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const masivo = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-03' })
      .expect(200);
    expect(masivo.body.contabilizados).toBe(0);

    // Anulación de un devengo no liquidado (If-Match), y recibido no devenga.
    const b = (await alta({ fechaEmision: '2026-04-01' })).body;
    const abr = (
      await api()
        .post('/avales/devengos')
        .send({ periodo: '2026-04', avalId: b.id })
        .expect(200)
    ).body;
    const anulado = await api()
      .post(`/avales/devengos/${abr.id}/anular`)
      .set('If-Match', `"${abr.version}"`)
      .send({ motivo: 'Tasa errónea' })
      .expect(200);
    expect(anulado.body).toMatchObject({
      estado: 'anulado',
      motivoAnulacion: 'Tasa errónea',
    });
    expect(anulado.body.contraAsientoId).toEqual(expect.any(String));
    const det = await api().get(`/avales/${b.id}`).expect(200);
    expect(det.body.comisionDevengada).toBe(0);
    const audit = await api()
      .get('/audit?entityType=bank_guarantee_accrual')
      .expect(200);
    const items = (audit.body.items ?? audit.body) as {
      newData: { cambios?: { campo: string }[] };
    }[];
    expect(
      items.flatMap((i) => i.newData?.cambios ?? []).map((c) => c.campo),
    ).toContain('accruedCommission');
  });

  it('cadena de auditoría íntegra', async () => {
    await libroConBeneficio();
    await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200);
    await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-06-30',
        acuerdo: 'Junta',
        reparto: [
          { cuenta: '1120', importe: 500 },
          { cuenta: '1130', importe: 4499.99 },
        ],
      })
      .expect(200);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
    const audit = await api()
      .get('/audit?entityType=result_application')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBe(1);
  });
});
