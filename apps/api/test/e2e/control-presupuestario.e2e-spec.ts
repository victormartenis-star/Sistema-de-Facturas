import { INestApplication } from '@nestjs/common';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Control presupuestario activo y cuadro de márgenes: consolidación exacta de
 * presupuestado, comprometido (sin doble conteo con lo facturado), coste real
 * con almacén y amortización imputada, certificado/facturado/cobrado, filtros
 * por fechas, modos aviso y bloqueo (`BUDGET_EXCEEDED`, RFC 7807), auditoría
 * con la cadena íntegra, concurrencia y acceso por obra.
 */
describe('Control presupuestario y márgenes (integración)', () => {
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

  /** Obra con contrato de 20.000 € y presupuesto activo de 10.000 €. */
  async function obraConPresupuesto() {
    const obra = await createProject(app, token, {
      code: `OB-${u()}`,
      contractAmount: 20_000,
    });
    const budget = await createBudget(app, token, obra.id);
    await addBudgetItem(app, token, budget.id, {
      unitPrice: 10,
      quantity: 1000,
    });
    await activateBudget(app, token, budget.id);
    const proveedor = await createContact(app, token, {
      kind: 'proveedor',
      legalName: `Suministros ${u()} SL`,
    });
    return { obraId: obra.id, proveedorId: proveedor.id };
  }

  const pedido = (projectId: string, contactId: string, amount: number) =>
    api().post('/purchase-orders').send({
      projectId,
      contactId,
      orderDate: '2026-03-02',
      description: 'Suministro',
      amount,
    });

  async function almacenConStock(cantidad = 100, coste = 10) {
    const al = await api()
      .post('/almacen/almacenes')
      .send({
        codigo: `C-${u()}`.slice(0, 20),
        nombre: 'Central',
        tipo: 'central',
      })
      .expect(201);
    const art = await api()
      .post('/almacen/articulos')
      .send({ codigo: `ART-${u()}`.slice(0, 30), nombre: 'Árido', unidad: 't' })
      .expect(201);
    await api()
      .post('/almacen/entradas')
      .send({
        almacenId: al.body.id,
        fecha: '2026-03-01',
        lineas: [{ articuloId: art.body.id, cantidad, costeUnitario: coste }],
      })
      .expect(201);
    return {
      almacenId: al.body.id as string,
      articuloId: art.body.id as string,
    };
  }

  const consumo = (
    almacenId: string,
    projectId: string,
    articuloId: string,
    cantidad: number,
  ) =>
    api()
      .post('/almacen/consumos')
      .send({
        almacenId,
        projectId,
        fecha: '2026-03-10',
        lineas: [{ articuloId, cantidad }],
      });

  const configurar = (
    projectId: string,
    body: Record<string, unknown>,
    version?: number,
  ) => {
    const r = api().put(`/projects/${projectId}/control-presupuestario`);
    if (version !== undefined) r.set('If-Match', `"${version}"`);
    return r.send(body);
  };

  it('consolida presupuesto, comprometido, coste real (compras, almacén y amortización), facturado y cobrado', async () => {
    const { obraId, proveedorId } = await obraConPresupuesto();

    // Pedido de 2.000 con un albarán de 800 ya facturado → comprometido 1.200.
    const ped = await pedido(obraId, proveedorId, 2000).expect(201);
    const alb = await api()
      .post('/delivery-notes')
      .send({
        contactId: proveedorId,
        orderId: ped.body.id,
        noteNumber: `ALB-${u()}`,
        noteDate: '2026-03-05',
        amount: 800,
      })
      .expect(201);
    await api().post(`/delivery-notes/${alb.body.id}/validar`).expect(201);
    const fc = await api()
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: proveedorId,
        invoiceNumber: `FC-${u()}`,
        issueDate: '2026-03-06',
        deliveryNoteIds: [alb.body.id],
        lines: [
          {
            description: 'Material',
            baseAmount: 800,
            vatPct: 21,
            projectId: obraId,
          },
        ],
      })
      .expect(201);
    await api().post(`/invoices/${fc.body.id}/aprobar`).expect(201);

    // Almacén: consumo 30 t a 10 € y devolución de 5 t → 250 €.
    const st = await almacenConStock();
    await consumo(st.almacenId, obraId, st.articuloId, 30).expect(201);
    await api()
      .post('/almacen/devoluciones')
      .send({
        almacenId: st.almacenId,
        projectId: obraId,
        fecha: '2026-03-12',
        lineas: [{ articuloId: st.articuloId, cantidad: 5 }],
      })
      .expect(201);

    // Activo de 1.200 € a 12 meses imputado a la obra: dos cuotas = 200 €.
    await api()
      .post('/activos')
      .send({
        codigo: 'AF-1',
        nombre: 'Dumper',
        categoria: 'maquinaria',
        projectId: obraId,
        fechaAdquisicion: '2026-01-01',
        fechaInicio: '2026-01-01',
        coste: 1200,
        vidaUtilMeses: 12,
      })
      .expect(201);
    await api()
      .post('/activos/amortizar')
      .send({ hasta: '2026-02' })
      .expect(200);

    // Venta de 1.000 + IVA cobrada a medias → facturado 1.000, cobrado 500 en base.
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const fv = await api()
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-${u()}`,
        issueDate: '2026-03-20',
        dueDate: '2026-04-20',
        lines: [
          {
            description: 'Cert. 1',
            baseAmount: 1000,
            vatPct: 21,
            projectId: obraId,
          },
        ],
      })
      .expect(201);
    await api().post(`/invoices/${fv.body.id}/aprobar`).expect(201);
    const venc = (
      await api().get('/treasury/milestones?direction=cobro')
    ).body.find((m: { invoiceId: string }) => m.invoiceId === fv.body.id);
    await api()
      .post(`/treasury/milestones/${venc.id}/liquidaciones`)
      .send({ importe: 605, fecha: '2026-03-25' })
      .expect(201);

    const r = await api().get(`/projects/${obraId}/margenes`).expect(200);
    expect(r.body.obra).toMatchObject({
      contrato: 20000,
      presupuestado: 10000,
      comprometido: 1200,
      comprometidoDesglose: { pedidos: 1200, subcontratas: 0 },
      costeReal: 1250,
      costeRealDesglose: {
        facturasCompra: 800,
        almacen: 250,
        amortizacion: 200,
        partesPersonal: 0,
        partesMaquinaria: 0,
      },
      consumido: 2450,
      desviacion: 7550,
      consumoPct: 24.5,
      margenPrevisto: 10000,
      facturado: 1000,
      cobrado: 500,
      pendienteCobro: 500,
      control: { modo: 'observacion', estado: 'ok' },
    });
    // El desglose por partida suma lo mismo que la obra.
    const consumidoPartidas = r.body.partidas.reduce(
      (s: number, p: { consumido: number }) =>
        s + Math.round(p.consumido * 100),
      0,
    );
    expect(consumidoPartidas).toBe(245000);

    const cartera = await api().get('/cost-control/margenes').expect(200);
    expect(cartera.body.obras).toHaveLength(1);
    expect(cartera.body.totales).toMatchObject({
      costeReal: 1250,
      consumido: 2450,
    });

    // Con rango de fechas: solo los flujos de febrero (la cuota de amortización).
    const feb = await api()
      .get(`/projects/${obraId}/margenes?desde=2026-02-01&hasta=2026-02-28`)
      .expect(200);
    expect(feb.body.obra).toMatchObject({
      costeReal: 100,
      costeRealDesglose: { amortizacion: 100, almacen: 0, facturasCompra: 0 },
      comprometido: 1200,
      facturado: 0,
      cobrado: 0,
    });
  });

  it('modo bloqueo: rechaza pedidos y consumos que exceden con BUDGET_EXCEEDED y audita el rechazo', async () => {
    const { obraId, proveedorId } = await obraConPresupuesto();
    await configurar(obraId, { modo: 'bloqueo', toleranciaPct: 0 }).expect(200);

    const excede = await pedido(obraId, proveedorId, 10000.01);
    expect(excede.status).toBe(422);
    expect(excede.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(excede.body).toMatchObject({
      errorCode: 'BUDGET_EXCEEDED',
      presupuestado: 10000,
      limite: 10000,
      consumido: 0,
      importe: 10000.01,
      exceso: 0.01,
    });
    expect(excede.body.correlationId).toEqual(expect.any(String));
    expect((await api().get('/purchase-orders')).body).toHaveLength(0);

    await pedido(obraId, proveedorId, 9900).expect(201);
    const st = await almacenConStock();
    const c = await consumo(st.almacenId, obraId, st.articuloId, 11); // 110 €
    expect(c.status).toBe(422);
    expect(c.body.errorCode).toBe('BUDGET_EXCEEDED');
    // El consumo rechazado no movió stock.
    const ex = await api()
      .get(`/almacen/existencias?almacenId=${st.almacenId}`)
      .expect(200);
    expect(ex.body[0].cantidad).toBe(100);
    await consumo(st.almacenId, obraId, st.articuloId, 10).expect(201); // justo al límite

    const estado = await api()
      .get(`/projects/${obraId}/control-presupuestario`)
      .expect(200);
    expect(estado.body.evaluacion).toMatchObject({
      estado: 'aviso',
      consumido: 10000,
      disponible: 0,
    });
    const bloqueos = estado.body.eventos.filter(
      (e: { evento: string }) => e.evento === 'bloqueo',
    );
    expect(bloqueos).toHaveLength(2);
    expect(
      bloqueos.map((b: { operacion: string }) => b.operacion).sort(),
    ).toEqual(['consumo_almacen', 'pedido_compra']);

    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('modo bloqueo: ampliar un pedido abierto por encima del límite se rechaza', async () => {
    const { obraId, proveedorId } = await obraConPresupuesto();
    await configurar(obraId, { modo: 'bloqueo', toleranciaPct: 10 }).expect(
      200,
    );
    const p = await pedido(obraId, proveedorId, 10000).expect(201);
    const amplia = await api()
      .patch(`/purchase-orders/${p.body.id}`)
      .set('If-Match', `"${p.body.version}"`)
      .send({ amount: 11000.01 });
    expect(amplia.status).toBe(422);
    expect(amplia.body).toMatchObject({
      errorCode: 'BUDGET_EXCEEDED',
      limite: 11000,
    });
    await api()
      .patch(`/purchase-orders/${p.body.id}`)
      .set('If-Match', `"${p.body.version}"`)
      .send({ amount: 11000 })
      .expect(200);
  });

  it('modo aviso: permite el exceso, lo audita y lo avisa en X-Budget-Warning', async () => {
    const { obraId, proveedorId } = await obraConPresupuesto();
    await configurar(obraId, { modo: 'aviso' }).expect(200);
    const r = await pedido(obraId, proveedorId, 12000).expect(201);
    expect(r.headers['x-budget-warning']).toContain('BUDGET_EXCEEDED');
    expect(r.headers['x-budget-warning']).toContain('exceso=2000');

    const cuadro = await api()
      .get('/cost-control/margenes?soloAlertas=true')
      .expect(200);
    expect(cuadro.body.obras).toEqual([
      expect.objectContaining({
        projectId: obraId,
        desviacion: -2000,
        control: expect.objectContaining({ modo: 'aviso', estado: 'excedido' }),
      }),
    ]);
    const estado = await api()
      .get(`/projects/${obraId}/control-presupuestario`)
      .expect(200);
    expect(estado.body.eventos[0]).toMatchObject({
      evento: 'aviso',
      operacion: 'pedido_compra',
      exceso: 2000,
    });
  });

  it('configuración: If-Match tras el alta, conflicto de versión, validación y roles', async () => {
    const { obraId } = await obraConPresupuesto();
    const alta = await configurar(obraId, {
      modo: 'aviso',
      toleranciaPct: 5,
    }).expect(200);
    expect(alta.body.config).toMatchObject({
      modo: 'aviso',
      toleranciaPct: 5,
      version: 1,
    });

    const sinVersion = await configurar(obraId, { modo: 'bloqueo' });
    expect(sinVersion.status).toBe(428);
    const vieja = await configurar(obraId, { modo: 'bloqueo' }, 7);
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    await configurar(obraId, { modo: 'bloqueo' }, 1).expect(200);
    const mala = await configurar(
      obraId,
      { modo: 'bloqueo', toleranciaPct: 120 },
      2,
    );
    expect(mala.status).toBe(400);

    const jefe = await createObraUser(app, token, [obraId]);
    await authed(app, jefe.tokens.accessToken)
      .put(`/projects/${obraId}/control-presupuestario`)
      .set('If-Match', '"2"')
      .send({ modo: 'observacion' })
      .expect(403);
    await authed(app, jefe.tokens.accessToken)
      .get(`/projects/${obraId}/margenes`)
      .expect(200);
  });

  it('acceso por obra: el rol obra solo ve sus obras en el cuadro', async () => {
    const a = await obraConPresupuesto();
    const b = await obraConPresupuesto();
    const jefe = await createObraUser(app, token, [a.obraId]);
    const cuadro = await authed(app, jefe.tokens.accessToken)
      .get('/cost-control/margenes')
      .expect(200);
    expect(
      cuadro.body.obras.map((o: { projectId: string }) => o.projectId),
    ).toEqual([a.obraId]);
    const ajena = await authed(app, jefe.tokens.accessToken).get(
      `/projects/${b.obraId}/margenes`,
    );
    expect(ajena.status).toBe(404);
    expect(ajena.body.errorCode).toBe('PROJECT_NOT_FOUND');
  });

  it('pedidos concurrentes en modo bloqueo: no pasan ambos', async () => {
    const { obraId, proveedorId } = await obraConPresupuesto();
    await configurar(obraId, { modo: 'bloqueo' }).expect(200);
    const res = await Promise.all([
      pedido(obraId, proveedorId, 6000),
      pedido(obraId, proveedorId, 6000),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 422]);
  });
});
