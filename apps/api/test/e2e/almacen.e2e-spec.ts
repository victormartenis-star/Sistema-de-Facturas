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
 * Almacén y stock: valoración a PMP exacta, recepción de albarán (una sola
 * vez), consumo imputado a obra con asiento PGC, traspaso atómico,
 * regularización, devolución, períodos cerrados, concurrencia, idempotencia,
 * RFC 7807 y acceso por obra.
 */
describe('Almacén y stock (integración)', () => {
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

  async function base() {
    const obra = await createProject(app, token, { code: 'OB-1' });
    const central = await api()
      .post('/almacen/almacenes')
      .send({ codigo: 'CEN', nombre: 'Central', tipo: 'central' })
      .expect(201);
    const acopio = await api()
      .post('/almacen/almacenes')
      .send({
        codigo: 'ACO-1',
        nombre: 'Acopio obra 1',
        tipo: 'obra',
        projectId: obra.id,
      })
      .expect(201);
    const cemento = await api()
      .post('/almacen/articulos')
      .send({ codigo: 'CEM-42', nombre: 'Cemento CEM II 42,5', unidad: 'saco' })
      .expect(201);
    return {
      obraId: obra.id,
      centralId: central.body.id as string,
      acopioId: acopio.body.id as string,
      articuloId: cemento.body.id as string,
    };
  }

  async function entrada(
    almacenId: string,
    articuloId: string,
    cantidad: number,
    costeUnitario: number,
    fecha = '2026-03-02',
  ) {
    return api()
      .post('/almacen/entradas')
      .send({
        almacenId,
        fecha,
        lineas: [{ articuloId, cantidad, costeUnitario }],
      })
      .expect(201);
  }

  async function saldo(almacenId: string, articuloId: string) {
    const r = await api()
      .get(
        `/almacen/existencias?almacenId=${almacenId}&articuloId=${articuloId}&conCero=true`,
      )
      .expect(200);
    return r.body[0];
  }

  it('entradas recalculan el PMP y contabilizan 3000 a 6100', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 100, 10);
    const r = await entrada(b.centralId, b.articuloId, 50, 13);
    expect(r.body[0]).toMatchObject({
      tipo: 'entrada_compra',
      cantidad: 50,
      valor: 650,
      cantidadResultante: 150,
      pmpResultante: 11,
    });
    expect(r.body[0].asientoId).toEqual(expect.any(String));
    expect(await saldo(b.centralId, b.articuloId)).toMatchObject({
      cantidad: 150,
      valor: 1650,
      pmp: 11,
    });
    const existencias = await api().get('/contabilidad/mayor/3000').expect(200);
    expect(existencias.body.saldoFinal).toBe(1650);
    const resumen = await api().get('/almacen/resumen').expect(200);
    expect(resumen.body).toMatchObject({ valoracionTotal: 1650, alertas: 0 });
    // Totales del catálogo (subconsulta correlacionada por artículo).
    const articulos = await api().get('/almacen/articulos').expect(200);
    expect(articulos.body).toEqual([
      expect.objectContaining({
        codigo: 'CEM-42',
        cantidadTotal: 150,
        valorTotal: 1650,
      }),
    ]);
  });

  it('consumo a obra: valora al PMP, imputa el coste a la obra y rechaza stock insuficiente', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 3, 3.3333); // 10,00 €
    const c = await api()
      .post('/almacen/consumos')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-03-10',
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      })
      .expect(201);
    expect(c.body[0]).toMatchObject({
      tipo: 'salida_obra',
      cantidad: -1,
      valor: -3.33,
      projectId: b.obraId,
    });

    const porObra = await api()
      .get(`/contabilidad/sumas-saldos?projectId=${b.obraId}`)
      .expect(200);
    expect(porObra.body.filas).toEqual([
      expect.objectContaining({ codigo: '6100', saldoDeudor: 3.33 }),
    ]);

    const falta = await api()
      .post('/almacen/consumos')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-03-10',
        lineas: [{ articuloId: b.articuloId, cantidad: 5 }],
      });
    expect(falta.status).toBe(409);
    expect(falta.headers['content-type']).toContain('application/problem+json');
    expect(falta.body).toMatchObject({
      errorCode: 'INSUFFICIENT_STOCK',
      disponible: 2,
    });
    expect(falta.body.correlationId).toEqual(expect.any(String));

    // Vaciar el saldo se lleva el valor restante: sin céntimos huérfanos.
    await api()
      .post('/almacen/consumos')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-03-11',
        lineas: [{ articuloId: b.articuloId, cantidad: 2 }],
      })
      .expect(201);
    expect(await saldo(b.centralId, b.articuloId)).toMatchObject({
      cantidad: 0,
      valor: 0,
    });
    const consumos = await api()
      .get(`/almacen/obras/${b.obraId}/consumos`)
      .expect(200);
    expect(consumos.body.total).toBe(10);
  });

  it('el acopio de una obra no sirve material a otra obra', async () => {
    const b = await base();
    const otra = await createProject(app, token, { code: 'OB-2' });
    await entrada(b.acopioId, b.articuloId, 10, 5);
    const r = await api()
      .post('/almacen/consumos')
      .send({
        almacenId: b.acopioId,
        projectId: otra.id,
        fecha: '2026-03-10',
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      });
    expect(r.status).toBe(422);
    expect(r.body.errorCode).toBe('WAREHOUSE_PROJECT_MISMATCH');
  });

  it('recepción de albarán: una sola vez y sin superar su importe', async () => {
    const b = await base();
    const proveedor = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Cementos del Norte SL',
    });
    const alb = await api()
      .post('/delivery-notes')
      .send({
        contactId: proveedor.id,
        noteNumber: 'A-77',
        noteDate: '2026-03-01',
        amount: 500,
      })
      .expect(201);
    const cuerpo = (cantidad: number) => ({
      almacenId: b.centralId,
      fecha: '2026-03-01',
      albaranId: alb.body.id,
      lineas: [{ articuloId: b.articuloId, cantidad, costeUnitario: 10 }],
    });
    const excede = await api().post('/almacen/entradas').send(cuerpo(60));
    expect(excede.status).toBe(422);
    expect(excede.body.errorCode).toBe('DELIVERY_NOTE_AMOUNT_EXCEEDED');

    const ok = await api()
      .post('/almacen/entradas')
      .send(cuerpo(50))
      .expect(201);
    expect(ok.body[0].albaranId).toBe(alb.body.id);
    const otra = await api().post('/almacen/entradas').send(cuerpo(1));
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('DELIVERY_NOTE_ALREADY_STOCKED');
  });

  it('traspaso: sale al PMP del origen, recalcula el destino y no genera asiento', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 100, 10);
    await entrada(b.acopioId, b.articuloId, 50, 14);
    const origen = await saldo(b.centralId, b.articuloId);
    const vieja = await api()
      .post('/almacen/traspasos')
      .set('If-Match', `"${origen.version + 5}"`)
      .send({
        origenId: b.centralId,
        destinoId: b.acopioId,
        articuloId: b.articuloId,
        cantidad: 50,
        fecha: '2026-03-05',
      });
    expect(vieja.status).toBe(409);
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');

    const t = await api()
      .post('/almacen/traspasos')
      .set('If-Match', `"${origen.version}"`)
      .send({
        origenId: b.centralId,
        destinoId: b.acopioId,
        articuloId: b.articuloId,
        cantidad: 50,
        fecha: '2026-03-05',
      })
      .expect(201);
    expect(t.body).toMatchObject({
      tipo: 'traspaso',
      cantidad: -50,
      valor: -500,
      almacenDestinoId: b.acopioId,
      asientoId: null,
    });
    expect(await saldo(b.acopioId, b.articuloId)).toMatchObject({
      cantidad: 100,
      valor: 1200,
      pmp: 12,
    });
    const resumen = await api().get('/almacen/resumen').expect(200);
    expect(resumen.body.valoracionTotal).toBe(1700);
  });

  it('regularización: motivo obligatorio, faltante 6100 a 3000 y sin diferencia rechazada', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 100, 10);
    const sinMotivo = await api().post('/almacen/regularizaciones').send({
      almacenId: b.centralId,
      articuloId: b.articuloId,
      fecha: '2026-03-31',
      cantidadContada: 97,
    });
    expect(sinMotivo.status).toBe(400);

    const r = await api()
      .post('/almacen/regularizaciones')
      .send({
        almacenId: b.centralId,
        articuloId: b.articuloId,
        fecha: '2026-03-31',
        cantidadContada: 97,
        motivo: 'Recuento de cierre: rotura',
      })
      .expect(201);
    expect(r.body).toMatchObject({
      tipo: 'regularizacion',
      cantidad: -3,
      valor: -30,
      motivo: 'Recuento de cierre: rotura',
    });
    const asientos = await api()
      .get('/contabilidad/asientos?origen=regularizacion_inventario')
      .expect(200);
    expect(asientos.body.items[0].lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '6100', debe: 30 }),
        expect.objectContaining({ cuenta: '3000', haber: 30 }),
      ]),
    );
    const igual = await api().post('/almacen/regularizaciones').send({
      almacenId: b.centralId,
      articuloId: b.articuloId,
      fecha: '2026-03-31',
      cantidadContada: 97,
      motivo: 'Segundo recuento',
    });
    expect(igual.body.errorCode).toBe('STOCK_REGULARIZATION_NO_DIFFERENCE');
  });

  it('devolución de obra al coste consumido y nunca por encima de lo consumido', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 10, 10);
    await api()
      .post('/almacen/consumos')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-03-10',
        lineas: [{ articuloId: b.articuloId, cantidad: 4 }],
      })
      .expect(201);
    // Sube el PMP del almacén: la devolución sigue valorándose a 10.
    await entrada(b.centralId, b.articuloId, 6, 20);
    const dev = await api()
      .post('/almacen/devoluciones')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-03-12',
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      })
      .expect(201);
    expect(dev.body[0]).toMatchObject({ tipo: 'devolucion', valor: 10 });
    const excede = await api()
      .post('/almacen/devoluciones')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-03-12',
        lineas: [{ articuloId: b.articuloId, cantidad: 4 }],
      });
    expect(excede.body.errorCode).toBe('RETURN_EXCEEDS_CONSUMPTION');
    const consumos = await api()
      .get(`/almacen/obras/${b.obraId}/consumos`)
      .expect(200);
    expect(consumos.body.total).toBe(30);
  });

  it('período cerrado: el consumo se rechaza y no mueve stock', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 10, 10, '2026-02-02');
    await api().post('/contabilidad/periodos/2026/4/cerrar').expect(200);
    const r = await api()
      .post('/almacen/consumos')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-04-15',
        lineas: [{ articuloId: b.articuloId, cantidad: 2 }],
      });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    expect(await saldo(b.centralId, b.articuloId)).toMatchObject({
      cantidad: 10,
    });
    const movs = await api()
      .get(`/almacen/movimientos?tipo=salida_obra`)
      .expect(200);
    expect(movs.body).toHaveLength(0);
  });

  it('consumos concurrentes no dejan stock negativo', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 5, 2);
    const peticion = () =>
      api()
        .post('/almacen/consumos')
        .send({
          almacenId: b.centralId,
          projectId: b.obraId,
          fecha: '2026-03-10',
          lineas: [{ articuloId: b.articuloId, cantidad: 2 }],
        });
    const res = await Promise.all([1, 2, 3, 4].map(peticion));
    const estados = res.map((r) => r.status).sort();
    expect(estados).toEqual([201, 201, 409, 409]);
    expect(await saldo(b.centralId, b.articuloId)).toMatchObject({
      cantidad: 1,
      valor: 2,
    });
  });

  it('Idempotency-Key: reintentar una entrada no duplica el stock', async () => {
    const b = await base();
    const cuerpo = {
      almacenId: b.centralId,
      fecha: '2026-03-02',
      lineas: [{ articuloId: b.articuloId, cantidad: 10, costeUnitario: 1 }],
    };
    const clave = '6f1c2b52-0d3c-4b6a-9f3e-0b7e3c1d2a11';
    const r1 = await api()
      .post('/almacen/entradas')
      .set('Idempotency-Key', clave)
      .send(cuerpo)
      .expect(201);
    const r2 = await api()
      .post('/almacen/entradas')
      .set('Idempotency-Key', clave)
      .send(cuerpo)
      .expect(201);
    expect(r2.body[0].id).toBe(r1.body[0].id);
    expect(await saldo(b.centralId, b.articuloId)).toMatchObject({
      cantidad: 10,
    });
  });

  it('almacén inactivo, stock mínimo con alerta y validaciones de alta', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 4, 1);
    const s = await saldo(b.centralId, b.articuloId);
    await api()
      .patch(`/almacen/existencias/${s.id}`)
      .set('If-Match', `"${s.version}"`)
      .send({ stockMinimo: 5 })
      .expect(200);
    const alertas = await api()
      .get('/almacen/existencias?bajoMinimo=true')
      .expect(200);
    expect(alertas.body).toEqual([
      expect.objectContaining({ articuloCodigo: 'CEM-42', bajoMinimo: true }),
    ]);

    const conStock = await api()
      .patch(`/almacen/almacenes/${b.centralId}`)
      .set('If-Match', '"1"')
      .send({ activo: false });
    expect(conStock.body.errorCode).toBe('WAREHOUSE_HAS_STOCK');
    await api()
      .patch(`/almacen/almacenes/${b.acopioId}`)
      .set('If-Match', '"1"')
      .send({ activo: false })
      .expect(200);
    const inactivo = await api()
      .post('/almacen/entradas')
      .send({
        almacenId: b.acopioId,
        fecha: '2026-03-02',
        lineas: [{ articuloId: b.articuloId, cantidad: 1, costeUnitario: 1 }],
      });
    expect(inactivo.status).toBe(409);
    expect(inactivo.body.errorCode).toBe('WAREHOUSE_INACTIVE');

    const sinObra = await api()
      .post('/almacen/almacenes')
      .send({ codigo: 'X', nombre: 'Acopio sin obra', tipo: 'obra' });
    expect(sinObra.status).toBe(400);
    const cuenta = await api().post('/almacen/articulos').send({
      codigo: 'Z',
      nombre: 'Cuenta no PGC',
      unidad: 'ud',
      cuentaExistencias: '6000',
    });
    expect(cuenta.status).toBe(400);
  });

  it('rol obra: ve centrales y sus acopios, consume a su obra y no hace entradas', async () => {
    const b = await base();
    const otra = await createProject(app, token, { code: 'OB-2' });
    await api()
      .post('/almacen/almacenes')
      .send({
        codigo: 'ACO-2',
        nombre: 'Acopio obra 2',
        tipo: 'obra',
        projectId: otra.id,
      })
      .expect(201);
    await entrada(b.centralId, b.articuloId, 10, 1);
    const jefe = await createObraUser(app, token, [b.obraId]);
    const suyo = authed(app, jefe.tokens.accessToken);
    const visibles = await suyo.get('/almacen/almacenes').expect(200);
    expect(
      visibles.body.map((w: { codigo: string }) => w.codigo).sort(),
    ).toEqual(['ACO-1', 'CEN']);
    await authed(app, jefe.tokens.accessToken)
      .post('/almacen/consumos')
      .send({
        almacenId: b.centralId,
        projectId: b.obraId,
        fecha: '2026-03-10',
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      })
      .expect(201);
    const ajena = await authed(app, jefe.tokens.accessToken)
      .post('/almacen/consumos')
      .send({
        almacenId: b.centralId,
        projectId: otra.id,
        fecha: '2026-03-10',
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      });
    expect(ajena.body.errorCode).toBe('PROJECT_NOT_FOUND');
    await authed(app, jefe.tokens.accessToken)
      .post('/almacen/entradas')
      .send({
        almacenId: b.centralId,
        fecha: '2026-03-02',
        lineas: [{ articuloId: b.articuloId, cantidad: 1, costeUnitario: 1 }],
      })
      .expect(403);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken).get('/almacen/resumen').expect(200);
  });

  it('movimientos filtrables y paginados; kárdex inmutable en la base', async () => {
    const b = await base();
    await entrada(b.centralId, b.articuloId, 10, 1, '2026-03-01');
    await entrada(b.centralId, b.articuloId, 10, 1, '2026-03-20');
    const pag = await api()
      .get(
        `/almacen/movimientos?almacenId=${b.centralId}&desde=2026-03-10&page=1&pageSize=10`,
      )
      .expect(200);
    expect(pag.body).toMatchObject({ total: 1, page: 1 });
    expect(pag.body.items[0].fecha).toBe('2026-03-20');

    const { getDb } = await import('@erp/db');
    const { sql } = await import('drizzle-orm');
    await expect(
      getDb().execute(sql`update stock_movements set quantity = 999`),
    ).rejects.toThrow(/inmutables/);
  });
});
