import { INestApplication } from '@nestjs/common';
import { DevengoSchedulerService } from '../../src/avales/devengo-scheduler.service';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Remate de la fase 1: retenciones de garantía de clientes y proveedores en
 * la conciliación a fecha (4301 / 4001 separadas de 4300 / 4000); avisos de
 * meses omitidos del devengo automático y de la tarea programada (lotes
 * auditados); exportación estatutaria con identificación y evidencia de cierre.
 */
describe('Retenciones en la conciliación a fecha, avisos de devengo y exportación estatutaria (integración)', () => {
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
  type Partida = {
    clave: string;
    auxiliar: number;
    mayor: number;
    diferencia: number;
    cuadra: boolean;
    detalle?: { clave: string; importe: number }[];
  };
  const conciliar = async (fecha: string) =>
    (await api().get(`/contabilidad/conciliacion?fecha=${fecha}`).expect(200))
      .body as { partidas: Partida[]; cuadra: boolean; descuadres: number };
  const partida = (c: { partidas: Partida[] }, clave: string) =>
    c.partidas.find((p) => p.clave === clave)!;
  const detalle = (p: Partida) =>
    Object.fromEntries((p.detalle ?? []).map((d) => [d.clave, d.importe]));
  const vencimiento = async (invoiceId: string, kind: string) => {
    const lista = (await api().get('/treasury/milestones').expect(200))
      .body as {
      id: string;
      invoiceId: string;
      kind: string;
    }[];
    return lista.find((m) => m.invoiceId === invoiceId && m.kind === kind)!.id;
  };
  const liquidar = (id: string, importe: number, fecha: string) =>
    api()
      .post(`/treasury/milestones/${id}/liquidaciones`)
      .send({ importe, fecha })
      .expect(201);

  async function compraConRetencion(projectId: string, contactId: string) {
    const pedido = await api()
      .post('/purchase-orders')
      .send({
        projectId,
        contactId,
        orderDate: '2026-09-14',
        description: 'Subcontrata',
        amount: 500,
      })
      .expect(201);
    const alb = await api()
      .post('/delivery-notes')
      .send({
        contactId,
        orderId: pedido.body.id,
        noteNumber: `ALB-${u()}`,
        noteDate: '2026-09-14',
        amount: 500,
      })
      .expect(201);
    await api().post(`/delivery-notes/${alb.body.id}/validar`).expect(201);
    const fc = await api()
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId,
        invoiceNumber: `FC-${u()}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        retentionPct: 5,
        retentionReleaseDate: '2026-10-01',
        deliveryNoteIds: [alb.body.id],
        lines: [
          { description: 'Obra', baseAmount: 500, vatPct: 21, projectId },
        ],
      })
      .expect(201);
    await api().post(`/invoices/${fc.body.id}/aprobar`).expect(201);
    return fc.body.id as string;
  }

  it('conciliación a fecha con retenciones: 4301/4001 separadas, vencida / no vencida y reclasificación detectada', async () => {
    const obra = await createProject(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const proveedor = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Subcontrata SL',
    });
    // Venta: base 1.000 + IVA 210 = 1.210; retención 5 % = 50 (libera 2026-09-01).
    const fv = await api()
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-${u()}`,
        issueDate: '2026-05-10',
        dueDate: '2026-06-10',
        retentionPct: 5,
        retentionReleaseDate: '2026-09-01',
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
    await api().post(`/invoices/${fv.body.id}/aprobar`).expect(201);
    // Compra: base 500 + IVA 105 = 605; retención 25 (libera 2026-10-01).
    const fc = await compraConRetencion(obra.id, proveedor.id);
    await liquidar(
      await vencimiento(fv.body.id, 'ordinario'),
      500,
      '2026-06-15',
    );
    await liquidar(
      await vencimiento(fv.body.id, 'retencion'),
      20,
      '2026-09-10',
    );
    await liquidar(await vencimiento(fc, 'ordinario'), 580, '2026-09-20');
    await api().post('/contabilidad/interfaz/contabilizar').expect(200);

    const ago = await conciliar('2026-08-31');
    expect(partida(ago, 'clientes')).toMatchObject({
      auxiliar: 660,
      mayor: 660,
      cuadra: true,
    });
    expect(partida(ago, 'clientes_retenciones')).toMatchObject({
      auxiliar: 50,
      mayor: 50,
      cuadra: true,
    });
    expect(detalle(partida(ago, 'clientes_retenciones'))).toEqual({
      vencida: 0,
      no_vencida: 50,
    });
    expect(partida(ago, 'proveedores')).toMatchObject({
      auxiliar: 0,
      mayor: 0,
    });
    expect(ago.cuadra).toBe(true);

    const sep = await conciliar('2026-09-30');
    expect(partida(sep, 'clientes_retenciones')).toMatchObject({
      auxiliar: 30,
      mayor: 30,
      cuadra: true,
    });
    // El plazo de garantía venció el 01-09: los 30 pendientes son vencidos.
    expect(detalle(partida(sep, 'clientes_retenciones'))).toEqual({
      vencida: 30,
      no_vencida: 0,
    });
    expect(partida(sep, 'proveedores')).toMatchObject({
      auxiliar: 0,
      mayor: 0,
      cuadra: true,
    });
    expect(partida(sep, 'proveedores_retenciones')).toMatchObject({
      auxiliar: 25,
      mayor: 25,
      cuadra: true,
    });
    expect(detalle(partida(sep, 'proveedores_retenciones'))).toEqual({
      vencida: 0,
      no_vencida: 25,
    });
    expect(sep.partidas.map((p) => p.clave)).toEqual([
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

    // Un apunte manual que pasa retención a 4300 deja el total intacto, pero
    // las dos partidas descuadran (en una partida conjunta se compensaría).
    await api()
      .post('/contabilidad/asientos')
      .send({
        fecha: '2026-09-30',
        concepto: 'Reclasificación errónea',
        lineas: [
          { cuenta: '4300', debe: 30 },
          { cuenta: '4301', haber: 30 },
        ],
      })
      .expect(201);
    expect(partida(await conciliar('2026-09-29'), 'clientes').cuadra).toBe(
      true,
    );
    const mal = await conciliar('2026-09-30');
    expect(partida(mal, 'clientes')).toMatchObject({
      diferencia: 30,
      cuadra: false,
    });
    expect(partida(mal, 'clientes_retenciones')).toMatchObject({
      diferencia: -30,
      cuadra: false,
    });
    const ev = await api()
      .post('/contabilidad/conciliacion')
      .set('Idempotency-Key', `conc-${u()}`)
      .send({ fecha: '2026-09-30' })
      .expect(200);
    expect(ev.body).toMatchObject({
      fecha: '2026-09-30',
      cuadra: false,
      descuadres: 2,
    });
    expect(detalle(partida(ev.body, 'clientes_retenciones'))).toEqual({
      vencida: 30,
      no_vencida: 0,
    });
    const futura = await api().get(
      '/contabilidad/conciliacion?fecha=2999-01-01',
    );
    expect(futura.status).toBe(422);
    expect(futura.body.errorCode).toBe('CLOSE_RECONCILIATION_DATE_INVALID');
  });

  it('devengo automático y tarea programada: avisos de meses omitidos en lotes auditados', async () => {
    const a = (
      await api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo: 'anticipo',
          direccion: 'emitido',
          entidad: 'Banco Avisos',
          importe: 100_000,
          fechaEmision: '2024-01-15',
          tasaComisionAnualPct: 1,
        })
        .expect(201)
    ).body;
    await api().post('/contabilidad/periodos/2026/10/cerrar').expect(200);
    const auto = () =>
      api()
        .post('/avales/devengos/automatico')
        .set('Idempotency-Key', `auto-${u()}`)
        .send({ fechaReferencia: '2026-11-15' })
        .expect(200);

    // Ventana de 24 meses: 2024-11 a 2026-10. Enero-octubre de 2024 quedan
    // fuera (alerta) y octubre de 2026 está cerrado (alerta).
    const r1 = (await auto()).body;
    expect(r1).toMatchObject({
      desde: '2024-11',
      hasta: '2026-10',
      contabilizados: 23,
      alertas: 2,
    });
    expect(r1.loteId).toEqual(expect.any(String));
    expect(r1.avisos).toEqual([
      expect.objectContaining({
        desde: '2024-01',
        hasta: '2024-10',
        meses: 10,
        motivo: 'fuera_de_ventana',
        nivel: 'alerta',
        casos: 10,
      }),
      expect.objectContaining({
        desde: '2026-10',
        hasta: '2026-10',
        motivo: 'periodo_cerrado',
        nivel: 'alerta',
        casos: 1,
      }),
    ]);
    const oct = r1.periodos.find(
      (p: { periodo: string }) => p.periodo === '2026-10',
    );
    expect(oct.omitidos[0]).toMatchObject({
      avalId: a.id,
      codigo: 'FISCAL_PERIOD_CLOSED',
    });

    // Idempotente: lo ya devengado es aviso informativo, agrupado en un rango.
    const r2 = (await auto()).body;
    expect(r2).toMatchObject({ contabilizados: 0, alertas: 2 });
    expect(
      r2.avisos.map(
        (x: {
          motivo: string;
          desde: string;
          hasta: string;
          nivel: string;
        }) => [x.motivo, x.desde, x.hasta, x.nivel],
      ),
    ).toEqual([
      ['fuera_de_ventana', '2024-01', '2024-10', 'alerta'],
      ['ya_devengado', '2024-11', '2026-09', 'info'],
      ['periodo_cerrado', '2026-10', '2026-10', 'alerta'],
    ]);

    // Tarea programada (usuario de sistema) tras reabrir octubre y devengar
    // enero de 2024 a mano: solo queda fuera febrero-octubre de 2024.
    await api().post('/contabilidad/periodos/2026/10/reabrir').expect(200);
    await api()
      .post('/avales/devengos')
      .send({ periodo: '2024-01', avalId: a.id })
      .expect(200);
    await app.get(DevengoSchedulerService).handleCron('2026-11-15');
    const lotes = (await api().get('/avales/devengos/lotes').expect(200)).body;
    expect(lotes).toHaveLength(3);
    expect(lotes[0]).toMatchObject({
      disparo: 'automatico',
      fechaReferencia: '2026-11-15',
      desde: '2024-11',
      hasta: '2026-10',
      contabilizados: 1,
      alertas: 1,
    });
    expect(
      lotes[0].avisos.map(
        (x: {
          motivo: string;
          desde: string;
          hasta: string;
          casos: number;
        }) => [x.motivo, x.desde, x.hasta, x.casos],
      ),
    ).toEqual([
      ['fuera_de_ventana', '2024-02', '2024-10', 9],
      ['ya_devengado', '2024-11', '2026-09', 23],
    ]);
    expect(lotes[0].avisos[0].detalle).toContain('POST /avales/devengos');
    expect(lotes[2]).toMatchObject({
      disparo: 'manual',
      contabilizados: 23,
      alertas: 2,
    });
    // Las ejecuciones por mes siguen disponibles.
    const ejecuciones = (
      await api().get('/avales/devengos/ejecuciones').expect(200)
    ).body;
    expect(ejecuciones.length).toBeGreaterThanOrEqual(24);

    const audit = (
      await api()
        .get('/audit?entityType=bank_guarantee_accrual_batch')
        .expect(200)
    ).body;
    const items = (audit.items ?? audit) as { action: string }[];
    expect(items).toHaveLength(3);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('sin avales con tasa no se guarda lote ni hay avisos', async () => {
    const r = (
      await api()
        .post('/avales/devengos/automatico')
        .send({ fechaReferencia: '2026-11-15' })
        .expect(200)
    ).body;
    expect(r).toMatchObject({
      desde: null,
      loteId: null,
      avisos: [],
      alertas: 0,
    });
    expect(
      (await api().get('/avales/devengos/lotes').expect(200)).body,
    ).toEqual([]);
  });

  it('exportación estatutaria: identificación, notas, cierre y conciliación al 31-12', async () => {
    await api()
      .post('/contabilidad/asientos')
      .send({
        fecha: '2025-03-01',
        concepto: 'Capital',
        lineas: [
          { cuenta: '5720', debe: 3000 },
          { cuenta: '1000', haber: 3000 },
        ],
      })
      .expect(201);
    const ca = (
      await api()
        .get('/contabilidad/ejercicios/2025/cuentas-anuales')
        .expect(200)
    ).body;
    expect(ca.identificacion).toMatchObject({
      formato: 'erp-dintel/cuentas-anuales@2',
      ejercicio: 2025,
      fechaCierre: '2025-12-31',
      moneda: 'EUR',
      modelo: 'abreviado',
    });
    expect(ca.cierre).toMatchObject({
      cerrado: false,
      resultadoAplicado: false,
      conciliacion: { fecha: '2025-12-31', cuadra: true, descuadres: 0 },
    });
    expect(ca.cierre.conciliacion.partidas).toHaveLength(11);
    // El ejercicio en curso se concilia a hoy; uno futuro, sin conciliación.
    const futuro = (
      await api()
        .get('/contabilidad/ejercicios/2099/cuentas-anuales')
        .expect(200)
    ).body;
    expect(futuro.cierre.conciliacion).toBeNull();

    const csv = await api()
      .get('/contabilidad/ejercicios/2025/cuentas-anuales/exportar?formato=csv')
      .expect(200);
    expect(csv.headers['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(csv.headers['content-disposition']).toContain(
      'cuentas-anuales-2025.csv',
    );
    const lineas = csv.text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lineas[0]).toBe('seccion;partida;concepto;importe');
    expect(lineas[1]).toBe(
      'identificacion;formato;version;erp-dintel/cuentas-anuales@2',
    );
    expect(lineas).toContain(
      'identificacion;ejercicio;fecha_cierre;2025-12-31',
    );
    expect(lineas).toContain(
      'memoria;nota_8;titulo;Situación patrimonial e indicadores',
    );
    expect(lineas).toContain('cierre;estado;cerrado;no');
    expect(lineas).toContain('cierre;conciliacion;fecha;2025-12-31');
    expect(lineas).toContain('cierre;conciliacion;clientes_retenciones;0.00');
    const json = await api()
      .get(
        '/contabilidad/ejercicios/2025/cuentas-anuales/exportar?formato=json',
      )
      .expect(200);
    const cuerpo = JSON.parse(json.text);
    expect(cuerpo.identificacion.ejercicio).toBe(2025);
    expect(cuerpo.cierre.conciliacion.cuadra).toBe(true);
    // Determinista: misma huella en una segunda descarga.
    const json2 = await api()
      .get(
        '/contabilidad/ejercicios/2025/cuentas-anuales/exportar?formato=json',
      )
      .expect(200);
    expect(json2.headers['x-content-sha256']).toBe(
      json.headers['x-content-sha256'],
    );
  });
});
