import { INestApplication } from '@nestjs/common';
import {
  authed,
  createPhase,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import { DevengoSchedulerService } from '../../src/avales/devengo-scheduler.service';

/**
 * ECPN y EFE en las cuentas anuales; plazo de seis meses y art. 273.2 LSC en
 * la aplicación del resultado; EVM y curva S en céntimos exactos con PV/SPI;
 * devengo de comisiones prorrateado por tramos de saldo; devengo automático
 * (endpoint y tarea programada) idempotente y respetando períodos cerrados;
 * conciliación de cierre auxiliar ↔ mayor; cadena de auditoría.
 */
describe('ECPN, EFE, EVM BigInt, devengo por tramos y conciliación (integración)', () => {
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

  async function libro2024() {
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

  it('ECPN y EFE: saldos, dividendos, distribución y flujos que cuadran con el balance y la tesorería', async () => {
    await libro2024();
    const efe24 = (
      await api()
        .get('/contabilidad/ejercicios/2024/cuentas-anuales')
        .expect(200)
    ).body;
    expect(efe24.efe).toMatchObject({
      explotacion: {
        resultado: 4999.99,
        capitalCorriente: -5000,
        total: -0.01,
      },
      financiacion: 10000,
      inversion: 0,
      efectivoInicial: 0,
      variacionEfectivo: 9999.99,
      efectivoFinal: 9999.99,
      cuadra: true,
    });
    expect(efe24.ecpn.cuadraConBalance).toBe(true);

    await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200);
    await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-06-30',
        acuerdo: 'Junta 2025',
        reparto: [
          { cuenta: '1120', importe: 500 },
          { cuenta: '1130', importe: 2499.99 },
          { cuenta: '5260', importe: 2000 },
        ],
      })
      .expect(200);
    // 2025: pago del dividendo y una venta al contado.
    await asiento('2025-07-10', [
      { cuenta: '5260', debe: 2_000 },
      { cuenta: '5720', haber: 2_000 },
    ]).expect(201);
    await asiento('2025-09-01', [
      { cuenta: '5720', debe: 1_000 },
      { cuenta: '7050', haber: 1_000 },
    ]).expect(201);

    const c25 = (
      await api()
        .get('/contabilidad/ejercicios/2025/cuentas-anuales')
        .expect(200)
    ).body;
    const fila = (k: string) =>
      c25.ecpn.filas.find((f: { clave: string }) => f.clave === k);
    expect(fila('saldoInicial')).toMatchObject({
      total: 14999.99,
      importes: { capital: 10000, resultadoEjercicio: 4999.99 },
    });
    expect(fila('ingresosGastosReconocidos').total).toBe(1000);
    expect(fila('operacionesSocios')).toMatchObject({
      total: -2000,
      importes: { resultadoEjercicio: -2000 },
    });
    expect(fila('distribucionResultado')).toMatchObject({
      total: 0,
      importes: { reservas: 2999.99, resultadoEjercicio: -2999.99 },
    });
    expect(c25.ecpn.saldoFinal).toMatchObject({
      total: 13999.99,
      importes: { capital: 10000, reservas: 2999.99, resultadoEjercicio: 1000 },
    });
    expect(c25.ecpn.cuadraConBalance).toBe(true);
    expect(c25.balance.patrimonioNeto.total).toBe(13999.99);
    expect(c25.efe).toMatchObject({
      explotacion: { resultado: 1000, total: 1000 },
      financiacion: -2000,
      efectivoInicial: 9999.99,
      variacionEfectivo: -1000,
      efectivoFinal: 8999.99,
      cuadra: true,
    });
  });

  it('aplicación del resultado: plazo de seis meses y art. 273.2 LSC', async () => {
    await libro2024();
    await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200);
    const prop = (
      await api()
        .get('/contabilidad/ejercicios/2024/aplicacion-resultado')
        .expect(200)
    ).body;
    expect(prop).toMatchObject({
      fechaLimite: '2025-06-30',
      patrimonioNeto: 14999.99,
      situacionPatrimonial: {
        bajoCapital: false,
        desequilibrio: false,
        margen: 4999.99,
      },
      dividendoMaximo: 4499.99,
    });
    const reparto = [
      { cuenta: '1120', importe: 500 },
      { cuenta: '1130', importe: 4499.99 },
    ];
    const tarde = await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({ fecha: '2025-07-01', acuerdo: 'Junta extraordinaria', reparto });
    expect(tarde.status).toBe(422);
    expect(tarde.headers['content-type']).toContain('application/problem+json');
    expect(tarde.body.errorCode).toBe('RESULT_APPLICATION_DEADLINE_EXCEEDED');
    await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-07-01',
        acuerdo: 'Junta extraordinaria',
        reparto,
        aceptarFueraDePlazo: true,
      })
      .expect(200);

    // Reservas negativas: el PN queda por debajo del capital y no hay dividendo.
    await resetTestDb();
    token = (await registerUser(app)).accessToken;
    await asiento('2024-01-10', [
      { cuenta: '5720', debe: 10_000 },
      { cuenta: '1000', haber: 10_000 },
    ]).expect(201);
    await asiento('2024-02-10', [
      { cuenta: '1130', debe: 2_000 },
      { cuenta: '5720', haber: 2_000 },
    ]).expect(201);
    await asiento('2024-03-10', [
      { cuenta: '5720', debe: 1_000 },
      { cuenta: '7050', haber: 1_000 },
    ]).expect(201);
    await api().post('/contabilidad/ejercicios/2024/cerrar').expect(200);
    const p2 = (
      await api()
        .get('/contabilidad/ejercicios/2024/aplicacion-resultado')
        .expect(200)
    ).body;
    expect(p2).toMatchObject({
      patrimonioNeto: 9000,
      situacionPatrimonial: { bajoCapital: true, desequilibrio: false },
      dividendoMaximo: 0,
    });
    const div = await api()
      .post('/contabilidad/ejercicios/2024/aplicar-resultado')
      .send({
        fecha: '2025-05-01',
        acuerdo: 'Junta',
        reparto: [
          { cuenta: '1120', importe: 100 },
          { cuenta: '5260', importe: 900 },
        ],
      });
    expect(div.body.errorCode).toBe('RESULT_APPLICATION_EQUITY_BELOW_CAPITAL');
  });

  it('EVM y curva S en céntimos exactos, con PV y SPI', async () => {
    const o = await createProject(app, token, {
      code: `OB-${u()}`,
      contractAmount: 100_000,
    });
    await createPhase(app, token, o.id, {
      budgetAmount: 30_000,
      plannedStartDate: '2026-01-01',
      plannedEndDate: '2026-03-31',
    });
    await api()
      .post('/certifications')
      .send({ projectId: o.id, certDate: '2026-02-20', cumulativePct: 10 })
      .expect(201);
    const aval = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'anticipo',
          direccion: 'emitido',
          entidad: 'Banco EVM',
          importe: 1_000,
          fechaEmision: '2026-01-10',
          projectId: o.id,
        })
        .expect(201)
    ).body;
    await api()
      .post(`/avales/${aval.id}/comision`)
      .send({ fecha: '2026-01-20', importe: 0.1 })
      .expect(200);
    await api()
      .post(`/avales/${aval.id}/comision`)
      .send({ fecha: '2026-02-20', importe: 0.2 })
      .expect(200);
    const evm = (await api().get(`/projects/${o.id}/cost-control`).expect(200))
      .body;
    expect(evm).toMatchObject({
      ac: 0.3,
      bac: 100000,
      ev: 10000,
      pv: 30000,
      spi: 0.33,
      scheduleVariance: -20000,
    });
    const ultimo = evm.curvaS[evm.curvaS.length - 1];
    expect(ultimo.actualCumulative).toBe(0.3);
    expect(ultimo.plannedCumulative).toBe(30000);
    expect(
      evm.curvaS.find((p: { period: string }) => p.period === '2026-01'),
    ).toMatchObject({
      actualCumulative: 0.1,
      plannedCumulative: 10000,
    });
  });

  it('devengo prorrateado por tramos de saldo y avales ya liberados', async () => {
    const a = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'buena_ejecucion',
          direccion: 'emitido',
          entidad: 'Banco Tramos',
          importe: 100_000,
          fechaEmision: '2026-01-10',
          tasaComisionAnualPct: 0.75,
        })
        .expect(201)
    ).body;
    await api()
      .post(`/avales/${a.id}/liberar`)
      .send({
        fecha: '2026-03-16',
        importe: 60_000,
        motivo: 'Recepción parcial',
      })
      .expect(200);
    const mar = (
      await api()
        .post('/avales/devengos')
        .send({ periodo: '2026-03', avalId: a.id })
        .expect(200)
    ).body;
    expect(mar).toMatchObject({ importe: 43.97, dias: 31, saldoBase: 100000 });
    expect(mar.tramos).toEqual([
      {
        desde: '2026-03-01',
        hasta: '2026-03-15',
        dias: 15,
        saldo: 100000,
        importe: 30.82,
      },
      {
        desde: '2026-03-16',
        hasta: '2026-03-31',
        dias: 16,
        saldo: 40000,
        importe: 13.15,
      },
    ]);
    await api()
      .post(`/avales/${a.id}/liberar`)
      .send({ fecha: '2026-04-11', motivo: 'Recepción definitiva' })
      .expect(200);
    // Ya liberado: abril devenga sus 10 días con saldo; mayo no devenga.
    const abr = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-04' })
      .expect(200);
    expect(abr.body).toMatchObject({ contabilizados: 1, importe: 8.22 });
    const may = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-05' })
      .expect(200);
    expect(may.body).toMatchObject({ contabilizados: 0, omitidos: [] });
    const actual = await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-11' });
    expect(actual.status).toBe(422);
    expect(actual.body.errorCode).toBe('BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN');
  });

  it('devengo automático (endpoint y tarea programada): idempotente y con períodos cerrados', async () => {
    const obra = (await createProject(app, token)).id as string;
    await api()
      .post('/avales')
      .send({
        referencia: `AV-${u()}`,
        tipo: 'anticipo',
        direccion: 'emitido',
        entidad: 'Banco Auto',
        importe: 50_000,
        fechaEmision: '2026-08-05',
        projectId: obra,
        tasaComisionAnualPct: 1,
      })
      .expect(201);
    const r1 = await api()
      .post('/avales/devengos/automatico')
      .set('Idempotency-Key', `auto-${u()}`)
      .send({ hasta: '2026-09' })
      .expect(200);
    // 50.000 × 1 % × 27 / 365 = 36,99 y × 30 / 365 = 41,10
    expect(r1.body).toMatchObject({
      desde: '2026-08',
      hasta: '2026-09',
      contabilizados: 2,
      importe: 78.09,
    });
    const r2 = await api()
      .post('/avales/devengos/automatico')
      .send({ hasta: '2026-09' })
      .expect(200);
    expect(r2.body.contabilizados).toBe(0);
    expect(
      r2.body.periodos.every(
        (p: { omitidos: unknown[] }) => p.omitidos.length === 0,
      ),
    ).toBe(true);

    await api().post('/contabilidad/periodos/2026/10/cerrar').expect(200);
    const r3 = await api()
      .post('/avales/devengos/automatico')
      .send({ hasta: '2026-10' })
      .expect(200);
    const oct = r3.body.periodos.find(
      (p: { periodo: string }) => p.periodo === '2026-10',
    );
    expect(oct.contabilizados).toBe(0);
    expect(oct.omitidos).toHaveLength(1);
    expect(oct.omitidos[0].motivo).toContain('cerrado');
    const abierto = await api()
      .post('/avales/devengos/automatico')
      .send({ hasta: '2026-11' });
    expect(abierto.body.errorCode).toBe('BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN');

    // La tarea programada devenga octubre al reabrirlo, con el usuario de sistema.
    await api().post('/contabilidad/periodos/2026/10/reabrir').expect(200);
    await app.get(DevengoSchedulerService).handleCron();
    const devOct = (
      await api().get('/avales/devengos?periodo=2026-10').expect(200)
    ).body;
    expect(devOct).toHaveLength(1);
    expect(devOct[0].importe).toBe(42.47);
    const ejec = (await api().get('/avales/devengos/ejecuciones').expect(200))
      .body;
    expect(
      ejec.some(
        (e: { disparo: string; periodo: string; contabilizados: number }) =>
          e.disparo === 'automatico' &&
          e.periodo === '2026-10' &&
          e.contabilizados === 1,
      ),
    ).toBe(true);
    expect(ejec.some((e: { disparo: string }) => e.disparo === 'manual')).toBe(
      true,
    );
  });

  it('conciliación de cierre auxiliar ↔ mayor, evidencia guardada y auditoría íntegra', async () => {
    const a = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'anticipo',
          direccion: 'emitido',
          entidad: 'Banco Conc',
          importe: 100_000,
          fechaEmision: '2026-01-10',
          tasaComisionAnualPct: 0.75,
        })
        .expect(201)
    ).body;
    await api()
      .post('/avales/devengos')
      .send({ periodo: '2026-02', avalId: a.id })
      .expect(200);
    const c1 = (await api().get('/contabilidad/conciliacion').expect(200)).body;
    expect(c1).toMatchObject({ id: null, cuadra: true, descuadres: 0 });
    expect(
      c1.partidas.find((p: { clave: string }) => p.clave === 'devengo_avales'),
    ).toMatchObject({
      auxiliar: 57.53,
      mayor: 57.53,
      cuadra: true,
    });
    // Un apunte manual a 281x sin activo detrás descuadra la amortización.
    await asiento('2026-03-31', [
      { cuenta: '6810', debe: 300 },
      { cuenta: '2813', haber: 300 },
    ]).expect(201);
    const c2 = await api()
      .post('/contabilidad/conciliacion')
      .set('Idempotency-Key', `conc-${u()}`)
      .expect(200);
    expect(c2.body).toMatchObject({ cuadra: false, descuadres: 1 });
    expect(c2.body.id).toEqual(expect.any(String));
    expect(
      c2.body.partidas.find(
        (p: { clave: string }) => p.clave === 'amortizacion_acumulada',
      ),
    ).toMatchObject({
      auxiliar: 0,
      mayor: 300,
      diferencia: 300,
      cuadra: false,
    });
    const hist = (
      await api().get('/contabilidad/conciliacion/historial').expect(200)
    ).body;
    expect(hist).toHaveLength(1);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
    const audit = await api()
      .get('/audit?entityType=close_reconciliation')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBe(1);
  });
});
