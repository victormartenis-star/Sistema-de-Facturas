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
 * Flujos de aprobación por umbral: reglas por tramo, puerta en la validación
 * de albaranes (liberación del pedido) y en la aprobación de facturas de
 * compra, segregación de funciones y nivel, rechazo con motivo, invalidación
 * al subir el importe, idempotencia, RFC 7807 y cadena de auditoría.
 */
describe('Aprobaciones por umbral (integración)', () => {
  let app: INestApplication;
  let admin: string;
  let gerente: string;
  let administracion: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    admin = (await registerUser(app)).accessToken;
    gerente = (await createUserWithRole(app, admin, 'gerente')).accessToken;
    administracion = (await createUserWithRole(app, admin, 'administracion'))
      .accessToken;
  });

  const como = (t: string) => authed(app, t);
  const u = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  async function base() {
    const obra = await createProject(app, admin, { code: `OB-${u()}` });
    const proveedor = await createContact(app, admin, {
      kind: 'proveedor',
      legalName: `Suministros ${u()} SL`,
    });
    return { obraId: obra.id, proveedorId: proveedor.id };
  }

  const regla = (body: Record<string, unknown>) =>
    como(admin)
      .post('/aprobaciones/reglas')
      .send({ nombre: 'Tramo', ...body });

  async function pedido(
    b: { obraId: string; proveedorId: string },
    amount: number,
  ) {
    const r = await como(admin)
      .post('/purchase-orders')
      .send({
        projectId: b.obraId,
        contactId: b.proveedorId,
        orderDate: '2026-03-02',
        description: 'Suministro',
        amount,
      })
      .expect(201);
    return r.body as { id: string; version: number };
  }

  async function albaran(
    b: { proveedorId: string },
    orderId: string,
    amount: number,
  ) {
    const r = await como(admin)
      .post('/delivery-notes')
      .send({
        contactId: b.proveedorId,
        orderId,
        noteNumber: `ALB-${u()}`,
        noteDate: '2026-03-05',
        amount,
      })
      .expect(201);
    return r.body.id as string;
  }

  const validar = (id: string) =>
    como(admin).post(`/delivery-notes/${id}/validar`);

  const solicitar = (operacion: string, entidadId: string, t = admin) =>
    como(t).post('/aprobaciones/solicitudes').send({ operacion, entidadId });

  it('por debajo del umbral no se exige nada; por encima bloquea hasta aprobar (con segregación y nivel)', async () => {
    const b = await base();
    await regla({
      operacion: 'pedido_compra',
      importeMinimo: 5000,
      rolRequerido: 'gerente',
    }).expect(201);

    // 4.999,99 €: no requiere aprobación.
    const pequeño = await pedido(b, 4999.99);
    await validar(await albaran(b, pequeño.id, 1000)).expect(201);
    const noReq = await solicitar('pedido_compra', pequeño.id);
    expect(noReq.status).toBe(422);
    expect(noReq.body.errorCode).toBe('APPROVAL_NOT_REQUIRED');

    // 5.000 €: el umbral es inclusivo.
    const grande = await pedido(b, 5000);
    const alb = await albaran(b, grande.id, 1000);
    const sin = await validar(alb);
    expect(sin.status).toBe(409);
    expect(sin.headers['content-type']).toContain('application/problem+json');
    expect(sin.body).toMatchObject({
      errorCode: 'APPROVAL_REQUIRED',
      operacion: 'pedido_compra',
      importe: 5000,
      rolRequerido: 'gerente',
    });
    expect(sin.body.correlationId).toEqual(expect.any(String));

    const s = await solicitar('pedido_compra', grande.id).expect(201);
    expect(s.body).toMatchObject({
      estado: 'pendiente',
      importe: 5000,
      rolRequerido: 'gerente',
      puedoDecidir: false,
    });
    expect((await validar(alb)).body.errorCode).toBe('APPROVAL_PENDING');
    const dup = await solicitar('pedido_compra', grande.id);
    expect(dup.body.errorCode).toBe('APPROVAL_ALREADY_REQUESTED');

    // El solicitante (admin) no puede aprobar su propia solicitud.
    const propia = await como(admin)
      .post(`/aprobaciones/solicitudes/${s.body.id}/aprobar`)
      .send({});
    expect(propia.status).toBe(403);
    expect(propia.body.errorCode).toBe('SELF_APPROVAL_FORBIDDEN');
    // Administración no alcanza el nivel gerente.
    const nivel = await como(administracion)
      .post(`/aprobaciones/solicitudes/${s.body.id}/aprobar`)
      .send({});
    expect(nivel.body.errorCode).toBe('APPROVAL_ROLE_INSUFFICIENT');

    const pendientes = await como(gerente)
      .get('/aprobaciones/solicitudes?paraMi=true')
      .expect(200);
    expect(pendientes.body).toEqual([
      expect.objectContaining({ id: s.body.id, puedoDecidir: true }),
    ]);
    await como(gerente)
      .post(`/aprobaciones/solicitudes/${s.body.id}/aprobar`)
      .set('If-Match', `"${s.body.version}"`)
      .send({ comentario: 'Conforme' })
      .expect(200);
    await validar(alb).expect(201);

    // Bandeja in-app dirigida (fase 7): el aviso de pendiente llega a quien
    // puede decidir (gerente) y la decisión a quien solicitó (admin); nadie
    // recibe lo que no le toca.
    const titulosDe = async (t: string) =>
      (
        (await como(t).get('/alerts/notifications').expect(200)).body as {
          type: string;
          title: string;
        }[]
      )
        .filter((n) => n.type === 'aprobacion')
        .map((n) => n.title);
    const delAdmin = await titulosDe(admin);
    expect(delAdmin).toEqual([expect.stringContaining('Aprobación aprobada')]);
    expect(await titulosDe(gerente)).toEqual([
      expect.stringContaining('Aprobación pendiente'),
    ]);
    expect(await titulosDe(administracion)).toEqual([]);
    const bandejaAdmin = await como(admin)
      .get('/alerts/notifications')
      .expect(200);
    const noLeidas = await como(admin)
      .get('/alerts/notifications/no-leidas')
      .expect(200);
    expect(noLeidas.body).toEqual({ count: bandejaAdmin.body.length });
    expect(delAdmin).toHaveLength(1);
  });

  it('rechazo con motivo obligatorio; tras rechazar se puede volver a solicitar', async () => {
    const b = await base();
    await regla({
      operacion: 'pedido_compra',
      importeMinimo: 1000,
      rolRequerido: 'administracion',
    }).expect(201);
    const p = await pedido(b, 2000);
    const alb = await albaran(b, p.id, 500);
    const s = await solicitar('pedido_compra', p.id).expect(201);

    const sinMotivo = await como(gerente)
      .post(`/aprobaciones/solicitudes/${s.body.id}/rechazar`)
      .send({});
    expect(sinMotivo.status).toBe(400);
    const r = await como(gerente)
      .post(`/aprobaciones/solicitudes/${s.body.id}/rechazar`)
      .send({ motivo: 'Precio fuera de mercado' })
      .expect(200);
    expect(r.body).toMatchObject({
      estado: 'rechazada',
      motivoDecision: 'Precio fuera de mercado',
    });
    expect((await validar(alb)).body.errorCode).toBe('APPROVAL_REJECTED');

    // Una decisión es terminal: no se aprueba lo rechazado.
    const tarde = await como(gerente)
      .post(`/aprobaciones/solicitudes/${s.body.id}/aprobar`)
      .send({});
    expect(tarde.status).toBe(409);

    const nueva = await solicitar('pedido_compra', p.id).expect(201);
    await como(gerente)
      .post(`/aprobaciones/solicitudes/${nueva.body.id}/aprobar`)
      .send({})
      .expect(200);
    await validar(alb).expect(201);
  });

  it('subir el importe de un pedido aprobado invalida la aprobación; bajarlo la conserva', async () => {
    const b = await base();
    await regla({
      operacion: 'pedido_compra',
      importeMinimo: 1000,
      rolRequerido: 'gerente',
    }).expect(201);
    const p = await pedido(b, 3000);
    const s = await solicitar('pedido_compra', p.id).expect(201);
    await como(gerente)
      .post(`/aprobaciones/solicitudes/${s.body.id}/aprobar`)
      .send({})
      .expect(200);

    const baja = await como(admin)
      .patch(`/purchase-orders/${p.id}`)
      .set('If-Match', `"${p.version}"`)
      .send({ amount: 2500 })
      .expect(200);
    let estado = await como(admin)
      .get(`/aprobaciones/estado?operacion=pedido_compra&entidadId=${p.id}`)
      .expect(200);
    expect(estado.body.solicitud.estado).toBe('aprobada');
    expect(estado.body.evaluacion.errorCode).toBeNull();

    await como(admin)
      .patch(`/purchase-orders/${p.id}`)
      .set('If-Match', `"${baja.body.version}"`)
      .send({ amount: 3000.01 })
      .expect(200);
    estado = await como(admin)
      .get(`/aprobaciones/estado?operacion=pedido_compra&entidadId=${p.id}`)
      .expect(200);
    expect(estado.body.solicitud).toMatchObject({ estado: 'invalidada' });
    expect(estado.body.solicitud.motivoDecision).toContain('Pedido modificado');
    expect(estado.body.evaluacion.errorCode).toBe('APPROVAL_REQUIRED');
    const alb = await albaran(b, p.id, 100);
    expect((await validar(alb)).body.errorCode).toBe('APPROVAL_REQUIRED');
  });

  it('factura de compra: no pasa a aprobada (pagadera) sin aprobación por umbral', async () => {
    const b = await base();
    await regla({
      operacion: 'factura_compra',
      importeMinimo: 1000,
      rolRequerido: 'administracion',
    }).expect(201);
    const p = await pedido(b, 1000);
    const alb = await albaran(b, p.id, 1000);
    await validar(alb).expect(201);
    const f = await como(admin)
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: b.proveedorId,
        invoiceNumber: `FC-${u()}`,
        issueDate: '2026-03-06',
        deliveryNoteIds: [alb],
        lines: [
          {
            description: 'Material',
            baseAmount: 1000,
            vatPct: 21,
            projectId: b.obraId,
          },
        ],
      })
      .expect(201);
    const bloqueada = await como(admin).post(`/invoices/${f.body.id}/aprobar`);
    expect(bloqueada.status).toBe(409);
    expect(bloqueada.body).toMatchObject({
      errorCode: 'APPROVAL_REQUIRED',
      operacion: 'factura_compra',
      importe: 1210,
    });
    expect((await como(admin).get(`/invoices/${f.body.id}`)).body.status).toBe(
      'borrador',
    );

    const s = await solicitar('factura_compra', f.body.id).expect(201);
    await como(administracion)
      .post(`/aprobaciones/solicitudes/${s.body.id}/aprobar`)
      .send({})
      .expect(200);
    await como(admin).post(`/invoices/${f.body.id}/aprobar`).expect(201);
  });

  it('idempotencia de la solicitud, reglas duplicadas, roles y cadena de auditoría', async () => {
    const b = await base();
    await regla({
      operacion: 'pedido_compra',
      importeMinimo: 1000,
      rolRequerido: 'gerente',
    }).expect(201);
    const dup = await regla({
      operacion: 'pedido_compra',
      importeMinimo: 1000,
      rolRequerido: 'admin',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('APPROVAL_RULE_DUPLICATE');
    await como(administracion)
      .post('/aprobaciones/reglas')
      .send({
        nombre: 'x',
        operacion: 'pedido_compra',
        importeMinimo: 1,
        rolRequerido: 'gerente',
      })
      .expect(403);

    const p = await pedido(b, 2000);
    const clave = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const r1 = await como(admin)
      .post('/aprobaciones/solicitudes')
      .set('Idempotency-Key', clave)
      .send({ operacion: 'pedido_compra', entidadId: p.id })
      .expect(201);
    const r2 = await como(admin)
      .post('/aprobaciones/solicitudes')
      .set('Idempotency-Key', clave)
      .send({ operacion: 'pedido_compra', entidadId: p.id })
      .expect(201);
    expect(r2.body.id).toBe(r1.body.id);

    // Un bloqueo de la puerta queda auditado aunque la operación se deshaga.
    const alb = await albaran(b, p.id, 100);
    await validar(alb).expect(409);
    const bloqueos = await como(admin)
      .get('/audit?entityType=approval_gate')
      .expect(200);
    const filas = bloqueos.body.items ?? bloqueos.body;
    expect(filas).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityId: p.id })]),
    );
    const integridad = await como(admin)
      .get('/audit/verify-integrity')
      .expect(200);
    expect(integridad.body.integra).toBe(true);

    // El rol obra solo ve solicitudes de sus obras y no decide.
    const otra = await base();
    const jefe = await createObraUser(app, admin, [otra.obraId]);
    const vistas = await como(jefe.tokens.accessToken)
      .get('/aprobaciones/solicitudes')
      .expect(200);
    expect(vistas.body).toHaveLength(0);
    await como(jefe.tokens.accessToken)
      .post(`/aprobaciones/solicitudes/${r1.body.id}/aprobar`)
      .send({})
      .expect(403);
  });
});
