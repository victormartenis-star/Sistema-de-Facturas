import { INestApplication } from '@nestjs/common';
import { DevengoSchedulerService } from '../../src/avales/devengo-scheduler.service';
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
 * Fase 2: cartera de clientes y proveedores (partidas abiertas, antigüedad,
 * anticipos, compensación y conciliación por tercero), inventario por lote y
 * número de serie, notificación de alertas del devengo automático y detalle
 * de cobros y pagos del EFE.
 */
describe('Cartera AR/AP, lotes y series y alertas de devengo (integración)', () => {
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
  const interfaz = () =>
    api().post('/contabilidad/interfaz/contabilizar').expect(200);

  async function venta(
    contactId: string,
    projectId: string,
    x: {
      fecha: string;
      vence: string;
      base: number;
      ret?: number;
      libera?: string;
    },
  ) {
    const f = await api()
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId,
        invoiceNumber: `FV-${u()}`,
        issueDate: x.fecha,
        dueDate: x.vence,
        ...(x.ret
          ? { retentionPct: x.ret, retentionReleaseDate: x.libera }
          : {}),
        lines: [
          {
            description: 'Certificación',
            baseAmount: x.base,
            vatPct: 21,
            projectId,
          },
        ],
      })
      .expect(201);
    await api().post(`/invoices/${f.body.id}/aprobar`).expect(201);
    return f.body.id as string;
  }

  async function compra(contactId: string, projectId: string) {
    const pedido = await api()
      .post('/purchase-orders')
      .send({
        projectId,
        contactId,
        orderDate: '2026-09-14',
        description: 'Suministro',
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
    const f = await api()
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId,
        invoiceNumber: `FC-${u()}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        deliveryNoteIds: [alb.body.id],
        lines: [
          { description: 'Material', baseAmount: 500, vatPct: 21, projectId },
        ],
      })
      .expect(201);
    await api().post(`/invoices/${f.body.id}/aprobar`).expect(201);
    return f.body.id as string;
  }

  type Tercero = {
    contactId: string | null;
    contactName: string;
    auxiliar: number;
    mayor: number;
    cuadra: boolean;
    ordinario: number;
    retencion: number;
    anticipos: number;
  };
  const conciliacion = async (tipo: string, fecha: string) =>
    (
      await api()
        .get(`/cartera/conciliacion?tipo=${tipo}&fecha=${fecha}`)
        .expect(200)
    ).body as {
      terceros: Tercero[];
      cuadra: boolean;
      descuadres: number;
    };
  const de = (c: { terceros: Tercero[] }, id: string | null) =>
    c.terceros.find((t) => t.contactId === id)!;

  it('cartera: antigüedad, anticipo aplicado, compensación, conciliación por tercero y bloqueos', async () => {
    const obra = await createProject(app, token);
    const x = await createContact(app, token, {
      kind: 'ambos',
      legalName: 'Mixta Construcciones SL',
    });
    const y = await createContact(app, token, {
      kind: 'cliente',
      legalName: 'Promotora Y SA',
    });
    // X: venta 1.210 (vence 10-06) y compra 605 (vence 14-10). Y: venta 605 con 25 retenidos (libera 01-12).
    await venta(x.id, obra.id, {
      fecha: '2026-05-10',
      vence: '2026-06-10',
      base: 1000,
    });
    await venta(y.id, obra.id, {
      fecha: '2026-09-01',
      vence: '2026-10-01',
      base: 500,
      ret: 5,
      libera: '2026-12-01',
    });
    await compra(x.id, obra.id);
    await interfaz();

    const ag = (
      await api()
        .get('/cartera/antiguedad?tipo=clientes&fecha=2026-10-31')
        .expect(200)
    ).body;
    expect(ag.totales).toMatchObject({
      tramos: {
        al_corriente: 25,
        d1_30: 580,
        d31_60: 0,
        d61_90: 0,
        mas_90: 1210,
      },
      total: 1815,
      vencido: 1790,
      partidas: 3,
    });
    expect(
      ag.terceros.map(
        (t: { contactName: string; total: number; retencion: number }) => [
          t.contactName,
          t.total,
          t.retencion,
        ],
      ),
    ).toEqual([
      ['Mixta Construcciones SL', 1210, 0],
      ['Promotora Y SA', 605, 25],
    ]);
    const vencidas = (
      await api()
        .get(
          `/cartera/partidas?tipo=clientes&fecha=2026-10-31&soloVencidas=true`,
        )
        .expect(200)
    ).body;
    expect(
      vencidas.partidas.map((p: { pendiente: number; tramo: string }) => [
        p.pendiente,
        p.tramo,
      ]),
    ).toEqual([
      [1210, 'mas_90'],
      [580, 'd1_30'],
    ]);
    const futura = await api().get(
      '/cartera/partidas?tipo=clientes&fecha=2999-01-01',
    );
    expect(futura.status).toBe(422);
    expect(futura.body.errorCode).toBe('AR_AP_DATE_INVALID');

    // Anticipo de Y (5720 a 4380) y su aplicación por antigüedad (4380 a 4300).
    const ant = (
      await api()
        .post('/cartera/anticipos')
        .set('Idempotency-Key', `ant-${u()}`)
        .send({
          tipo: 'clientes',
          contactId: y.id,
          importe: 300,
          fecha: '2026-10-05',
          referencia: 'TR-77',
        })
        .expect(201)
    ).body;
    expect(ant).toMatchObject({
      importe: 300,
      aplicado: 0,
      disponible: 300,
      estado: 'vigente',
    });
    const antes = await api()
      .post(`/cartera/anticipos/${ant.id}/aplicar`)
      .send({ fecha: '2026-10-01' });
    expect(antes.body.errorCode).toBe('AR_AP_DATE_INVALID');
    const excede = await api()
      .post(`/cartera/anticipos/${ant.id}/aplicar`)
      .send({ fecha: '2026-10-20', importe: 301 });
    expect(excede.body.errorCode).toBe('AR_AP_ALLOCATION_EXCEEDS_AVAILABLE');
    const apl = (
      await api()
        .post(`/cartera/anticipos/${ant.id}/aplicar`)
        .set('Idempotency-Key', `apl-${u()}`)
        .set('If-Match', `"${ant.version}"`)
        .send({ fecha: '2026-10-20' })
        .expect(200)
    ).body;
    expect(apl).toMatchObject({ aplicado: 300, disponible: 0 });
    expect(apl.aplicaciones).toHaveLength(1);
    expect(apl.aplicaciones[0]).toMatchObject({
      importe: 300,
      estado: 'vigente',
    });
    const otra = await api()
      .post(`/cartera/anticipos/${ant.id}/aplicar`)
      .send({ fecha: '2026-10-21' });
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('AR_AP_ADVANCE_APPLIED');

    // Compensación de X: 605 a pagar contra 1.210 a cobrar (5550 se netea).
    const comp = (
      await api()
        .post('/cartera/compensaciones')
        .set('Idempotency-Key', `comp-${u()}`)
        .send({ contactId: x.id, fecha: '2026-10-25' })
        .expect(201)
    ).body;
    expect(comp).toMatchObject({ importe: 605, estado: 'vigente' });
    expect(
      comp.lineas
        .map((l: { direccion: string; importe: number }) => [
          l.direccion,
          l.importe,
        ])
        .sort(),
    ).toEqual([
      ['cobro', 605],
      ['pago', 605],
    ]);
    const sinPagos = await api()
      .post('/cartera/compensaciones')
      .send({ contactId: y.id, fecha: '2026-10-25' });
    expect(sinPagos.body.errorCode).toBe('AR_AP_ITEM_NOT_OPEN');
    // Sus liquidaciones solo se anulan desde la compensación.
    const suelta = await api()
      .post(`/treasury/liquidaciones/${comp.lineas[0].liquidacionId}/anular`)
      .send({ motivo: 'Prueba de bloqueo' });
    expect(suelta.status).toBe(409);
    expect(suelta.body.errorCode).toBe('AR_AP_CLEARING_SETTLEMENT_LOCKED');
    await interfaz();

    const cli = await conciliacion('clientes', '2026-10-31');
    expect(cli.cuadra).toBe(true);
    expect(de(cli, x.id)).toMatchObject({
      ordinario: 605,
      auxiliar: 605,
      mayor: 605,
    });
    expect(de(cli, y.id)).toMatchObject({
      ordinario: 280,
      retencion: 25,
      anticipos: 0,
      auxiliar: 305,
      mayor: 305,
    });
    // Antes de aplicar el anticipo, el auxiliar neto ya lo descuenta.
    const previa = await conciliacion('clientes', '2026-10-10');
    expect(de(previa, y.id)).toMatchObject({
      ordinario: 580,
      anticipos: 300,
      auxiliar: 305,
      mayor: 305,
      cuadra: true,
    });
    const prov = await conciliacion('proveedores', '2026-10-31');
    expect(de(prov, x.id)).toMatchObject({
      auxiliar: 0,
      mayor: 0,
      cuadra: true,
    });

    const cierre = (
      await api().get('/contabilidad/conciliacion?fecha=2026-10-10').expect(200)
    ).body;
    const p = (k: string) =>
      cierre.partidas.find((z: { clave: string }) => z.clave === k);
    expect(p('anticipos_clientes')).toMatchObject({
      auxiliar: 300,
      mayor: 300,
      cuadra: true,
    });
    expect(cierre.partidas).toHaveLength(11);
    const cierreOct = (
      await api().get('/contabilidad/conciliacion?fecha=2026-10-31').expect(200)
    ).body;
    expect(cierreOct.cuadra).toBe(true);

    // Detalle de cobros y pagos del EFE: cuadra con la variación de 57x.
    const ca = (
      await api()
        .get('/contabilidad/ejercicios/2026/cuentas-anuales')
        .expect(200)
    ).body;
    expect(ca.efe.cobrosPagos).toMatchObject({
      cobrosClientes: 300,
      pagosProveedores: 0,
      cuadra: true,
    });
    expect(ca.efe.cobrosPagos.total).toBe(ca.efe.variacionEfectivo);

    // Anular la compensación devuelve las partidas; la conciliación sigue cuadrando.
    const anulada = (
      await api()
        .post(`/cartera/compensaciones/${comp.id}/anular`)
        .set('If-Match', `"${comp.version}"`)
        .send({ motivo: 'Acuerdo revocado' })
        .expect(200)
    ).body;
    expect(anulada.estado).toBe('anulado');
    expect(
      anulada.lineas.every((l: { estado: string }) => l.estado === 'anulada'),
    ).toBe(true);
    await interfaz();
    // A 31-10 la compensación estaba en vigor (se anuló después): el auxiliar
    // y el mayor —cuyo contra-asiento va a la fecha de anulación— siguen en 605.
    const tras = await conciliacion('clientes', '2026-10-31');
    expect(de(tras, x.id)).toMatchObject({
      ordinario: 605,
      mayor: 605,
      cuadra: true,
    });
    const hoy = await conciliacion(
      'clientes',
      new Date().toISOString().slice(0, 10),
    );
    expect(de(hoy, x.id)).toMatchObject({
      ordinario: 1210,
      mayor: 1210,
      cuadra: true,
    });

    // Anticipo aplicado: no se anula sin desaplicar.
    const conApl = await api()
      .post(`/cartera/anticipos/${ant.id}/anular`)
      .send({ motivo: 'Devolución' });
    expect(conApl.body.errorCode).toBe('AR_AP_ADVANCE_APPLIED');
    await api()
      .post(`/cartera/anticipos/${ant.id}/desaplicar`)
      .send({ motivo: 'Error de imputación' })
      .expect(200);
    const fin = (
      await api()
        .post(`/cartera/anticipos/${ant.id}/anular`)
        .send({ motivo: 'Devolución al cliente' })
        .expect(200)
    ).body;
    expect(fin).toMatchObject({ estado: 'anulado', aplicado: 0 });
    expect(fin.contraAsientoId).toEqual(expect.any(String));
    await interfaz();
    expect((await conciliacion('clientes', '2026-10-31')).cuadra).toBe(true);
    expect(
      (await conciliacion('clientes', new Date().toISOString().slice(0, 10)))
        .cuadra,
    ).toBe(true);
    const cierreHoy = (
      await api().get('/contabilidad/conciliacion').expect(200)
    ).body;
    expect(cierreHoy.cuadra).toBe(true);
    expect(
      (
        await api()
          .get('/contabilidad/conciliacion?fecha=2026-10-31')
          .expect(200)
      ).body.cuadra,
    ).toBe(true);

    // Un apunte manual a 4300 queda «sin tercero» y descuadra esa fila.
    await api()
      .post('/contabilidad/asientos')
      .send({
        fecha: '2026-10-30',
        concepto: 'Ajuste manual',
        lineas: [
          { cuenta: '4300', debe: 10 },
          { cuenta: '7050', haber: 10 },
        ],
      })
      .expect(201);
    const manual = await conciliacion('clientes', '2026-10-31');
    expect(de(manual, null)).toMatchObject({
      contactName: 'Sin tercero (apuntes manuales)',
      mayor: 10,
      cuadra: false,
    });
    expect(manual.descuadres).toBe(1);

    // Permisos: el lector consulta y no opera; el rol obra no accede.
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get('/cartera/antiguedad?tipo=proveedores')
      .expect(200);
    await authed(app, lector.accessToken)
      .post('/cartera/anticipos')
      .send({
        tipo: 'clientes',
        contactId: y.id,
        importe: 1,
        fecha: '2026-10-05',
      })
      .expect(403);
    const obraUser = await createUserWithRole(app, token, 'obra');
    await authed(app, obraUser.accessToken)
      .get('/cartera/partidas?tipo=clientes')
      .expect(403);

    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('lotes y números de serie: entrada, FEFO, devolución, traspaso, regularización y trazabilidad', async () => {
    const obra = await createProject(app, token);
    const cen = (
      await api()
        .post('/almacen/almacenes')
        .send({ codigo: 'CEN', nombre: 'Central', tipo: 'central' })
        .expect(201)
    ).body;
    const aux = (
      await api()
        .post('/almacen/almacenes')
        .send({ codigo: 'AUX', nombre: 'Auxiliar', tipo: 'central' })
        .expect(201)
    ).body;
    const cem = (
      await api()
        .post('/almacen/articulos')
        .send({
          codigo: 'CEM',
          nombre: 'Cemento',
          unidad: 'saco',
          seguimiento: 'lote',
        })
        .expect(201)
    ).body;
    const maq = (
      await api()
        .post('/almacen/articulos')
        .send({
          codigo: 'VIB',
          nombre: 'Vibrador',
          unidad: 'ud',
          seguimiento: 'serie',
        })
        .expect(201)
    ).body;
    const simple = (
      await api()
        .post('/almacen/articulos')
        .send({ codigo: 'ARE', nombre: 'Arena', unidad: 't' })
        .expect(201)
    ).body;
    expect(cem.seguimiento).toBe('lote');
    const malSerie = await api()
      .post('/almacen/articulos')
      .send({ codigo: 'X', nombre: 'X', unidad: 'm', seguimiento: 'serie' });
    expect(malSerie.body.errorCode).toBe('BATCH_SERIAL_INVALID');

    const entrada = (lineas: unknown[], almacenId = cen.id) =>
      api()
        .post('/almacen/entradas')
        .send({ almacenId, fecha: '2026-03-02', lineas });
    expect(
      (await entrada([{ articuloId: cem.id, cantidad: 10, costeUnitario: 5 }]))
        .body.errorCode,
    ).toBe('BATCH_SERIAL_REQUIRED');
    expect(
      (
        await entrada([
          {
            articuloId: simple.id,
            cantidad: 1,
            costeUnitario: 5,
            lotes: [{ codigo: 'L', cantidad: 1 }],
          },
        ])
      ).body.errorCode,
    ).toBe('BATCH_SERIAL_NOT_TRACKED');
    expect(
      (
        await entrada([
          {
            articuloId: cem.id,
            cantidad: 10,
            costeUnitario: 5,
            lotes: [{ codigo: 'L1', cantidad: 9 }],
          },
        ])
      ).body.errorCode,
    ).toBe('BATCH_SERIAL_QUANTITY_MISMATCH');
    const ok = await entrada([
      {
        articuloId: cem.id,
        cantidad: 10,
        costeUnitario: 5,
        lotes: [
          { codigo: 'l1', cantidad: 4, caducidad: '2027-03-31' },
          { codigo: 'L2', cantidad: 6, caducidad: '2027-01-31' },
        ],
      },
      {
        articuloId: maq.id,
        cantidad: 2,
        costeUnitario: 900,
        lotes: [
          { codigo: 'SN-1', cantidad: 1 },
          { codigo: 'SN-2', cantidad: 1 },
        ],
      },
    ]);
    expect(ok.status).toBe(201);
    const movCem = ok.body.find(
      (m: { articuloId: string }) => m.articuloId === cem.id,
    );
    expect(
      movCem.lotes.map((l: { codigo: string; cantidad: number }) => [
        l.codigo,
        l.cantidad,
      ]),
    ).toEqual([
      ['L1', 4],
      ['L2', 6],
    ]);
    const dup = await entrada(
      [
        {
          articuloId: maq.id,
          cantidad: 1,
          costeUnitario: 900,
          lotes: [{ codigo: 'sn-1', cantidad: 1 }],
        },
      ],
      aux.id,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('BATCH_SERIAL_DUPLICATE');

    // Consumo a obra: el cemento sale por FEFO (L2 caduca antes); el vibrador, por serie indicada.
    const cons = (
      await api()
        .post('/almacen/consumos')
        .send({
          almacenId: cen.id,
          projectId: obra.id,
          fecha: '2026-03-10',
          lineas: [
            { articuloId: cem.id, cantidad: 7 },
            {
              articuloId: maq.id,
              cantidad: 1,
              lotes: [{ codigo: 'SN-2', cantidad: 1 }],
            },
          ],
        })
        .expect(201)
    ).body;
    const consCem = cons.find(
      (m: { articuloId: string }) => m.articuloId === cem.id,
    );
    expect(
      consCem.lotes.map((l: { codigo: string; cantidad: number }) => [
        l.codigo,
        l.cantidad,
      ]),
    ).toEqual([
      ['L1', -1],
      ['L2', -6],
    ]);
    const noHay = await api()
      .post('/almacen/consumos')
      .send({
        almacenId: cen.id,
        projectId: obra.id,
        fecha: '2026-03-10',
        lineas: [
          {
            articuloId: maq.id,
            cantidad: 1,
            lotes: [{ codigo: 'SN-2', cantidad: 1 }],
          },
        ],
      });
    expect(noHay.body.errorCode).toBe('BATCH_SERIAL_NOT_FOUND');

    // Devolución: solo lo que la obra consumió de cada lote.
    const excede = await api()
      .post('/almacen/devoluciones')
      .send({
        almacenId: cen.id,
        projectId: obra.id,
        fecha: '2026-03-11',
        lineas: [
          {
            articuloId: cem.id,
            cantidad: 2,
            lotes: [{ codigo: 'L1', cantidad: 2 }],
          },
        ],
      });
    expect(excede.body.errorCode).toBe('BATCH_SERIAL_RETURN_EXCEEDS');
    await api()
      .post('/almacen/devoluciones')
      .send({
        almacenId: cen.id,
        projectId: obra.id,
        fecha: '2026-03-11',
        lineas: [
          {
            articuloId: cem.id,
            cantidad: 2,
            lotes: [{ codigo: 'L2', cantidad: 2 }],
          },
        ],
      })
      .expect(201);

    // Traspaso CEN → AUX de 3 por FEFO: L2 (2) y L1 (1).
    const exist = (
      await api()
        .get(`/almacen/existencias?almacenId=${cen.id}&articuloId=${cem.id}`)
        .expect(200)
    ).body[0];
    const tr = (
      await api()
        .post('/almacen/traspasos')
        .set('If-Match', `"${exist.version}"`)
        .send({
          origenId: cen.id,
          destinoId: aux.id,
          articuloId: cem.id,
          cantidad: 3,
          fecha: '2026-03-12',
        })
        .expect(201)
    ).body;
    expect(
      tr.lotes
        .map((l: { codigo: string; cantidad: number; almacenId: string }) => [
          l.codigo,
          l.cantidad,
          l.almacenId === aux.id ? 'AUX' : 'CEN',
        ])
        .sort(),
    ).toEqual([
      ['L1', -1, 'CEN'],
      ['L1', 1, 'AUX'],
      ['L2', -2, 'CEN'],
      ['L2', 2, 'AUX'],
    ]);

    // Regularización en AUX: faltan 1 (FEFO: L2).
    const ea = (
      await api()
        .get(`/almacen/existencias?almacenId=${aux.id}&articuloId=${cem.id}`)
        .expect(200)
    ).body[0];
    const reg = (
      await api()
        .post('/almacen/regularizaciones')
        .set('If-Match', `"${ea.version}"`)
        .send({
          almacenId: aux.id,
          articuloId: cem.id,
          fecha: '2026-03-31',
          cantidadContada: 2,
          motivo: 'Recuento: saco roto',
        })
        .expect(201)
    ).body;
    expect(reg.lotes).toEqual([
      { codigo: 'L2', cantidad: -1, almacenId: aux.id },
    ]);

    // Existencia por lote coherente con la del artículo en cada almacén.
    const lotes = (
      await api().get(`/almacen/lotes?articuloId=${cem.id}`).expect(200)
    ).body;
    const resumen = lotes.map(
      (l: {
        codigo: string;
        cantidad: number;
        porAlmacen: { almacenCodigo: string; cantidad: number }[];
      }) => [
        l.codigo,
        l.cantidad,
        l.porAlmacen.map((p) => `${p.almacenCodigo}:${p.cantidad}`).join(','),
      ],
    );
    expect(resumen).toEqual([
      ['L1', 3, 'AUX:1,CEN:2'],
      ['L2', 1, 'AUX:1'],
    ]);
    const stock = (
      await api().get(`/almacen/existencias?articuloId=${cem.id}`).expect(200)
    ).body as { almacenId: string; cantidad: number }[];
    expect(stock.find((s) => s.almacenId === cen.id)!.cantidad).toBe(2);
    expect(stock.find((s) => s.almacenId === aux.id)!.cantidad).toBe(2);

    // Trazabilidad: dónde entró, por dónde pasó y qué obra lo consumió.
    const l2 = lotes.find((l: { codigo: string }) => l.codigo === 'L2');
    const traza = (await api().get(`/almacen/lotes/${l2.id}`).expect(200)).body;
    expect(traza.caducidad).toBe('2027-01-31');
    expect(
      traza.movimientos.map((m: { tipo: string; cantidad: number }) => [
        m.tipo,
        m.cantidad,
      ]),
    ).toEqual([
      ['entrada_compra', 6],
      ['salida_obra', -6],
      ['devolucion', 2],
      ['traspaso', -2],
      ['traspaso', 2],
      ['regularizacion', -1],
    ]);
    expect(traza.obras).toEqual([{ projectId: obra.id, cantidad: 4 }]);
    const sn = (
      await api().get(`/almacen/lotes?articuloId=${maq.id}`).expect(200)
    ).body;
    const sn2 = (
      await api()
        .get(
          `/almacen/lotes/${sn.find((l: { codigo: string }) => l.codigo === 'SN-2').id}`,
        )
        .expect(200)
    ).body;
    expect(sn2.obras).toEqual([{ projectId: obra.id, cantidad: 1 }]);
    expect(sn2.cantidad).toBe(0);

    // El seguimiento no cambia con existencias.
    const bloqueado = await api()
      .patch(`/almacen/articulos/${maq.id}`)
      .set('If-Match', `"${maq.version}"`)
      .send({ seguimiento: 'ninguno' });
    expect(bloqueado.status).toBe(409);
    expect(bloqueado.body.errorCode).toBe('BATCH_SERIAL_TRACKING_LOCKED');

    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('el devengo automático con alertas notifica una vez por conjunto de alertas', async () => {
    await api()
      .post('/avales')
      .send({
        referencia: `AV-${u()}`,
        tipo: 'anticipo',
        direccion: 'emitido',
        entidad: 'Banco Notifica',
        importe: 100_000,
        fechaEmision: '2026-08-01',
        tasaComisionAnualPct: 1,
      })
      .expect(201);
    await api().post('/contabilidad/periodos/2026/10/cerrar').expect(200);
    const r1 = (
      await api()
        .post('/avales/devengos/automatico')
        .send({ fechaReferencia: '2026-11-15' })
        .expect(200)
    ).body;
    expect(r1.alertas).toBe(1);
    const notifs = async () =>
      (await api().get('/alerts/notifications').expect(200)).body as
        | { items?: { title: string; body: string; link: string }[] }
        | { title: string; body: string; link: string }[];
    const lista = (n: Awaited<ReturnType<typeof notifs>>) =>
      (Array.isArray(n) ? n : (n.items ?? [])).filter((x) =>
        x.title.startsWith('Devengo de avales'),
      );
    const n1 = lista(await notifs());
    expect(n1).toHaveLength(1);
    expect(n1[0].body).toContain('2026-10');
    expect(n1[0].link).toBe('/avales');
    // Mismas alertas (tarea programada): no se repite la notificación.
    await app.get(DevengoSchedulerService).handleCron('2026-11-15');
    expect(lista(await notifs())).toHaveLength(1);
    // Sin alertas tras reabrir: tampoco notifica.
    await api().post('/contabilidad/periodos/2026/10/reabrir').expect(200);
    const r3 = (
      await api()
        .post('/avales/devengos/automatico')
        .send({ fechaReferencia: '2026-11-15' })
        .expect(200)
    ).body;
    expect(r3.alertas).toBe(0);
    expect(lista(await notifs())).toHaveLength(1);
  });
});
