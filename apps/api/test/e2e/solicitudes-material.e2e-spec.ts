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
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Solicitudes de material de obra: reserva de stock por obra (la reserva
 * protege el material frente a otros consumos), faltante, servicio parcial
 * y total con su consumo valorado a PMP, re-reserva tras una entrada,
 * cancelación que libera, pedido de compra del faltante (con control
 * presupuestario heredado), concurrencia, RFC 7807, acceso por obra,
 * notificaciones y cadena de auditoría.
 */
describe('Solicitudes de material (integración)', () => {
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

  /** Obra, almacén central y 10 t de árido a 10 €/t. */
  async function base(stock = 10) {
    const obra = await createProject(app, token, { code: `OB-${u()}` });
    const al = await api()
      .post('/almacen/almacenes')
      .send({ codigo: 'CEN', nombre: 'Central', tipo: 'central' })
      .expect(201);
    const art = await api()
      .post('/almacen/articulos')
      .send({ codigo: 'ARI-1', nombre: 'Árido', unidad: 't' })
      .expect(201);
    await entrada(al.body.id, art.body.id, stock);
    return {
      obraId: obra.id as string,
      almacenId: al.body.id as string,
      articuloId: art.body.id as string,
    };
  }

  const entrada = (almacenId: string, articuloId: string, cantidad: number) =>
    api()
      .post('/almacen/entradas')
      .send({
        almacenId,
        fecha: '2026-03-01',
        lineas: [{ articuloId, cantidad, costeUnitario: 10 }],
      })
      .expect(201);

  const solicitar = (
    b: { obraId: string; almacenId: string; articuloId: string },
    cantidad: number,
  ) =>
    api()
      .post('/almacen/solicitudes')
      .send({
        almacenId: b.almacenId,
        projectId: b.obraId,
        fechaNecesidad: '2026-03-15',
        lineas: [{ articuloId: b.articuloId, cantidad }],
      });

  const existencia = async (almacenId: string) =>
    (
      await api()
        .get(`/almacen/existencias?almacenId=${almacenId}&conCero=true`)
        .expect(200)
    ).body[0];

  it('reserva lo disponible, deja el faltante y la reserva protege el stock', async () => {
    const b = await base();
    const s = await solicitar(b, 15).expect(201);
    expect(s.body).toMatchObject({
      numero: 'SM-000001',
      estado: 'abierta',
      conFaltante: true,
    });
    expect(s.body.lineas[0]).toMatchObject({
      solicitada: 15,
      reservada: 10,
      servida: 0,
      faltante: 5,
    });
    expect(await existencia(b.almacenId)).toMatchObject({
      cantidad: 10,
      reservada: 10,
      disponible: 0,
    });
    // Otra obra (o un consumo directo) ya no puede llevarse lo reservado.
    const otra = await createProject(app, token, { code: `OB-${u()}` });
    const robo = await api()
      .post('/almacen/consumos')
      .send({
        almacenId: b.almacenId,
        projectId: otra.id,
        fecha: '2026-03-05',
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      });
    expect(robo.status).toBe(409);
    expect(robo.headers['content-type']).toContain('application/problem+json');
    expect(robo.body.errorCode).toBe('INSUFFICIENT_STOCK');

    const bandeja = await api().get('/alerts/notifications').expect(200);
    expect(bandeja.body).toEqual([
      expect.objectContaining({
        type: 'almacen',
        title: expect.stringContaining('SM-000001'),
        link: '/almacen/solicitudes',
      }),
    ]);
  });

  it('servir en parte y luego todo: consumo a PMP, estados y reserva liberada', async () => {
    const b = await base();
    const s = (await solicitar(b, 15).expect(201)).body;
    const linea = s.lineas[0].id;

    const vieja = await api()
      .post(`/almacen/solicitudes/${s.id}/servir`)
      .set('If-Match', `"${s.version + 3}"`)
      .send({ fecha: '2026-03-10', lineas: [{ lineaId: linea, cantidad: 4 }] });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');

    const p1 = await api()
      .post(`/almacen/solicitudes/${s.id}/servir`)
      .set('If-Match', `"${s.version}"`)
      .send({ fecha: '2026-03-10', lineas: [{ lineaId: linea, cantidad: 4 }] })
      .expect(200);
    expect(p1.body.solicitud).toMatchObject({ estado: 'servida_parcial' });
    expect(p1.body.solicitud.lineas[0]).toMatchObject({
      servida: 4,
      reservada: 6,
      faltante: 5,
    });
    expect(p1.body.movimientos[0]).toMatchObject({
      tipo: 'salida_obra',
      cantidad: -4,
      valor: -40,
      projectId: b.obraId,
    });
    expect(await existencia(b.almacenId)).toMatchObject({
      cantidad: 6,
      reservada: 6,
    });

    const demasiado = await api()
      .post(`/almacen/solicitudes/${s.id}/servir`)
      .send({
        fecha: '2026-03-10',
        lineas: [{ lineaId: linea, cantidad: 12 }],
      });
    expect(demasiado.status).toBe(422);
    expect(demasiado.body).toMatchObject({
      errorCode: 'MATERIAL_REQUEST_OVER_SERVED',
      pendiente: 11,
    });

    // Entra material: re-reservar cubre el faltante; servir sin líneas sirve todo lo reservado.
    await entrada(b.almacenId, b.articuloId, 5);
    const rr = await api()
      .post(`/almacen/solicitudes/${s.id}/reservar`)
      .expect(200);
    expect(rr.body.lineas[0]).toMatchObject({ reservada: 11, faltante: 0 });
    expect(rr.body.conFaltante).toBe(false);
    const todo = await api()
      .post(`/almacen/solicitudes/${s.id}/servir`)
      .send({ fecha: '2026-03-12' })
      .expect(200);
    expect(todo.body.solicitud).toMatchObject({ estado: 'servida' });
    expect(await existencia(b.almacenId)).toMatchObject({
      cantidad: 0,
      reservada: 0,
    });
    const consumos = await api()
      .get(`/almacen/obras/${b.obraId}/consumos`)
      .expect(200);
    expect(consumos.body.total).toBe(150);

    const cerrada = await api()
      .post(`/almacen/solicitudes/${s.id}/servir`)
      .send({ fecha: '2026-03-13' });
    expect(cerrada.status).toBe(409);
    expect(cerrada.body.errorCode).toBe('MATERIAL_REQUEST_CLOSED');
  });

  it('cancelar exige motivo y libera la reserva', async () => {
    const b = await base();
    const s = (await solicitar(b, 3).expect(201)).body;
    await api()
      .post(`/almacen/solicitudes/${s.id}/cancelar`)
      .send({})
      .expect(400);
    const c = await api()
      .post(`/almacen/solicitudes/${s.id}/cancelar`)
      .send({ motivo: 'Cambio de proyecto' })
      .expect(200);
    expect(c.body).toMatchObject({
      estado: 'cancelada',
      motivoCancelacion: 'Cambio de proyecto',
    });
    expect(c.body.lineas[0].reservada).toBe(0);
    expect(await existencia(b.almacenId)).toMatchObject({
      reservada: 0,
      disponible: 10,
    });
  });

  it('pedido del faltante: importe exacto, una sola vez y con el control presupuestario de la obra', async () => {
    const b = await base();
    const proveedor = await createContact(app, token, {
      kind: 'proveedor',
      legalName: `Áridos ${u()} SL`,
    });
    const s = (await solicitar(b, 15).expect(201)).body;
    const linea = s.lineas[0].id;
    const p = await api()
      .post(`/almacen/solicitudes/${s.id}/pedido`)
      .send({
        contactId: proveedor.id,
        fecha: '2026-03-02',
        lineas: [{ lineaId: linea, costeUnitario: 12.345 }],
      })
      .expect(201);
    // 5 t × 12,345 €/t = 61,725 → 61,73 € (half-up al céntimo).
    expect(p.body.pedido).toMatchObject({ amount: 61.73, projectId: b.obraId });
    expect(p.body.solicitud.lineas[0].pedidoNumero).toBe(
      p.body.pedido.orderNumber,
    );
    expect(p.body.solicitud.conFaltante).toBe(false);
    const otra = await api()
      .post(`/almacen/solicitudes/${s.id}/pedido`)
      .send({
        contactId: proveedor.id,
        fecha: '2026-03-02',
        lineas: [{ lineaId: linea, costeUnitario: 10 }],
      });
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('MATERIAL_REQUEST_LINE_ORDERED');

    // Obra con presupuesto de 50 € en bloqueo: el pedido del faltante no pasa.
    const obra2 = await createProject(app, token, { code: `OB-${u()}` });
    const presupuesto = await createBudget(app, token, obra2.id);
    await addBudgetItem(app, token, presupuesto.id, {
      unitPrice: 10,
      quantity: 5,
    });
    await activateBudget(app, token, presupuesto.id);
    await api()
      .put(`/projects/${obra2.id}/control-presupuestario`)
      .send({ modo: 'bloqueo' })
      .expect(200);
    const s2 = (
      await api()
        .post('/almacen/solicitudes')
        .send({
          almacenId: b.almacenId,
          projectId: obra2.id,
          lineas: [{ articuloId: b.articuloId, cantidad: 6 }],
        })
        .expect(201)
    ).body;
    const bloqueado = await api()
      .post(`/almacen/solicitudes/${s2.id}/pedido`)
      .send({
        contactId: proveedor.id,
        fecha: '2026-03-02',
        lineas: [{ lineaId: s2.lineas[0].id, costeUnitario: 10 }],
      });
    expect(bloqueado.status).toBe(422);
    expect(bloqueado.body.errorCode).toBe('BUDGET_EXCEEDED');
    const tras = await api().get(`/almacen/solicitudes/${s2.id}`).expect(200);
    expect(tras.body.lineas[0].pedidoId).toBeNull();
  });

  it('servicios concurrentes de lo mismo: solo uno pasa', async () => {
    const b = await base();
    const s = (await solicitar(b, 10).expect(201)).body;
    const linea = s.lineas[0].id;
    const res = await Promise.all(
      [1, 2].map(() =>
        api()
          .post(`/almacen/solicitudes/${s.id}/servir`)
          .send({
            fecha: '2026-03-10',
            lineas: [{ lineaId: linea, cantidad: 6 }],
          }),
      ),
    );
    expect(res.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await existencia(b.almacenId)).toMatchObject({
      cantidad: 4,
      reservada: 4,
    });
  });

  it('acceso por obra, roles y cadena de auditoría', async () => {
    const b = await base();
    const s = (await solicitar(b, 2).expect(201)).body;
    const otraObra = await createProject(app, token, { code: `OB-${u()}` });
    const jefe = await createObraUser(app, token, [otraObra.id]);
    const suyo = authed(app, jefe.tokens.accessToken);
    expect((await suyo.get('/almacen/solicitudes').expect(200)).body).toEqual(
      [],
    );
    const ajena = await suyo.get(`/almacen/solicitudes/${s.id}`);
    expect(ajena.status).toBe(404);
    expect(ajena.body.errorCode).toBe('MATERIAL_REQUEST_NOT_FOUND');
    // El jefe de obra pide para su obra; el lector no puede pedir.
    await suyo
      .post('/almacen/solicitudes')
      .send({
        almacenId: b.almacenId,
        projectId: otraObra.id,
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      })
      .expect(201);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .post('/almacen/solicitudes')
      .send({
        almacenId: b.almacenId,
        projectId: b.obraId,
        lineas: [{ articuloId: b.articuloId, cantidad: 1 }],
      })
      .expect(403);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
    const audit = await api()
      .get('/audit?entityType=material_request')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBeGreaterThanOrEqual(2);
  });
});
