import { INestApplication } from '@nestjs/common';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Memoria abreviada y exportación determinista de las cuentas anuales;
 * conciliación de cierre a una fecha de corte ampliada a clientes,
 * proveedores y almacén; devengo con cambio de tasa dentro del mes y fecha de
 * referencia explícita; cadena de auditoría.
 */
describe('Memoria abreviada, exportación y conciliación a fecha (integración)', () => {
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
  type Linea = { cuenta: string; debe?: number; haber?: number };
  const asiento = (fecha: string, lineas: Linea[]) =>
    api()
      .post('/contabilidad/asientos')
      .send({ fecha, concepto: `Prueba ${fecha}`, lineas });
  const conciliar = async (fecha: string) =>
    (await api().get(`/contabilidad/conciliacion?fecha=${fecha}`).expect(200))
      .body;
  const partida = (c: { partidas: { clave: string }[] }, clave: string) =>
    c.partidas.find((p) => p.clave === clave) as unknown as {
      auxiliar: number;
      mayor: number;
      cuadra: boolean;
    };

  it('memoria abreviada coherente y exportación CSV/JSON determinista y auditada', async () => {
    await asiento('2024-01-10', [
      { cuenta: '5720', debe: 10_000 },
      { cuenta: '1000', haber: 10_000 },
    ]).expect(201);
    await asiento('2024-02-01', [
      { cuenta: '2130', debe: 3_000 },
      { cuenta: '5720', haber: 3_000 },
    ]).expect(201);
    await asiento('2024-06-30', [
      { cuenta: '4300', debe: 12_100 },
      { cuenta: '7050', haber: 10_000 },
      { cuenta: '4770', haber: 2_100 },
    ]).expect(201);
    await asiento('2024-12-31', [
      { cuenta: '6810', debe: 300 },
      { cuenta: '2813', haber: 300 },
    ]).expect(201);
    await api()
      .post('/avales')
      .send({
        referencia: `AV-${u()}`,
        tipo: 'buena_ejecucion',
        direccion: 'emitido',
        entidad: 'Banco Memoria',
        importe: 50_000,
        fechaEmision: '2024-03-01',
        tasaComisionAnualPct: 0.73,
      })
      .expect(201);
    // 50.000 × 0,73 % × 31 / 365 = 31,00
    const dev = await api()
      .post('/avales/devengos')
      .send({ periodo: '2024-03' })
      .expect(200);
    expect(dev.body).toMatchObject({ contabilizados: 1, importe: 31 });

    const ca = (
      await api()
        .get('/contabilidad/ejercicios/2024/cuentas-anuales')
        .expect(200)
    ).body;
    const m = ca.memoria;
    expect(m.coherente).toBe(true);
    expect(m.notas.map((n: { numero: number }) => n.numero)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const nota = (n: number) =>
      m.notas.find((x: { numero: number }) => x.numero === n);
    expect(nota(5).cifras).toEqual({
      costeFinal: 3000,
      amortizacionFinal: 300,
      valorNeto: 2700,
    });
    expect(nota(7).cifras).toEqual({
      emitidosSaldoVivo: 50000,
      recibidosSaldoVivo: 0,
    });
    expect(nota(7).texto.join(' ')).toContain('31,00');
    expect(m.indicadores.fondoManiobra).toBe(
      Math.round(
        (ca.balance.activoCorriente.total - ca.balance.pasivoCorriente.total) *
          100,
      ) / 100,
    );
    expect(ca.efe.explotacion.capitalCorrienteDesglose).toMatchObject({
      clientes: -12100,
      administraciones: 2100,
    });

    const j1 = await api()
      .get(
        '/contabilidad/ejercicios/2024/cuentas-anuales/exportar?formato=json',
      )
      .expect(200);
    expect(j1.headers['content-type']).toContain('application/json');
    expect(j1.headers['content-disposition']).toContain(
      'cuentas-anuales-2024.json',
    );
    expect(j1.headers['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    const j2 = await api()
      .get(
        '/contabilidad/ejercicios/2024/cuentas-anuales/exportar?formato=json',
      )
      .expect(200);
    expect(j2.headers['x-content-sha256']).toBe(j1.headers['x-content-sha256']);
    const csv = await api()
      .get('/contabilidad/ejercicios/2024/cuentas-anuales/exportar?formato=csv')
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const texto = csv.text.replace(/^\uFEFF/, '');
    expect(texto.split('\r\n')[0]).toBe('seccion;partida;concepto;importe');
    expect(texto).toContain('pyg;resultado;Resultado del ejercicio;');
    expect(texto).toContain('memoria;comprobacion;balance_cuadra;ok');
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get('/contabilidad/ejercicios/2024/cuentas-anuales/exportar?formato=csv')
      .expect(200);
    const mal = await api().get(
      '/contabilidad/ejercicios/2024/cuentas-anuales/exportar?formato=pdf',
    );
    expect(mal.status).toBe(400);
    const audit = (
      await api().get('/audit?entityType=annual_accounts').expect(200)
    ).body;
    const items = (audit.items ?? audit) as {
      action: string;
      meta: { sha256: string };
    }[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every((i) => i.action === 'export')).toBe(true);
  });

  it('conciliación a fecha: clientes, avales y almacén se reconstruyen a la fecha de corte', async () => {
    const obra = await createProject(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const factura = await api()
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `F-${u()}`,
        issueDate: '2026-05-10',
        dueDate: '2026-06-10',
        lines: [
          {
            description: 'Certificación',
            baseAmount: 1000,
            vatPct: 21,
            projectId: obra.id,
          },
        ],
      })
      .expect(201);
    await api().post(`/invoices/${factura.body.id}/aprobar`).expect(201);
    await api().post('/contabilidad/interfaz/contabilizar').expect(200);
    const [vto] = (await api().get('/treasury/milestones').expect(200)).body;
    await api()
      .post(`/treasury/milestones/${vto.id}/liquidaciones`)
      .send({ importe: 500, fecha: '2026-06-15' })
      .expect(201);
    // Sin pasar la interfaz, el cobro está en el auxiliar y no en el mayor.
    const sinInterfaz = await conciliar('2026-06-30');
    expect(partida(sinInterfaz, 'clientes')).toMatchObject({
      auxiliar: 710,
      mayor: 1210,
      cuadra: false,
    });
    await api().post('/contabilidad/interfaz/contabilizar').expect(200);
    expect(partida(await conciliar('2026-05-09'), 'clientes')).toMatchObject({
      auxiliar: 0,
      mayor: 0,
      cuadra: true,
    });
    expect(partida(await conciliar('2026-06-14'), 'clientes')).toMatchObject({
      auxiliar: 1210,
      mayor: 1210,
      cuadra: true,
    });
    expect(partida(await conciliar('2026-06-15'), 'clientes')).toMatchObject({
      auxiliar: 710,
      mayor: 710,
      cuadra: true,
    });

    // Avales: el devengo de febrero (asiento al 28-02) aparece en esa fecha.
    const a = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'anticipo',
          direccion: 'emitido',
          entidad: 'Banco Corte',
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
    expect(
      partida(await conciliar('2026-02-27'), 'devengo_avales'),
    ).toMatchObject({ auxiliar: 0, mayor: 0 });
    expect(
      partida(await conciliar('2026-02-28'), 'devengo_avales'),
    ).toMatchObject({
      auxiliar: 57.53,
      mayor: 57.53,
      cuadra: true,
    });

    // Almacén: un apunte manual a 3000 sin kárdex descuadra solo desde su fecha.
    await asiento('2026-03-10', [
      { cuenta: '3000', debe: 100 },
      { cuenta: '5720', haber: 100 },
    ]).expect(201);
    expect(partida(await conciliar('2026-03-09'), 'almacen').cuadra).toBe(true);
    const corte = await conciliar('2026-03-10');
    expect(partida(corte, 'almacen')).toMatchObject({
      auxiliar: 0,
      mayor: 100,
      cuadra: false,
    });
    expect(corte.partidas.map((p: { clave: string }) => p.clave)).toEqual([
      'devengo_avales',
      'amortizacion_acumulada',
      'obra_en_curso',
      'provision_perdidas',
      'clientes',
      'clientes_retenciones',
      'proveedores',
      'proveedores_retenciones',
      'anticipos_clientes',
      'anticipos_proveedores',
      'almacen',
    ]);

    const futura = await api().get(
      '/contabilidad/conciliacion?fecha=2999-01-01',
    );
    expect(futura.status).toBe(422);
    expect(futura.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(futura.body.errorCode).toBe('CLOSE_RECONCILIATION_DATE_INVALID');
    const ev = await api()
      .post('/contabilidad/conciliacion')
      .set('Idempotency-Key', `conc-${u()}`)
      .send({ fecha: '2026-03-10' })
      .expect(200);
    expect(ev.body).toMatchObject({
      fecha: '2026-03-10',
      cuadra: false,
      descuadres: 1,
    });
    const hist = (
      await api().get('/contabilidad/conciliacion/historial').expect(200)
    ).body;
    expect(hist[0].fecha).toBe('2026-03-10');
  });

  it('devengo con cambio de tasa dentro del mes e historial de tasas', async () => {
    const a = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'anticipo',
          direccion: 'emitido',
          entidad: 'Banco Tasa',
          importe: 100_000,
          fechaEmision: '2026-01-10',
          tasaComisionAnualPct: 0.75,
        })
        .expect(201)
    ).body;
    const antes = await api()
      .patch(`/avales/${a.id}`)
      .set('If-Match', `"${a.version}"`)
      .send({ tasaComisionAnualPct: 1, tasaVigenteDesde: '2026-01-01' });
    expect(antes.status).toBe(422);
    expect(antes.body.errorCode).toBe('BANK_GUARANTEE_RATE_DATE_INVALID');
    const cambio = await api()
      .patch(`/avales/${a.id}`)
      .set('If-Match', `"${a.version}"`)
      .send({ tasaComisionAnualPct: 1.25, tasaVigenteDesde: '2026-03-21' })
      .expect(200);
    expect(cambio.body.tasas).toEqual([
      { fecha: '2026-01-10', tasaAnualPct: 0.75 },
      { fecha: '2026-03-21', tasaAnualPct: 1.25 },
    ]);
    const atras = await api()
      .patch(`/avales/${a.id}`)
      .set('If-Match', `"${cambio.body.version}"`)
      .send({ tasaComisionAnualPct: 2, tasaVigenteDesde: '2026-03-01' });
    expect(atras.body.errorCode).toBe('BANK_GUARANTEE_RATE_DATE_INVALID');

    // Febrero, con la tasa inicial; marzo, en dos tramos de tasa.
    const feb = (
      await api()
        .post('/avales/devengos')
        .send({
          periodo: '2026-02',
          avalId: a.id,
          fechaReferencia: '2026-04-01',
        })
        .expect(200)
    ).body;
    expect(feb).toMatchObject({ importe: 57.53, tasaAnualPct: 0.75 });
    const mar = (
      await api()
        .post('/avales/devengos')
        .send({
          periodo: '2026-03',
          avalId: a.id,
          fechaReferencia: '2026-04-01',
        })
        .expect(200)
    ).body;
    // 100.000 × (0,75 % × 20 + 1,25 % × 11) / 365 = 78,77
    expect(mar).toMatchObject({ importe: 78.77, dias: 31 });
    expect(mar.tramos).toEqual([
      {
        desde: '2026-03-01',
        hasta: '2026-03-20',
        dias: 20,
        saldo: 100000,
        tasaAnualPct: 0.75,
        importe: 41.1,
      },
      {
        desde: '2026-03-21',
        hasta: '2026-03-31',
        dias: 11,
        saldo: 100000,
        tasaAnualPct: 1.25,
        importe: 37.67,
      },
    ]);
    // Abril aún abierto respecto a la referencia 2026-04-15.
    const abr = await api().post('/avales/devengos').send({
      periodo: '2026-04',
      avalId: a.id,
      fechaReferencia: '2026-04-15',
    });
    expect(abr.body.errorCode).toBe('BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN');

    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });
});
