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
 * Fase 4: talones y cheques bancarios (talonarios, emisión, compensación,
 * anulación, devolución, período cerrado, sin duplicidades) y Project System
 * (retenciones de obra y subcontrata, liberación por hito y sustitución por
 * aval, modificados del contrato de subcontrata).
 */
describe('Talones bancarios y Project System (integración)', () => {
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
  const saldo = async (cuenta: string) =>
    (await api().get(`/contabilidad/mayor/${cuenta}`).expect(200)).body
      .saldoFinal as number;
  const vencimientoDe = async (invoiceId: string, kind: string) =>
    (
      (await api().get('/treasury/milestones').expect(200)).body as {
        id: string;
        invoiceId: string;
        kind: string;
      }[]
    ).find((m) => m.invoiceId === invoiceId && m.kind === kind)!.id;

  /** Factura de compra aprobada por cuadre con pedido (servicio, sin recepción). */
  async function compra(obraId: string, proveedorId: string, base: number) {
    const po = (
      await api()
        .post('/compras/pedidos')
        .send({
          projectId: obraId,
          contactId: proveedorId,
          fecha: '2026-11-02',
          descripcion: 'Servicio',
          lineas: [
            {
              tipo: 'servicio',
              descripcion: 'Servicio',
              cantidad: 1,
              precioUnitario: base,
            },
          ],
        })
        .expect(201)
    ).body;
    const f = (
      await api()
        .post(`/compras/pedidos/${po.id}/factura`)
        .send({
          invoiceNumber: `FC-${u()}`,
          issueDate: '2026-11-03',
          lineas: [
            { lineaId: po.lineas[0].id, cantidad: 1, precioUnitario: base },
          ],
        })
        .expect(201)
    ).body;
    await api().post(`/invoices/${f.factura.id}/aprobar`).expect(201);
    return f.factura.id as string;
  }

  async function venta(
    obraId: string,
    clienteId: string,
    base: number,
    retencion?: { pct: number; libera: string },
  ) {
    const f = (
      await api()
        .post('/invoices')
        .send({
          kind: 'venta',
          contactId: clienteId,
          invoiceNumber: `FV-${u()}`,
          issueDate: '2026-11-02',
          dueDate: '2026-12-02',
          ...(retencion
            ? {
                retentionPct: retencion.pct,
                retentionReleaseDate: retencion.libera,
              }
            : {}),
          lines: [
            {
              description: 'Certificación',
              baseAmount: base,
              vatPct: 21,
              projectId: obraId,
            },
          ],
        })
        .expect(201)
    ).body;
    await api().post(`/invoices/${f.id}/aprobar`).expect(201);
    return f.id as string;
  }

  it('talones emitidos: talonario, emisión, compensación, anulación, agotamiento y sin duplicidades', async () => {
    const obra = await createProject(app, token);
    const prov = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Ferralla Norte SL',
    });
    const cuenta = (
      await api()
        .post('/treasury/cuentas')
        .send({ name: 'Banco Talones' })
        .expect(201)
    ).body;
    const tal = (
      await api()
        .post('/tesoreria/talonarios')
        .set('Idempotency-Key', `tal-${u()}`)
        .send({
          bankAccountId: cuenta.id,
          prefijo: 'tal',
          primero: 1,
          ultimo: 2,
        })
        .expect(201)
    ).body;
    expect(tal).toMatchObject({
      prefijo: 'TAL',
      siguiente: 1,
      disponibles: 2,
      estado: 'activo',
    });
    const solapa = await api()
      .post('/tesoreria/talonarios')
      .send({ bankAccountId: cuenta.id, primero: 2, ultimo: 5 });
    expect(solapa.body.errorCode).toBe('CHECK_BOOK_OVERLAP');

    const f1 = await compra(obra.id, prov.id, 1000);
    const v1 = await vencimientoDe(f1, 'ordinario');
    const t1 = (
      await api()
        .post('/tesoreria/talones')
        .set('Idempotency-Key', `t-${u()}`)
        .send({
          direccion: 'emitido',
          vencimientoId: v1,
          importe: 1210,
          fechaEmision: '2026-11-20',
          fechaVencimiento: '2026-11-25',
          talonarioId: tal.id,
        })
        .expect(201)
    ).body;
    expect(t1).toMatchObject({
      numero: 'TAL0000001',
      estado: 'emitido',
      importe: 1210,
      contactName: 'Ferralla Norte SL',
    });
    const venc = (await api().get(`/treasury/milestones/${v1}`).expect(200))
      .body;
    expect(venc.pendingAmount).toBe(0);
    expect(venc.settlements[0]).toMatchObject({
      paymentInstrument: 'talon',
      reference: 'Talón TAL0000001',
    });
    // Contabilizado al emitir contra 5729; la interfaz no lo duplica.
    expect(await saldo('5729')).toBe(-1210);
    await interfaz();
    expect(await saldo('5729')).toBe(-1210);
    // La liquidación del talón no se anula desde tesorería.
    const suelta = await api()
      .post(`/treasury/liquidaciones/${t1.liquidacionId}/anular`)
      .send({ motivo: 'Prueba' });
    expect(suelta.status).toBe(409);
    expect(suelta.body.errorCode).toBe('CHECK_SETTLEMENT_LOCKED');

    const antes = await api()
      .post(`/tesoreria/talones/${t1.id}/acciones`)
      .set('If-Match', `"${t1.version}"`)
      .send({ accion: 'cobrar', fecha: '2026-11-24' });
    expect(antes.body.errorCode).toBe('CHECK_DATE_INVALID');
    const ent = (
      await api()
        .post(`/tesoreria/talones/${t1.id}/acciones`)
        .set('If-Match', `"${t1.version}"`)
        .send({ accion: 'entregar', fecha: '2026-11-21' })
        .expect(200)
    ).body;
    expect(ent).toMatchObject({
      estado: 'entregado',
      fechaEntrega: '2026-11-21',
    });
    const vieja = await api()
      .post(`/tesoreria/talones/${t1.id}/acciones`)
      .set('If-Match', `"${t1.version}"`)
      .send({ accion: 'cobrar', fecha: '2026-11-25' });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const cob = (
      await api()
        .post(`/tesoreria/talones/${t1.id}/acciones`)
        .set('Idempotency-Key', `c-${u()}`)
        .set('If-Match', `"${ent.version}"`)
        .send({ accion: 'cobrar', fecha: '2026-11-25' })
        .expect(200)
    ).body;
    expect(cob).toMatchObject({ estado: 'cobrado', fechaCobro: '2026-11-25' });
    expect(cob.asientoCompensacionId).toEqual(expect.any(String));
    expect(await saldo('5729')).toBe(0);
    expect(await saldo('5720')).toBe(-1210);
    const anularCobrado = await api()
      .post(`/tesoreria/talones/${t1.id}/acciones`)
      .send({ accion: 'anular', fecha: '2026-11-26', motivo: 'Error' });
    expect(anularCobrado.status).toBe(409);
    expect(anularCobrado.body.errorCode).toBe('CHECK_INVALID_TRANSITION');

    // Segundo talón: agota el talonario; el tercero no tiene número.
    const f2 = await compra(obra.id, prov.id, 100);
    const v2 = await vencimientoDe(f2, 'ordinario');
    const t2 = (
      await api()
        .post('/tesoreria/talones')
        .send({
          direccion: 'emitido',
          vencimientoId: v2,
          importe: 121,
          fechaEmision: '2026-11-22',
          talonarioId: tal.id,
        })
        .expect(201)
    ).body;
    expect(t2.numero).toBe('TAL0000002');
    expect(
      (await api().get('/tesoreria/talonarios').expect(200)).body[0],
    ).toMatchObject({ estado: 'agotado', disponibles: 0 });
    const agotado = await api().post('/tesoreria/talones').send({
      direccion: 'emitido',
      vencimientoId: v2,
      importe: 1,
      fechaEmision: '2026-11-22',
      talonarioId: tal.id,
    });
    expect(agotado.status).toBe(409);
    expect(agotado.body.errorCode).toBe('CHECK_BOOK_EXHAUSTED');
    // Un talón emitido no paga un vencimiento de cobro.
    const cli = await createContact(app, token, { kind: 'cliente' });
    const fv = await venta(obra.id, cli.id, 100);
    const mal = await api()
      .post('/tesoreria/talones')
      .send({
        direccion: 'emitido',
        vencimientoId: await vencimientoDe(fv, 'ordinario'),
        importe: 1,
        fechaEmision: '2026-11-22',
        talonarioId: tal.id,
      });
    expect(mal.body.errorCode).toBe('CHECK_DIRECTION_MISMATCH');

    // Anular el segundo: la deuda vuelve a estar viva y el asiento se revierte.
    const sinMotivo = await api()
      .post(`/tesoreria/talones/${t2.id}/acciones`)
      .send({ accion: 'anular', fecha: '2026-11-23' });
    expect(sinMotivo.body.errorCode).toBe('CHECK_REASON_REQUIRED');
    const an = (
      await api()
        .post(`/tesoreria/talones/${t2.id}/acciones`)
        .send({
          accion: 'anular',
          fecha: '2026-11-23',
          motivo: 'Importe erróneo',
        })
        .expect(200)
    ).body;
    expect(an).toMatchObject({
      estado: 'anulado',
      fechaBaja: '2026-11-23',
      motivo: 'Importe erróneo',
    });
    expect(
      (await api().get(`/treasury/milestones/${v2}`).expect(200)).body
        .pendingAmount,
    ).toBe(121);
    expect(await saldo('5729')).toBe(0);
    const r = (await interfaz()).body;
    expect(r.anulados).toBe(0);
    expect(await saldo('5729')).toBe(0);
    const otraVez = await api()
      .post(`/tesoreria/talones/${t2.id}/acciones`)
      .send({ accion: 'anular', fecha: '2026-11-23', motivo: 'Otra vez' });
    expect(otraVez.body.errorCode).toBe('CHECK_INVALID_TRANSITION');
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('cheques recibidos: depósito, cobro, devolución impagado y período cerrado', async () => {
    const obra = await createProject(app, token);
    const cli = await createContact(app, token, {
      kind: 'cliente',
      legalName: 'Promotora Sol SA',
    });
    const cuenta = (
      await api()
        .post('/treasury/cuentas')
        .send({ name: 'Banco Cobros' })
        .expect(201)
    ).body;
    const fv = await venta(obra.id, cli.id, 1000);
    const v = await vencimientoDe(fv, 'ordinario');
    const ch = (
      await api()
        .post('/tesoreria/talones')
        .send({
          direccion: 'recibido',
          vencimientoId: v,
          importe: 1210,
          fechaEmision: '2026-11-20',
          bankAccountId: cuenta.id,
          numero: 'CH-778',
        })
        .expect(201)
    ).body;
    expect(ch).toMatchObject({
      estado: 'emitido',
      numero: 'CH-778',
      talonarioId: null,
    });
    expect(await saldo('5729')).toBe(1210);
    const dup = await api().post('/tesoreria/talones').send({
      direccion: 'recibido',
      vencimientoId: v,
      importe: 1,
      fechaEmision: '2026-11-20',
      bankAccountId: cuenta.id,
      numero: 'CH-778',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('CHECK_NUMBER_DUPLICATE');
    const dep = (
      await api()
        .post(`/tesoreria/talones/${ch.id}/acciones`)
        .send({ accion: 'entregar', fecha: '2026-11-21' })
        .expect(200)
    ).body;
    const cob = (
      await api()
        .post(`/tesoreria/talones/${ch.id}/acciones`)
        .set('If-Match', `"${dep.version}"`)
        .send({ accion: 'cobrar', fecha: '2026-11-22' })
        .expect(200)
    ).body;
    expect(await saldo('5720')).toBe(1210);
    expect(await saldo('5729')).toBe(0);
    // Devuelto impagado: se revierten la compensación y el cobro.
    const dev = (
      await api()
        .post(`/tesoreria/talones/${ch.id}/acciones`)
        .set('If-Match', `"${cob.version}"`)
        .send({
          accion: 'devolver',
          fecha: '2026-11-24',
          motivo: 'Impagado: sin fondos',
        })
        .expect(200)
    ).body;
    expect(dev).toMatchObject({
      estado: 'devuelto',
      motivo: 'Impagado: sin fondos',
    });
    expect(await saldo('5720')).toBe(0);
    expect(await saldo('5729')).toBe(0);
    expect(
      (await api().get(`/treasury/milestones/${v}`).expect(200)).body
        .pendingAmount,
    ).toBe(1210);
    expect(await saldo('4300')).toBe(0); // la factura aún no ha pasado por la interfaz
    await interfaz();
    expect(await saldo('4300')).toBe(1210);

    // Período cerrado: la emisión se rechaza y no deja nada.
    await api().post('/contabilidad/periodos/2026/10/cerrar').expect(200);
    const cerrado = await api().post('/tesoreria/talones').send({
      direccion: 'recibido',
      vencimientoId: v,
      importe: 100,
      fechaEmision: '2026-10-30',
      bankAccountId: cuenta.id,
      numero: 'CH-900',
    });
    expect(cerrado.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    expect(
      (
        await api().get('/tesoreria/talones?direccion=recibido').expect(200)
      ).body.map((t: { numero: string }) => t.numero),
    ).toEqual(['CH-778']);
    const futura = await api().post('/tesoreria/talones').send({
      direccion: 'recibido',
      vencimientoId: v,
      importe: 1,
      fechaEmision: '2999-01-01',
      bankAccountId: cuenta.id,
      numero: 'CH-X',
    });
    expect(futura.body.errorCode).toBe('CHECK_DATE_INVALID');

    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken).get('/tesoreria/talones').expect(200);
    await authed(app, lector.accessToken)
      .post(`/tesoreria/talones/${ch.id}/acciones`)
      .send({ accion: 'anular', fecha: '2026-11-24', motivo: 'x' })
      .expect(403);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('Project System: retenciones de obra y subcontrata, sustitución por aval, hito y modificados', async () => {
    const obra = await createProject(app, token);
    const contacto = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Estructuras del Turia SL',
      taxId: 'B46000001',
    });
    const prov = (
      await api()
        .post('/proveedores')
        .send({
          razonSocial: 'Estructuras del Turia SL',
          cifNif: 'B46000001',
          tipo: 'subcontrata',
          contactId: contacto.id,
        })
        .expect(201)
    ).body;
    const contrato = (
      await api()
        .post(`/proveedores/${prov.id}/contratos`)
        .send({
          proveedorId: prov.id,
          proyectoId: obra.id,
          numeroContrato: `SUB-${u()}`,
          fechaInicio: '2026-09-01',
          fechaFinPrevista: '2027-03-31',
          importeTotal: 100_000,
          retencionGarantiaPct: 5,
        })
        .expect(201)
    ).body;
    await api()
      .patch(`/proveedores/contratos/${contrato.id}`)
      .send({ status: 'activo' })
      .expect(200);
    const cert = (
      await api()
        .post(`/subcontratas/contratos/${contrato.id}/certificaciones`)
        .send({
          fecha: '2026-10-28',
          periodoDesde: '2026-10-01',
          periodoHasta: '2026-10-28',
          importeOrigen: 25_000,
        })
        .expect(201)
    ).body;
    const ap = (
      await api()
        .post(`/subcontratas/certificaciones/${cert.id}/aprobar`)
        .expect(201)
    ).body;
    await api()
      .post(`/subcontratas/certificaciones/${cert.id}/factura-compra`)
      .set('If-Match', `"${ap.version}"`)
      .send({ invoiceNumber: `ETU-${u()}`, issueDate: '2026-10-31' })
      .expect(201);
    // Retención que nos hace el cliente: 5 % de 1.000.
    const cli = await createContact(app, token, {
      kind: 'cliente',
      legalName: 'Promotora Sol SA',
    });
    await venta(obra.id, cli.id, 1000, { pct: 5, libera: '2027-06-30' });

    const ret0 = (
      await api()
        .get(`/project-system/obras/${obra.id}/retenciones`)
        .expect(200)
    ).body;
    expect(ret0.resumen.pago).toMatchObject({
      retenido: 1250,
      pendiente: 1250,
      liberable: 0,
      enGarantia: 1250,
    });
    expect(ret0.resumen.cobro).toMatchObject({ retenido: 50, enGarantia: 50 });
    const rPago = ret0.retenciones.find(
      (r: { lado: string }) => r.lado === 'pago',
    );
    const rCobro = ret0.retenciones.find(
      (r: { lado: string }) => r.lado === 'cobro',
    );

    // Aval de la subcontrata: insuficiente, de otro tipo y finalmente válido.
    const aval = (importe: number, tipo = 'retencion_garantia') =>
      api()
        .post('/avales')
        .send({
          referencia: `AV-${u()}`,
          tipo,
          direccion: 'recibido',
          entidad: 'Banco Sub',
          importe,
          fechaEmision: '2026-11-01',
          projectId: obra.id,
          contactId: contacto.id,
        })
        .expect(201);
    const corto = (await aval(1000)).body;
    const liberar = (avalId: string, ids: string[]) =>
      api()
        .post(`/project-system/obras/${obra.id}/liberaciones`)
        .set('Idempotency-Key', `lib-${u()}`)
        .send({
          tipo: 'aval',
          fecha: '2026-11-25',
          vencimientoIds: ids,
          avalId,
          motivo: 'Sustitución de retención por aval',
        });
    expect(
      (await liberar(corto.id, [rPago.vencimientoId])).body.errorCode,
    ).toBe('PS_GUARANTEE_INSUFFICIENT');
    const otroTipo = (await aval(5000, 'buena_ejecucion')).body;
    expect(
      (await liberar(otroTipo.id, [rPago.vencimientoId])).body.errorCode,
    ).toBe('PS_GUARANTEE_INVALID');
    expect(
      (await liberar(corto.id, [rPago.vencimientoId, rCobro.vencimientoId]))
        .body.errorCode,
    ).toBe('PS_RETENTION_MIXED');
    const bueno = (await aval(1500)).body;
    const lib = (await liberar(bueno.id, [rPago.vencimientoId]).expect(201))
      .body;
    expect(lib).toMatchObject({
      tipo: 'aval',
      lado: 'pago',
      importe: 1250,
      estado: 'vigente',
    });
    const ret1 = (
      await api()
        .get(`/project-system/obras/${obra.id}/retenciones?fecha=2026-11-26`)
        .expect(200)
    ).body;
    expect(ret1.resumen.pago).toMatchObject({
      liberable: 1250,
      sustituidoAval: 1250,
      enGarantia: 0,
    });
    const linea = ret1.retenciones.find(
      (r: { vencimientoId: string }) => r.vencimientoId === rPago.vencimientoId,
    );
    expect(linea).toMatchObject({
      vencimiento: '2026-11-25',
      vencimientoOriginal: rPago.vencimiento,
    });
    expect(linea.liberacion).toMatchObject({ tipo: 'aval', avalId: bueno.id });
    expect(
      (await liberar(bueno.id, [rPago.vencimientoId])).body.errorCode,
    ).toBe('PS_RETENTION_ALREADY_RELEASED');
    // El aval no se libera por debajo de lo que sustituye.
    const reduce = await api()
      .post(`/avales/${bueno.id}/liberar`)
      .send({ fecha: '2026-11-26', importe: 500, motivo: 'Reducción' });
    expect(reduce.status).toBe(409);
    expect(reduce.body.errorCode).toBe('PS_GUARANTEE_SUBSTITUTING');

    // Pagada la retención liberada, la liberación ya no se deshace.
    await api()
      .post(`/treasury/milestones/${rPago.vencimientoId}/liquidaciones`)
      .send({ importe: 1250, fecha: '2026-11-26' })
      .expect(201);
    const deshacer = await api()
      .post(`/project-system/liberaciones/${lib.id}/anular`)
      .set('If-Match', `"${lib.version}"`)
      .send({ motivo: 'Error' });
    expect(deshacer.status).toBe(409);
    expect(deshacer.body.errorCode).toBe('PS_RELEASE_SETTLED');

    // Hito sobre la retención del cliente: se adelanta y se deshace.
    const hito = (
      await api()
        .post(`/project-system/obras/${obra.id}/liberaciones`)
        .send({
          tipo: 'hito',
          fecha: '2026-11-26',
          vencimientoIds: [rCobro.vencimientoId],
          motivo: 'Recepción provisional de la obra',
        })
        .expect(201)
    ).body;
    expect(
      (
        await api()
          .get(`/treasury/milestones/${rCobro.vencimientoId}`)
          .expect(200)
      ).body.dueDate,
    ).toBe('2026-11-26');
    const deshecha = (
      await api()
        .post(`/project-system/liberaciones/${hito.id}/anular`)
        .set('If-Match', `"${hito.version}"`)
        .send({ motivo: 'Recepción aplazada' })
        .expect(200)
    ).body;
    expect(deshecha.estado).toBe('anulado');
    expect(
      (
        await api()
          .get(`/treasury/milestones/${rCobro.vencimientoId}`)
          .expect(200)
      ).body.dueDate,
    ).toBe('2027-06-30');
    expect(
      (
        await api()
          .get(`/project-system/obras/${obra.id}/liberaciones`)
          .expect(200)
      ).body,
    ).toHaveLength(2);

    // Modificados del contrato de subcontrata: no por debajo de lo certificado.
    const bajo = await api()
      .post(`/project-system/subcontratas/${contrato.id}/modificados`)
      .send({
        fecha: '2026-11-20',
        importe: -80_000,
        motivo: 'Reducción de alcance',
      });
    expect(bajo.body.errorCode).toBe('PS_CHANGE_BELOW_CERTIFIED');
    const mods = (
      await api()
        .post(`/project-system/subcontratas/${contrato.id}/modificados`)
        .set('Idempotency-Key', `m-${u()}`)
        .send({
          fecha: '2026-11-20',
          importe: 20_000,
          motivo: 'Ampliación: forjado adicional',
        })
        .expect(201)
    ).body;
    expect(mods).toEqual([
      expect.objectContaining({
        numero: 1,
        importe: 20000,
        importeAnterior: 100000,
        importeNuevo: 120000,
      }),
    ]);
    // La certificación siguiente ya puede superar el importe original.
    await api()
      .post(`/subcontratas/contratos/${contrato.id}/certificaciones`)
      .send({
        fecha: '2026-11-25',
        periodoDesde: '2026-10-29',
        periodoHasta: '2026-11-25',
        importeOrigen: 110_000,
      })
      .expect(201);

    // Acceso por obra y permisos.
    const ajeno = await createObraUser(app, token, []);
    await authed(app, ajeno.tokens.accessToken)
      .get(`/project-system/obras/${obra.id}/retenciones`)
      .expect(404);
    const jefe = await createObraUser(app, token, [obra.id]);
    await authed(app, jefe.tokens.accessToken)
      .get(`/project-system/obras/${obra.id}/retenciones`)
      .expect(200);
    await authed(app, jefe.tokens.accessToken)
      .post(`/project-system/obras/${obra.id}/liberaciones`)
      .send({
        tipo: 'hito',
        fecha: '2026-11-26',
        vencimientoIds: [rCobro.vencimientoId],
        motivo: 'Intento',
      })
      .expect(403);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });
});
