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
 * Fase 7 (GRC): aprobación multinivel por importe con aprobador asignado,
 * delegación, segregación de funciones con política (creador, mismo
 * aprobador, solicitante, aprobador que paga), escalado por plazo,
 * reasignación, notificaciones dirigidas con lectura por usuario,
 * concurrencia, idempotencia y auditoría íntegra.
 */
describe('GRC: aprobaciones multinivel, SoD y notificaciones dirigidas (integración)', () => {
  let app: INestApplication;
  type Persona = { token: string; id: string };
  let A: Persona; // admin (registro)
  let G1: Persona;
  let G2: Persona;
  let D1: Persona; // administración: crea la factura
  let D2: Persona; // administración: solicita
  let L: Persona; // lector

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  const persona = (t: {
    accessToken: string;
    user: { id: string };
  }): Persona => ({ token: t.accessToken, id: t.user.id });

  beforeEach(async () => {
    await resetTestDb();
    A = persona(await registerUser(app));
    G1 = persona(await createUserWithRole(app, A.token, 'gerente'));
    G2 = persona(await createUserWithRole(app, A.token, 'gerente'));
    D1 = persona(await createUserWithRole(app, A.token, 'administracion'));
    D2 = persona(await createUserWithRole(app, A.token, 'administracion'));
    L = persona(await createUserWithRole(app, A.token, 'lector'));
  });

  const como = (p: Persona) => authed(app, p.token);
  const u = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const aprobaciones = async (p: Persona) =>
    (
      (await como(p).get('/alerts/notifications').expect(200)).body as {
        id: string;
        type: string;
        title: string;
        read: boolean;
        dirigida: boolean;
      }[]
    ).filter((n) => n.type === 'aprobacion');

  it('cadena de 3 niveles con SoD, delegación, asignación, notificaciones dirigidas y aprobador que paga', async () => {
    const obra = await createProject(app, A.token, { code: `OB-${u()}` });
    const prov = await createContact(app, A.token, {
      kind: 'proveedor',
      legalName: `Suministros ${u()} SL`,
    });

    // Cadena incoherente (el rol baja): rechazada.
    const mala = await como(A)
      .post('/aprobaciones/reglas')
      .send({
        nombre: 'Mala',
        operacion: 'factura_compra',
        importeMinimo: 1000,
        rolRequerido: 'gerente',
        niveles: [
          { importeMinimo: 0, rolRequerido: 'gerente' },
          { importeMinimo: 2000, rolRequerido: 'administracion' },
        ],
      });
    expect(mala.status).toBe(422);
    expect(mala.body.errorCode).toBe('APPROVAL_LEVELS_INVALID');
    const regla = (
      await como(A)
        .post('/aprobaciones/reglas')
        .set('Idempotency-Key', `r-${u()}`)
        .send({
          nombre: 'Facturas de compra',
          operacion: 'factura_compra',
          importeMinimo: 1000,
          rolRequerido: 'gerente',
          niveles: [
            { importeMinimo: 0, rolRequerido: 'administracion' },
            { importeMinimo: 2000, rolRequerido: 'gerente', plazoHoras: 24 },
            { importeMinimo: 5000, rolRequerido: 'admin', aprobadorId: A.id },
          ],
        })
        .expect(201)
    ).body;
    expect(regla.niveles).toHaveLength(3);
    expect(regla.niveles[2]).toMatchObject({
      nivel: 3,
      aprobadorId: A.id,
      aprobadorNombre: expect.any(String),
    });

    // Pedido y albarán validado (la factura de compra se cuadra con albaranes).
    const po = (
      await como(A)
        .post('/purchase-orders')
        .send({
          projectId: obra.id,
          contactId: prov.id,
          orderDate: '2026-11-01',
          description: 'Material',
          amount: 5000,
        })
        .expect(201)
    ).body;
    const alb = (
      await como(A)
        .post('/delivery-notes')
        .send({
          contactId: prov.id,
          orderId: po.id,
          noteNumber: `ALB-${u()}`,
          noteDate: '2026-11-02',
          amount: 5000,
        })
        .expect(201)
    ).body;
    await como(A).post(`/delivery-notes/${alb.id}/validar`).expect(201);
    // Factura de 6.050 € creada por D1: intervienen los tres niveles.
    const f = (
      await como(D1)
        .post('/invoices')
        .send({
          kind: 'compra',
          contactId: prov.id,
          invoiceNumber: `FC-${u()}`,
          issueDate: '2026-11-02',
          dueDate: '2026-12-02',
          deliveryNoteIds: [alb.id],
          lines: [
            {
              description: 'Material',
              baseAmount: 5000,
              vatPct: 21,
              projectId: obra.id,
            },
          ],
        })
        .expect(201)
    ).body;
    const bloqueo = await como(A).post(`/invoices/${f.id}/aprobar`);
    expect(bloqueo.body).toMatchObject({
      errorCode: 'APPROVAL_REQUIRED',
      rolRequerido: 'admin',
    });

    const s = (
      await como(D2)
        .post('/aprobaciones/solicitudes')
        .set('Idempotency-Key', `s-${u()}`)
        .send({ operacion: 'factura_compra', entidadId: f.id })
        .expect(201)
    ).body;
    expect(s).toMatchObject({
      estado: 'pendiente',
      nivelActual: 1,
      totalNiveles: 3,
      rolRequerido: 'admin',
    });
    expect(s.pasos.map((p: { estado: string }) => p.estado)).toEqual([
      'activo',
      'en_espera',
      'en_espera',
    ]);

    // Notificación dirigida al nivel 1: decisores, no el solicitante ni el lector.
    for (const p of [A, G1, G2, D1])
      expect((await aprobaciones(p)).map((n) => n.title)).toEqual([
        expect.stringContaining('nivel 1/3'),
      ]);
    expect(await aprobaciones(D2)).toEqual([]);
    expect(await aprobaciones(L)).toEqual([]);
    const otra = (await aprobaciones(G1))[0];
    expect(otra.dirigida).toBe(true);
    const ajena = await como(D2).patch(`/alerts/notifications/${otra.id}/leer`);
    expect(ajena.status).toBe(404);
    expect(ajena.body.errorCode).toBe('NOTIFICATION_NOT_FOUND');
    await como(G1).patch(`/alerts/notifications/${otra.id}/leer`).expect(204);
    expect((await aprobaciones(G1))[0].read).toBe(true);
    expect((await aprobaciones(G2))[0].read).toBe(false);

    // Nivel 1: el solicitante no; el creador, con política «justificar», solo con justificación.
    const propia = await como(D2)
      .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
      .send({});
    expect(propia.status).toBe(403);
    expect(propia.body.errorCode).toBe('SELF_APPROVAL_FORBIDDEN');
    const bloqueada = await como(A)
      .put('/grc/sod/politicas/solicitante_aprueba')
      .send({ modo: 'auditar' });
    expect(bloqueada.status).toBe(403);
    expect(bloqueada.body.errorCode).toBe('SOD_POLICY_LOCKED');
    await como(A)
      .put('/grc/sod/politicas/creador_aprueba')
      .send({ modo: 'justificar' })
      .expect(200);
    const sinJust = await como(D1)
      .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
      .send({});
    expect(sinJust.status).toBe(422);
    expect(sinJust.body.errorCode).toBe('SOD_JUSTIFICATION_REQUIRED');
    const n1 = (
      await como(D1)
        .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
        .set('If-Match', `"${s.version}"`)
        .send({
          comentario: 'Conforme',
          justificacionSod: 'Única persona de administración disponible',
        })
        .expect(200)
    ).body;
    expect(n1).toMatchObject({
      estado: 'pendiente',
      nivelActual: 2,
      version: s.version + 1,
    });
    expect(n1.pasos[0]).toMatchObject({
      estado: 'aprobado',
      decididoPor: D1.id,
    });
    expect(n1.pasos[1]).toMatchObject({
      estado: 'activo',
      venceEl: expect.any(String),
    });
    // Nivel 2 se avisa a gerentes y admin, no a quien ya firmó.
    expect((await aprobaciones(G2)).map((n) => n.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('nivel 2/3')]),
    );
    expect(
      (await aprobaciones(D1)).some((n) => n.title.includes('nivel 2/3')),
    ).toBe(false);

    // Delegación de G1 en D1: el delegado decide con el rol del delegante, pero D1 ya firmó el nivel 1.
    const hoy = new Date().toISOString().slice(0, 10);
    const enCinco = new Date(Date.now() + 5 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const autodelegacion = await como(G1).post('/grc/delegaciones').send({
      delegadoId: G1.id,
      desde: hoy,
      hasta: enCinco,
      motivo: 'Vacaciones',
    });
    expect(autodelegacion.body.errorCode).toBe('APPROVAL_DELEGATION_INVALID');
    const del = (
      await como(G1)
        .post('/grc/delegaciones')
        .send({
          delegadoId: D1.id,
          desde: hoy,
          hasta: enCinco,
          motivo: 'Vacaciones',
        })
        .expect(201)
    ).body;
    const solapa = await como(G1)
      .post('/grc/delegaciones')
      .send({ delegadoId: D2.id, desde: hoy, hasta: hoy, motivo: 'Otra' });
    expect(solapa.status).toBe(409);
    expect(solapa.body.errorCode).toBe('APPROVAL_DELEGATION_OVERLAP');
    const dosNiveles = await como(D1)
      .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
      .send({});
    expect(dosNiveles.status).toBe(403);
    expect(dosNiveles.body.errorCode).toBe('SOD_CONFLICT');
    // D1 ya firmó el nivel 1 (bloquea siempre) y además creó la factura.
    expect(dosNiveles.body.conflictos).toEqual(
      expect.arrayContaining([
        { conflicto: 'mismo_aprobador_niveles', modo: 'bloquear' },
        { conflicto: 'creador_aprueba', modo: 'justificar' },
      ]),
    );

    // Concurrencia: dos decisiones con la misma versión, solo una entra.
    const [x, y] = await Promise.all([
      como(G2)
        .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
        .set('If-Match', `"${n1.version}"`)
        .send({}),
      como(G1)
        .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
        .set('If-Match', `"${n1.version}"`)
        .send({}),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const n2 = (
      await como(A)
        .get(`/aprobaciones/solicitudes?entidadId=${f.id}`)
        .expect(200)
    ).body[0];
    expect(n2).toMatchObject({ nivelActual: 3 });

    // Nivel 3 asignado a A: otro gerente no; A sí. Queda aprobada y la factura pasa.
    const otro = await como(G1)
      .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
      .send({});
    expect(otro.status).toBe(403);
    expect(otro.body.errorCode).toBe('APPROVAL_NOT_ASSIGNEE');
    const fin = (
      await como(A)
        .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
        .send({ comentario: 'OK' })
        .expect(200)
    ).body;
    expect(fin).toMatchObject({ estado: 'aprobada', nivelActual: 3 });
    expect(fin.pasos.map((p: { estado: string }) => p.estado)).toEqual([
      'aprobado',
      'aprobado',
      'aprobado',
    ]);
    const aprobada = await como(A).post(`/invoices/${f.id}/aprobar`);
    expect({
      status: aprobada.status,
      errorCode: aprobada.body.errorCode,
      detail: aprobada.body.detail,
    }).toEqual({
      status: 201,
      errorCode: undefined,
      detail: undefined,
    });
    expect((await aprobaciones(D2)).map((n) => n.title)).toEqual([
      expect.stringContaining('Aprobación aprobada'),
    ]);

    // Quien aprobó la factura (A) la paga: según la política.
    const venc = (
      (await como(A).get('/treasury/milestones').expect(200)).body as {
        id: string;
        invoiceId: string;
        pendingAmount: number;
      }[]
    ).find((m) => m.invoiceId === f.id)!;
    await como(A)
      .put('/grc/sod/politicas/aprobador_paga')
      .send({ modo: 'bloquear' })
      .expect(200);
    const pago = { importe: 100, fecha: hoy };
    const pagoBloqueado = await como(A)
      .post(`/treasury/milestones/${venc.id}/liquidaciones`)
      .send(pago);
    expect(pagoBloqueado.status).toBe(403);
    expect(pagoBloqueado.body.errorCode).toBe('SOD_CONFLICT');
    const politicas = (await como(A).get('/grc/sod/politicas').expect(200))
      .body;
    const pp = politicas.find(
      (p: { conflicto: string }) => p.conflicto === 'aprobador_paga',
    );
    await como(A)
      .put('/grc/sod/politicas/aprobador_paga')
      .set('If-Match', `"${pp.version}"`)
      .send({ modo: 'justificar' })
      .expect(200);
    expect(
      (
        await como(A)
          .post(`/treasury/milestones/${venc.id}/liquidaciones`)
          .send(pago)
      ).body.errorCode,
    ).toBe('SOD_JUSTIFICATION_REQUIRED');
    await como(A)
      .post(`/treasury/milestones/${venc.id}/liquidaciones`)
      .send({
        ...pago,
        justificacionSod: 'Pago urgente autorizado por dirección',
      })
      .expect(201);
    // Quien no aprobó paga sin conflicto.
    await como(D2)
      .post(`/treasury/milestones/${venc.id}/liquidaciones`)
      .send(pago)
      .expect(201);

    const eventos = (await como(G1).get('/grc/sod/eventos').expect(200))
      .body as { datos: { resultado: string; operacion: string } }[];
    expect(
      eventos.filter((e) => e.datos.resultado === 'bloqueado').length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      eventos
        .filter((e) => e.datos.resultado === 'permitido')
        .map((e) => e.datos.operacion),
    ).toEqual(expect.arrayContaining(['factura_compra', 'pago_factura']));
    await como(L).get('/grc/sod/eventos').expect(403);
    await como(G1)
      .post(`/grc/delegaciones/${del.id}/revocar`)
      .set('If-Match', `"${del.version}"`)
      .expect(200);
    const integridad = await como(A).get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('escalado por plazo vencido, reasignación y rechazo que cancela los niveles en espera', async () => {
    const obra = await createProject(app, A.token, { code: `OB-${u()}` });
    const prov = await createContact(app, A.token, {
      kind: 'proveedor',
      legalName: `Áridos ${u()} SL`,
    });
    const A2 = persona(await createUserWithRole(app, A.token, 'admin'));
    await como(A)
      .post('/aprobaciones/reglas')
      .send({
        nombre: 'Pedidos',
        operacion: 'pedido_compra',
        importeMinimo: 100,
        rolRequerido: 'gerente',
        niveles: [
          { importeMinimo: 0, rolRequerido: 'gerente', plazoHoras: 2 },
          { importeMinimo: 500, rolRequerido: 'admin' },
        ],
      })
      .expect(201);
    const pedido = async (amount: number) =>
      (
        await como(A)
          .post('/purchase-orders')
          .send({
            projectId: obra.id,
            contactId: prov.id,
            orderDate: '2026-11-02',
            description: 'Árido',
            amount,
          })
          .expect(201)
      ).body.id as string;

    const p1 = await pedido(300);
    const s = (
      await como(A)
        .post('/aprobaciones/solicitudes')
        .send({ operacion: 'pedido_compra', entidadId: p1 })
        .expect(201)
    ).body;
    expect(s).toMatchObject({ totalNiveles: 1, rolRequerido: 'gerente' });
    expect(
      (
        await como(G1).get('/aprobaciones/solicitudes?paraMi=true').expect(200)
      ).body.map((x: { id: string }) => x.id),
    ).toEqual([s.id]);

    // Antes del plazo no se escala; vencido, sube a admin y se avisa a los admin.
    expect(
      (await como(A).post('/aprobaciones/escalar').send({}).expect(200)).body,
    ).toEqual([]);
    const dentroDe3h = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const escaladas = (
      await como(D1)
        .post('/aprobaciones/escalar')
        .send({ referencia: dentroDe3h })
        .expect(200)
    ).body;
    expect(escaladas).toHaveLength(1);
    expect(escaladas[0]).toMatchObject({ rolRequerido: 'admin' });
    expect(escaladas[0].pasos[0]).toMatchObject({
      rolRequerido: 'admin',
      escalado: true,
    });
    expect(
      (
        await como(D1)
          .post('/aprobaciones/escalar')
          .send({ referencia: dentroDe3h })
          .expect(200)
      ).body,
    ).toEqual([]);
    expect((await aprobaciones(A2)).map((n) => n.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('Aprobación pendiente')]),
    );
    expect(
      (
        await como(G1)
          .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
          .send({})
      ).body.errorCode,
    ).toBe('APPROVAL_ROLE_INSUFFICIENT');

    // Reasignación: solo a quien tenga el rol y no haya solicitado.
    const actual = (
      await como(A).get(`/aprobaciones/solicitudes?entidadId=${p1}`).expect(200)
    ).body[0];
    const aGerente = await como(A)
      .post(`/aprobaciones/solicitudes/${s.id}/reasignar`)
      .send({ aprobadorId: G1.id, motivo: 'Probar' });
    expect(aGerente.body.errorCode).toBe('APPROVAL_USER_INVALID');
    await como(D1)
      .post(`/aprobaciones/solicitudes/${s.id}/reasignar`)
      .send({ aprobadorId: A2.id, motivo: 'Probar' })
      .expect(403);
    const reasignada = (
      await como(A)
        .post(`/aprobaciones/solicitudes/${s.id}/reasignar`)
        .set('If-Match', `"${actual.version}"`)
        .send({ aprobadorId: A2.id, motivo: 'Guardia de esta semana' })
        .expect(200)
    ).body;
    expect(reasignada.pasos[0]).toMatchObject({ aprobadorId: A2.id });
    await como(A2)
      .post(`/aprobaciones/solicitudes/${s.id}/aprobar`)
      .send({})
      .expect(200);

    // Dos niveles; el rechazo en el primero cancela el segundo y se avisa al solicitante.
    const p2 = await pedido(800);
    const s2 = (
      await como(D1)
        .post('/aprobaciones/solicitudes')
        .send({ operacion: 'pedido_compra', entidadId: p2 })
        .expect(201)
    ).body;
    expect(s2).toMatchObject({ totalNiveles: 2, rolRequerido: 'admin' });
    const r = (
      await como(G2)
        .post(`/aprobaciones/solicitudes/${s2.id}/rechazar`)
        .send({ motivo: 'Sin presupuesto en la partida' })
        .expect(200)
    ).body;
    expect(r).toMatchObject({ estado: 'rechazada' });
    expect(r.pasos.map((p: { estado: string }) => p.estado)).toEqual([
      'rechazado',
      'cancelado',
    ]);
    expect((await aprobaciones(D1)).map((n) => n.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('Aprobación rechazada')]),
    );
    const integridad = await como(A).get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });
});
