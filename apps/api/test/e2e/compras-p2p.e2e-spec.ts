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
 * Fase 3, Procure-to-Pay: solicitud de compra → petición de ofertas →
 * adjudicación por línea → pedidos → recepción parcial y total (con lotes en
 * almacén) → facturas con cuadre a tres bandas por línea (tolerancias,
 * bloqueo, factura directa contra pedido) y comprometido sin duplicar.
 */
describe('Procure-to-Pay: PR → RFQ → PO → recepción → 3-way match (integración)', () => {
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

  async function base() {
    const obra = await createProject(app, token);
    const a = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Áridos A SL',
    });
    const b = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Bombeos B SL',
    });
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
    const almacen = (
      await api()
        .post('/almacen/almacenes')
        .send({ codigo: 'CEN', nombre: 'Central', tipo: 'central' })
        .expect(201)
    ).body;
    return { obra, a, b, cem, almacen };
  }

  async function solicitudAprobada(projectId: string, articuloId: string) {
    const sc = (
      await api()
        .post('/compras/solicitudes')
        .set('Idempotency-Key', `sc-${u()}`)
        .send({
          projectId,
          titulo: 'Hormigonado de forjado',
          enviar: true,
          lineas: [
            {
              tipo: 'material',
              articuloId,
              descripcion: 'Cemento CEM II',
              unidad: 'saco',
              cantidad: 100,
              precioEstimado: 6,
            },
            {
              tipo: 'servicio',
              descripcion: 'Bombeo de hormigón',
              cantidad: 1,
              precioEstimado: 900,
            },
          ],
        })
        .expect(201)
    ).body;
    const gerente = await createUserWithRole(app, token, 'gerente');
    const ap = (
      await authed(app, gerente.accessToken)
        .post(`/compras/solicitudes/${sc.id}/aprobar`)
        .set('If-Match', `"${sc.version}"`)
        .expect(200)
    ).body;
    return { sc, ap };
  }

  it('circuito completo: ofertas, adjudicación por línea, recepciones, cuadre por línea y comprometido', async () => {
    const { obra, a, b, cem, almacen } = await base();
    const { sc, ap } = await solicitudAprobada(obra.id, cem.id);
    expect(sc).toMatchObject({ estado: 'solicitada', importeEstimado: 1500 });
    expect(sc.numero).toMatch(/^SC-.+-0001$/);
    expect(ap.estado).toBe('aprobada');

    // Petición de ofertas a A y B.
    const pet = (
      await api()
        .post(`/compras/solicitudes/${sc.id}/peticion`)
        .set('Idempotency-Key', `pet-${u()}`)
        .set('If-Match', `"${ap.version}"`)
        .send({ proveedores: [a.id, b.id], fechaLimite: '2026-12-15' })
        .expect(201)
    ).body;
    expect(pet.estado).toBe('abierta');
    expect(
      (await api().get(`/compras/solicitudes/${sc.id}`).expect(200)).body,
    ).toMatchObject({ estado: 'convertida', peticionId: pet.id });
    const [lCem, lBombeo] = pet.lineas;
    const otro = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'No invitado SL',
    });
    const noInv = await api()
      .post(`/compras/peticiones/${pet.id}/ofertas`)
      .send({
        contactId: otro.id,
        precios: [{ lineaId: lCem.id, precioUnitario: 1 }],
      });
    expect(noInv.body.errorCode).toBe('P2P_RFQ_SUPPLIER_NOT_INVITED');
    await api()
      .post(`/compras/peticiones/${pet.id}/ofertas`)
      .send({
        contactId: a.id,
        plazoDias: 5,
        validaHasta: '2099-12-31',
        precios: [
          { lineaId: lCem.id, precioUnitario: 5.9 },
          { lineaId: lBombeo.id, precioUnitario: 950 },
        ],
      })
      .expect(200);
    const conOfertas = (
      await api()
        .post(`/compras/peticiones/${pet.id}/ofertas`)
        .send({
          contactId: b.id,
          plazoDias: 3,
          precios: [
            { lineaId: lCem.id, precioUnitario: 6.1 },
            { lineaId: lBombeo.id, precioUnitario: 850 },
          ],
        })
        .expect(200)
    ).body;
    const cmp = conOfertas.comparativa;
    expect(
      cmp.lineas.map((l: { mejor: { contactId: string; importe: number } }) => [
        l.mejor.contactId,
        l.mejor.importe,
      ]),
    ).toEqual([
      [a.id, 590],
      [b.id, 850],
    ]);
    expect(cmp.mejorCompleta).toBe(b.id); // 610 + 850 = 1.460 < 590 + 950 = 1.540
    expect(cmp.totalMejorPorLinea).toBe(1440);

    // Adjudicación por línea: cemento a A, bombeo a B → dos pedidos.
    const adj = (
      await api()
        .post(`/compras/peticiones/${pet.id}/adjudicar`)
        .set('Idempotency-Key', `adj-${u()}`)
        .set('If-Match', `"${conOfertas.version}"`)
        .send({
          fecha: '2026-11-20',
          porLinea: [
            { lineaId: lCem.id, contactId: a.id },
            { lineaId: lBombeo.id, contactId: b.id },
          ],
        })
        .expect(200)
    ).body;
    expect(adj.estado).toBe('adjudicada');
    expect(adj.pedidos).toHaveLength(2);
    const pedidos = await Promise.all(
      adj.pedidos.map(
        async (id: string) =>
          (await api().get(`/compras/pedidos/${id}`).expect(200)).body,
      ),
    );
    const poA = pedidos.find((p) => p.contactId === a.id)!;
    const poB = pedidos.find((p) => p.contactId === b.id)!;
    expect(poA).toMatchObject({
      importe: 590,
      peticionId: pet.id,
      solicitudId: sc.id,
      estado: 'emitido',
    });
    expect(poA.lineas[0]).toMatchObject({
      tipo: 'material',
      articuloId: cem.id,
      cantidad: 100,
      precioUnitario: 5.9,
      exigeRecepcion: true,
    });
    expect(poB.lineas[0]).toMatchObject({
      tipo: 'servicio',
      precioUnitario: 850,
      exigeRecepcion: false,
    });

    // Recepción parcial con lote en almacén: 40 sacos.
    const r1 = (
      await api()
        .post(`/compras/pedidos/${poA.id}/recepciones`)
        .set('Idempotency-Key', `gr-${u()}`)
        .send({
          fecha: '2026-11-21',
          albaranNumero: 'ALB-A-1',
          almacenId: almacen.id,
          lineas: [
            {
              lineaId: poA.lineas[0].id,
              cantidad: 40,
              lotes: [{ codigo: 'L1', cantidad: 40, caducidad: '2027-06-30' }],
            },
          ],
        })
        .expect(201)
    ).body;
    expect(r1.estado).toBe('servido_parcial');
    expect(r1.lineas[0]).toMatchObject({
      recibida: '40.000',
      pendienteRecibir: '60.000',
      pendienteFacturar: '40.000',
      recibidoSinFacturar: 236,
    });
    expect(r1.recepciones[0]).toMatchObject({
      albaranNumero: 'ALB-A-1',
      importe: 236,
    });
    expect(r1.recepciones[0].lineas[0].movimientoStockId).toEqual(
      expect.any(String),
    );
    const exist = (
      await api().get(`/almacen/existencias?articuloId=${cem.id}`).expect(200)
    ).body;
    expect(exist[0]).toMatchObject({ cantidad: 40, pmp: 5.9 });
    const lotes = (
      await api().get(`/almacen/lotes?articuloId=${cem.id}`).expect(200)
    ).body;
    expect(lotes[0]).toMatchObject({ codigo: 'L1', cantidad: 40 });
    const excede = await api()
      .post(`/compras/pedidos/${poA.id}/recepciones`)
      .send({
        fecha: '2026-11-21',
        albaranNumero: 'ALB-A-X',
        almacenId: almacen.id,
        lineas: [
          {
            lineaId: poA.lineas[0].id,
            cantidad: 61,
            lotes: [{ codigo: 'L2', cantidad: 61 }],
          },
        ],
      });
    expect(excede.body.errorCode).toBe('P2P_RECEIPT_EXCEEDS_ORDER');

    // Factura de 50 (solo hay 40 recibidos): bloqueada por cantidad.
    const f50 = (
      await api()
        .post(`/compras/pedidos/${poA.id}/factura`)
        .set('Idempotency-Key', `f-${u()}`)
        .send({
          invoiceNumber: `FA-${u()}`,
          issueDate: '2026-11-22',
          lineas: [
            { lineaId: poA.lineas[0].id, cantidad: 50, precioUnitario: 5.9 },
          ],
        })
        .expect(201)
    ).body;
    expect(f50.cuadre).toMatchObject({ bloqueada: true });
    expect(f50.cuadre.lineas[0].motivos[0].codigo).toBe(
      'P2P_MATCH_QUANTITY_VARIANCE',
    );
    const bloqueo = await api().post(`/invoices/${f50.factura.id}/aprobar`);
    expect(bloqueo.status).toBe(409);
    expect(bloqueo.body.errorCode).toBe('P2P_MATCH_BLOCKED');
    expect(bloqueo.headers['content-type']).toContain(
      'application/problem+json',
    );
    // 40 a 6,10 (+3,4 %): bloqueada por precio.
    const fCara = (
      await api()
        .post(`/compras/pedidos/${poA.id}/factura`)
        .send({
          invoiceNumber: `FA-${u()}`,
          issueDate: '2026-11-22',
          lineas: [
            { lineaId: poA.lineas[0].id, cantidad: 40, precioUnitario: 6.1 },
          ],
        })
        .expect(201)
    ).body;
    expect(fCara.cuadre.lineas[0].motivos[0].codigo).toBe(
      'P2P_MATCH_PRICE_VARIANCE',
    );
    // 40 a 5,95 (+0,85 %, 2 €): dentro de tolerancia → se aprueba.
    const fOk = (
      await api()
        .post(`/compras/pedidos/${poA.id}/factura`)
        .send({
          invoiceNumber: `FA-${u()}`,
          issueDate: '2026-11-22',
          lineas: [
            { lineaId: poA.lineas[0].id, cantidad: 40, precioUnitario: 5.95 },
          ],
        })
        .expect(201)
    ).body;
    expect(fOk.cuadre).toMatchObject({ bloqueada: false });
    expect(fOk.cuadre.lineas[0]).toMatchObject({
      estado: 'cuadra',
      sobreprecio: 2,
    });
    await api().post(`/invoices/${fOk.factura.id}/aprobar`).expect(201);
    // Ya facturado lo recibido: la factura de 50 sigue bloqueada (40 + 50 > 40).
    expect(
      (
        await api()
          .get(`/compras/facturas/${f50.factura.id}/cuadre`)
          .expect(200)
      ).body.lineas[0].facturadaPrevia,
    ).toBe('40.000');

    // Factura directa contra el pedido del servicio (sin recepción).
    const fB = (
      await api()
        .post(`/compras/pedidos/${poB.id}/factura`)
        .send({
          invoiceNumber: `FB-${u()}`,
          issueDate: '2026-11-22',
          lineas: [
            { lineaId: poB.lineas[0].id, cantidad: 1, precioUnitario: 850 },
          ],
        })
        .expect(201)
    ).body;
    expect(fB.cuadre.bloqueada).toBe(false);
    await api().post(`/invoices/${fB.factura.id}/aprobar`).expect(201);

    // Comprometido sin duplicar: (590 − 238) + (850 − 850) = 352.
    const m = (await api().get(`/projects/${obra.id}/margenes`).expect(200))
      .body;
    expect(m.obra.comprometidoDesglose.pedidos).toBe(352);
    const dtoA = (await api().get(`/purchase-orders/${poA.id}`).expect(200))
      .body;
    expect(dtoA.invoicedAmount).toBe(238);

    // El mismo número de albarán del proveedor no se registra dos veces.
    const dup = await api()
      .post(`/compras/pedidos/${poA.id}/recepciones`)
      .send({
        fecha: '2026-11-23',
        albaranNumero: 'ALB-A-1',
        almacenId: almacen.id,
        lineas: [
          {
            lineaId: poA.lineas[0].id,
            cantidad: 1,
            lotes: [{ codigo: 'L9', cantidad: 1 }],
          },
        ],
      });
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('DELIVERY_NOTE_NUMBER_DUPLICATE');
    // Recepción del resto y su factura: el pedido queda servido y facturado por línea.
    const r2 = (
      await api()
        .post(`/compras/pedidos/${poA.id}/recepciones`)
        .send({
          fecha: '2026-11-23',
          albaranNumero: 'ALB-A-2',
          almacenId: almacen.id,
          lineas: [
            {
              lineaId: poA.lineas[0].id,
              cantidad: 60,
              lotes: [{ codigo: 'L2', cantidad: 60 }],
            },
          ],
        })
        .expect(201)
    ).body;
    expect(r2.estado).toBe('servido');
    const mas = await api()
      .post(`/compras/pedidos/${poA.id}/recepciones`)
      .send({
        fecha: '2026-11-23',
        albaranNumero: 'ALB-A-3',
        lineas: [{ lineaId: poA.lineas[0].id, cantidad: 1 }],
      });
    expect(mas.body.errorCode).toBe('P2P_RECEIPT_EXCEEDS_ORDER');
    const fResto = (
      await api()
        .post(`/compras/pedidos/${poA.id}/factura`)
        .send({
          invoiceNumber: `FA-${u()}`,
          issueDate: '2026-11-24',
          lineas: [
            { lineaId: poA.lineas[0].id, cantidad: 60, precioUnitario: 5.9 },
          ],
        })
        .expect(201)
    ).body;
    await api().post(`/invoices/${fResto.factura.id}/aprobar`).expect(201);
    const final = (await api().get(`/compras/pedidos/${poA.id}`).expect(200))
      .body;
    expect(final.lineas[0]).toMatchObject({
      recibida: '100.000',
      facturada: '100.000',
      pendienteFacturar: '0.000',
      importeFacturado: 592,
    });
    expect(
      final.facturas.filter((f: { estado: string }) => f.estado === 'aprobada'),
    ).toHaveLength(2);

    // Mezclar albaranes y líneas de pedido en una factura: rechazado.
    const mixta = await api()
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: a.id,
        invoiceNumber: `MX-${u()}`,
        issueDate: '2026-11-24',
        deliveryNoteIds: [final.recepciones[0].albaranId],
        lines: [
          {
            description: 'Mixta',
            baseAmount: 5.9,
            vatPct: 21,
            projectId: obra.id,
            purchaseOrderLineId: poA.lineas[0].id,
            quantity: 1,
            unitPrice: 5.9,
          },
        ],
      });
    expect(mixta.status).toBe(422);
    expect(mixta.body.errorCode).toBe('P2P_MATCH_MIXED');
    const descuadre = await api()
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: a.id,
        invoiceNumber: `DQ-${u()}`,
        issueDate: '2026-11-24',
        lines: [
          {
            description: 'Base mal',
            baseAmount: 10,
            vatPct: 21,
            projectId: obra.id,
            purchaseOrderLineId: poA.lineas[0].id,
            quantity: 1,
            unitPrice: 5.9,
          },
        ],
      });
    expect(descuadre.body.errorCode).toBe('P2P_LINE_AMOUNT_MISMATCH');
    const otroProv = await api()
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: b.id,
        invoiceNumber: `OP-${u()}`,
        issueDate: '2026-11-24',
        lines: [
          {
            description: 'Otro',
            baseAmount: 5.9,
            vatPct: 21,
            projectId: obra.id,
            purchaseOrderLineId: poA.lineas[0].id,
            quantity: 1,
            unitPrice: 5.9,
          },
        ],
      });
    expect(otroProv.body.errorCode).toBe('P2P_MATCH_OTHER_SUPPLIER');

    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('segregación, rechazo, idempotencia, versión y acceso por obra', async () => {
    const { obra, a, cem } = await base();
    const crear = (clave: string) =>
      api()
        .post('/compras/solicitudes')
        .set('Idempotency-Key', clave)
        .send({
          projectId: obra.id,
          titulo: 'Ferralla',
          lineas: [
            {
              tipo: 'material',
              articuloId: cem.id,
              descripcion: 'Cemento',
              cantidad: 10,
            },
          ],
        });
    const clave = `sc-${u()}`;
    const s1 = (await crear(clave).expect(201)).body;
    const s2 = (await crear(clave).expect(201)).body;
    expect(s2.id).toBe(s1.id);
    expect(s1.estado).toBe('borrador');
    const enviada = (
      await api()
        .post(`/compras/solicitudes/${s1.id}/enviar`)
        .set('If-Match', `"${s1.version}"`)
        .expect(200)
    ).body;
    // Quien solicita no aprueba.
    const propia = await api()
      .post(`/compras/solicitudes/${s1.id}/aprobar`)
      .set('If-Match', `"${enviada.version}"`);
    expect(propia.status).toBe(403);
    expect(propia.body.errorCode).toBe('P2P_SOD_SELF_APPROVAL');
    const gerente = await createUserWithRole(app, token, 'gerente');
    const vieja = await authed(app, gerente.accessToken)
      .post(`/compras/solicitudes/${s1.id}/rechazar`)
      .set('If-Match', `"${s1.version}"`)
      .send({ motivo: 'Sin presupuesto' });
    expect(vieja.status).toBe(409);
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const rech = (
      await authed(app, gerente.accessToken)
        .post(`/compras/solicitudes/${s1.id}/rechazar`)
        .set('If-Match', `"${enviada.version}"`)
        .send({ motivo: 'Sin presupuesto' })
        .expect(200)
    ).body;
    expect(rech).toMatchObject({
      estado: 'rechazada',
      motivoRechazo: 'Sin presupuesto',
    });
    const conv = await api()
      .post(`/compras/solicitudes/${s1.id}/pedido`)
      .send({ contactId: a.id, fecha: '2026-11-20' });
    expect(conv.status).toBe(409);
    expect(conv.body.errorCode).toBe('P2P_REQUISITION_NOT_APPROVED');

    // Pedido directo con líneas y tolerancia propia; servicio facturado contra pedido.
    const po = (
      await api()
        .post('/compras/pedidos')
        .set('Idempotency-Key', `po-${u()}`)
        .send({
          projectId: obra.id,
          contactId: a.id,
          fecha: '2026-11-20',
          descripcion: 'Alquiler de grúa',
          toleranciaPrecioPct: 0,
          lineas: [
            {
              tipo: 'servicio',
              descripcion: 'Grúa noviembre',
              unidad: 'mes',
              cantidad: 1,
              precioUnitario: 1200,
            },
          ],
        })
        .expect(201)
    ).body;
    expect(po).toMatchObject({
      importe: 1200,
      tolerancias: { precioPct: 0, precioImporte: 50, cantidadPct: 0 },
    });
    const f = (
      await api()
        .post(`/compras/pedidos/${po.id}/factura`)
        .send({
          invoiceNumber: `FG-${u()}`,
          issueDate: '2026-11-25',
          lineas: [
            { lineaId: po.lineas[0].id, cantidad: 1, precioUnitario: 1200.01 },
          ],
        })
        .expect(201)
    ).body;
    // Tolerancia de precio 0 %: un céntimo de más bloquea.
    expect(f.cuadre.lineas[0].motivos[0].codigo).toBe(
      'P2P_MATCH_PRICE_VARIANCE',
    );
    const sinLineas = await api()
      .post(`/compras/pedidos/${po.id}/recepciones`)
      .send({
        fecha: '2026-11-20',
        albaranNumero: 'X',
        lineas: [{ lineaId: po.id, cantidad: 1 }],
      });
    expect(sinLineas.body.errorCode).toBe('P2P_LINE_NOT_FOUND');

    // Acceso por obra: el jefe de obra sin esa obra no la ve ni crea en ella;
    // con la obra, solicita y recibe, pero no aprueba ni emite pedidos.
    const ajeno = await createObraUser(app, token, []);
    const obraAjena = authed(app, ajeno.tokens.accessToken);
    expect(
      (await obraAjena.get('/compras/solicitudes').expect(200)).body,
    ).toEqual([]);
    const prohibida = await authed(app, ajeno.tokens.accessToken)
      .post('/compras/solicitudes')
      .send({
        projectId: obra.id,
        titulo: 'Ajena',
        lineas: [{ tipo: 'gasto', descripcion: 'x', cantidad: 1 }],
      });
    expect(prohibida.status).toBe(404);
    const jefe = await createObraUser(app, token, [obra.id]);
    const jefeApi = () => authed(app, jefe.tokens.accessToken);
    const suya = (
      await jefeApi()
        .post('/compras/solicitudes')
        .send({
          projectId: obra.id,
          titulo: 'Material de obra',
          enviar: true,
          lineas: [
            {
              tipo: 'gasto',
              descripcion: 'Andamios',
              cantidad: 1,
              precioEstimado: 300,
            },
          ],
        })
        .expect(201)
    ).body;
    expect(suya.estado).toBe('solicitada');
    await jefeApi().post(`/compras/solicitudes/${suya.id}/aprobar`).expect(403);
    await jefeApi()
      .post('/compras/pedidos')
      .send({
        projectId: obra.id,
        contactId: a.id,
        fecha: '2026-11-20',
        descripcion: 'x',
        lineas: [
          { tipo: 'gasto', descripcion: 'x', cantidad: 1, precioUnitario: 1 },
        ],
      })
      .expect(403);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get(`/compras/pedidos/${po.id}`)
      .expect(200);
    await authed(app, lector.accessToken)
      .post('/compras/solicitudes')
      .send({})
      .expect(403);

    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });
});
