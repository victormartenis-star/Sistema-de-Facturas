import { createHash } from 'node:crypto';
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
 * Fase 5 (Bank Accounting): remesas SEPA XML (transferencias y adeudos,
 * generación determinista, remisión, devoluciones), conciliación bancaria
 * asistida (sugerencias, comisión, remesa, talón, desconciliación, período
 * cerrado, sin duplicidades) y previsión de liquidez por horizontes.
 */
describe('Banca: remesas SEPA, conciliación asistida y liquidez (integración)', () => {
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

  const hoy = new Date().toISOString().slice(0, 10);
  const IBAN_EMPRESA = 'ES9121000418450200051332';
  const IBAN_TERCERO = 'ES7921000813610123456789';
  const api = () => authed(app, token);
  const u = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  /** Saldo del mayor; 0 si aún no hay plan contable (ningún asiento todavía). */
  const saldo = async (cuenta: string) => {
    const res = await api().get(`/contabilidad/mayor/${cuenta}`);
    if (res.status === 404) return 0;
    expect(res.status).toBe(200);
    return res.body.saldoFinal as number;
  };
  const vencimiento = async (invoiceId: string) => {
    const lista = (await api().get('/treasury/milestones').expect(200))
      .body as { id: string; invoiceId: string; kind: string }[];
    const id = lista.find(
      (m) => m.invoiceId === invoiceId && m.kind === 'ordinario',
    )!.id;
    return (await api().get(`/treasury/milestones/${id}`).expect(200)).body as {
      id: string;
      pendingAmount: number;
      dueDate: string;
      settlements: { id: string; status: string; reference: string }[];
    };
  };
  const cuentaBanco = async () =>
    (
      await api()
        .post('/treasury/cuentas')
        .send({ name: `Banco ${u()}`, iban: IBAN_EMPRESA, bic: 'caixesbbxxx' })
        .expect(201)
    ).body as { id: string };

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
    numero = `FV-${u()}`,
  ) {
    const f = (
      await api()
        .post('/invoices')
        .send({
          kind: 'venta',
          contactId: clienteId,
          invoiceNumber: numero,
          issueDate: '2026-11-02',
          dueDate: '2026-12-02',
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

  async function extracto(cuentaId: string, lineas: string[]) {
    const csv = ['fecha;concepto;importe;saldo', ...lineas].join('\n');
    await api()
      .post('/bank-reconciliation/importar')
      .field('bankAccountId', cuentaId)
      .field('format', 'csv')
      .attach('file', Buffer.from(csv), {
        filename: 'extracto.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    return (
      await api()
        .get(`/bank-reconciliation/transacciones?bankAccountId=${cuentaId}`)
        .expect(200)
    ).body as {
      id: string;
      amount: number;
      concept: string;
      version: number;
    }[];
  }

  it('remesas SEPA: validación, XML determinista, remisión, devoluciones, idempotencia y adeudos', async () => {
    const obra = await createProject(app, token);
    const cuenta = await cuentaBanco();
    const conIban = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Hormigones Peñíscola SL',
      iban: IBAN_TERCERO,
    });
    const sinIban = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Ferralla Norte SL',
    });
    const f1 = await compra(obra.id, conIban.id, 1000);
    const f2 = await compra(obra.id, sinIban.id, 500);
    const v1 = await vencimiento(f1);
    const v2 = await vencimiento(f2);

    const clave = `rem-${u()}`;
    const crear = () =>
      api()
        .post('/tesoreria/remesas')
        .set('Idempotency-Key', clave)
        .send({
          bankAccountId: cuenta.id,
          tipo: 'transferencia',
          fechaEjecucion: hoy,
          vencimientoIds: [v1.id, v2.id],
        })
        .expect(201);
    const r = (await crear()).body;
    expect(r).toMatchObject({
      numero: `REM-${hoy.slice(0, 4)}-0001`,
      estado: 'borrador',
      total: v1.pendingAmount + v2.pendingAmount,
      numPartidas: 2,
    });
    // Idempotency-Key: el reintento devuelve la misma remesa, no otra.
    expect((await crear()).body.id).toBe(r.id);
    expect(
      (await api().get('/tesoreria/remesas').expect(200)).body,
    ).toHaveLength(1);

    // Un vencimiento no va en dos remesas vivas; un cobro no va en transferencias.
    const otra = await api()
      .post('/tesoreria/remesas')
      .send({
        bankAccountId: cuenta.id,
        tipo: 'transferencia',
        fechaEjecucion: hoy,
        vencimientoIds: [v1.id],
      });
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('SEPA_DUE_IN_REMITTANCE');
    const cliente = await createContact(app, token, {
      legalName: 'Promociones Atalaya SA',
    });
    const fv = await venta(obra.id, cliente.id, 100);
    const vfv = await vencimiento(fv);
    const mal = await api()
      .post('/tesoreria/remesas')
      .send({
        bankAccountId: cuenta.id,
        tipo: 'transferencia',
        fechaEjecucion: hoy,
        vencimientoIds: [vfv.id],
      });
    expect(mal.body.errorCode).toBe('SEPA_DUE_INVALID');

    // Sin IBAN del tercero no se genera: error por campo.
    const sinDatos = await api()
      .post(`/tesoreria/remesas/${r.id}/generar`)
      .set('If-Match', `"${r.version}"`);
    expect(sinDatos.status).toBe(422);
    expect(sinDatos.body.errorCode).toBe('SEPA_DATA_INVALID');
    const deFerralla = r.partidas.find(
      (p: { vencimientoId: string }) => p.vencimientoId === v2.id,
    );
    expect(sinDatos.body.errors).toEqual([
      expect.objectContaining({ field: `${deFerralla.endToEndId}.iban` }),
    ]);
    expect(sinDatos.headers['x-request-id']).toBeDefined();
    await api()
      .patch(`/contacts/${sinIban.id}`)
      .set('If-Match', `"${sinIban.version}"`)
      .send({ iban: IBAN_TERCERO })
      .expect(200);

    const gen = (
      await api()
        .post(`/tesoreria/remesas/${r.id}/generar`)
        .set('If-Match', `"${r.version}"`)
        .expect(200)
    ).body;
    expect(gen.estado).toBe('generada');
    expect(gen.xmlHash).toMatch(/^[0-9a-f]{64}$/);
    const xml1 = await api().get(`/tesoreria/remesas/${r.id}/xml`).expect(200);
    const xml2 = await api().get(`/tesoreria/remesas/${r.id}/xml`).expect(200);
    expect(xml1.headers['content-type']).toContain('application/xml');
    expect(xml1.text).toBe(xml2.text);
    expect(createHash('sha256').update(xml1.text, 'utf8').digest('hex')).toBe(
      gen.xmlHash,
    );
    expect(xml1.text).toContain('pain.001.001.03');
    expect(xml1.text).toContain(`<CtrlSum>${r.total.toFixed(2)}</CtrlSum>`);
    expect(xml1.text).toContain('<BIC>CAIXESBBXXX</BIC>');
    expect(xml1.text).toContain('<Nm>Hormigones Peniscola SL</Nm>');

    // Remitir: versión antigua rechazada; luego liquida y contabiliza.
    const vieja = await api()
      .post(`/tesoreria/remesas/${r.id}/remitir`)
      .set('If-Match', `"${r.version}"`)
      .send({ fecha: hoy });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const banco0 = await saldo('5720');
    const rem = (
      await api()
        .post(`/tesoreria/remesas/${r.id}/remitir`)
        .set('If-Match', `"${gen.version}"`)
        .send({ fecha: hoy })
        .expect(200)
    ).body;
    expect(rem.estado).toBe('remitida');
    expect((await vencimiento(f1)).pendingAmount).toBe(0);
    expect((await vencimiento(f2)).pendingAmount).toBe(0);
    expect(await saldo('5720')).toBeCloseTo(banco0 - r.total, 2);
    const p1 = rem.partidas.find(
      (p: { vencimientoId: string }) => p.vencimientoId === v1.id,
    );
    const p2 = rem.partidas.find(
      (p: { vencimientoId: string }) => p.vencimientoId === v2.id,
    );
    const liq = (await vencimiento(f1)).settlements[0];
    expect(liq.reference).toBe(p1.endToEndId);
    const bloqueada = await api()
      .post(`/treasury/liquidaciones/${liq.id}/anular`)
      .send({ motivo: 'Prueba' });
    expect(bloqueada.body.errorCode).toBe('SEPA_SETTLEMENT_LOCKED');
    const anularRemitida = await api()
      .post(`/tesoreria/remesas/${r.id}/anular`)
      .send({ motivo: 'Error' });
    expect(anularRemitida.status).toBe(409);
    expect(anularRemitida.body.errorCode).toBe('SEPA_INVALID_TRANSITION');

    // Devolución de una partida: la deuda vuelve, el asiento se revierte.
    const dev = (
      await api()
        .post(`/tesoreria/remesas/${r.id}/partidas/${p1.id}/devolver`)
        .set('If-Match', `"${rem.version}"`)
        .send({ fecha: hoy, motivo: 'AC04 cuenta cancelada' })
        .expect(200)
    ).body;
    expect(dev.estado).toBe('remitida');
    expect(
      dev.partidas.find((p: { id: string }) => p.id === p1.id),
    ).toMatchObject({
      estado: 'devuelta',
      motivoDevolucion: 'AC04 cuenta cancelada',
    });
    expect((await vencimiento(f1)).pendingAmount).toBe(v1.pendingAmount);
    expect(await saldo('5720')).toBeCloseTo(banco0 - v2.pendingAmount, 2);
    const otraVez = await api()
      .post(`/tesoreria/remesas/${r.id}/partidas/${p1.id}/devolver`)
      .send({ fecha: hoy, motivo: 'Otra vez' });
    expect(otraVez.body.errorCode).toBe('SEPA_ITEM_NOT_RETURNABLE');
    const todas = (
      await api()
        .post(`/tesoreria/remesas/${r.id}/partidas/${p2.id}/devolver`)
        .send({ fecha: hoy, motivo: 'MS02 sin motivo' })
        .expect(200)
    ).body;
    expect(todas.estado).toBe('devuelta');
    expect(await saldo('5720')).toBeCloseTo(banco0, 2);

    // Adeudos directos CORE: exige mandato; con él, pain.008 FRST.
    const r2 = (
      await api()
        .post('/tesoreria/remesas')
        .send({
          bankAccountId: cuenta.id,
          tipo: 'adeudo',
          fechaEjecucion: hoy,
          vencimientoIds: [vfv.id],
        })
        .expect(201)
    ).body;
    const sinMandato = await api().post(`/tesoreria/remesas/${r2.id}/generar`);
    expect(sinMandato.body.errorCode).toBe('SEPA_DATA_INVALID');
    expect(
      sinMandato.body.errors.map((e: { field: string }) => e.field),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\.iban$/),
        expect.stringMatching(/\.mandato$/),
      ]),
    );
    await api()
      .patch(`/contacts/${cliente.id}`)
      .set('If-Match', `"${cliente.version}"`)
      .send({
        iban: IBAN_TERCERO,
        sepaMandateRef: 'MND-ATALAYA-1',
        sepaMandateDate: '2025-01-10',
      })
      .expect(200);
    await api().post(`/tesoreria/remesas/${r2.id}/generar`).expect(200);
    const dd = await api().get(`/tesoreria/remesas/${r2.id}/xml`).expect(200);
    expect(dd.text).toContain('pain.008.001.02');
    expect(dd.text).toContain('<SeqTp>FRST</SeqTp>');
    expect(dd.text).toContain('<MndtId>MND-ATALAYA-1</MndtId>');
    expect(dd.text).toMatch(/<Id>ES\d{2}000B00000000<\/Id><SchmeNm>/);
    const anulada = (
      await api()
        .post(`/tesoreria/remesas/${r2.id}/anular`)
        .send({ motivo: 'Cliente paga por transferencia' })
        .expect(200)
    ).body;
    expect(anulada.estado).toBe('anulada');
    expect(anulada.partidas[0].estado).toBe('excluida');

    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken).get('/tesoreria/remesas').expect(200);
    await authed(app, lector.accessToken)
      .post(`/tesoreria/remesas/${r2.id}/generar`)
      .expect(403);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('conciliación asistida: sugerencias, comisión, remesa, talón, desconciliación y período cerrado', async () => {
    const obra = await createProject(app, token);
    const cuenta = await cuentaBanco();
    const prov = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Andamios Levante SL',
      iban: IBAN_TERCERO,
    });
    const cliente = await createContact(app, token, {
      legalName: 'Promociones Atalaya SA',
    });
    const numero = `FV-${u()}`;
    const fv = await venta(obra.id, cliente.id, 1000, numero);
    const fc = await compra(obra.id, prov.id, 1000);
    const fc2 = await compra(obra.id, prov.id, 500);
    const vfc = await vencimiento(fc);
    const vfc2 = await vencimiento(fc2);

    // Remesa remitida de un pago y talón emitido de otro.
    const r = (
      await api()
        .post('/tesoreria/remesas')
        .send({
          bankAccountId: cuenta.id,
          tipo: 'transferencia',
          fechaEjecucion: hoy,
          vencimientoIds: [vfc.id],
        })
        .expect(201)
    ).body;
    await api().post(`/tesoreria/remesas/${r.id}/generar`).expect(200);
    await api()
      .post(`/tesoreria/remesas/${r.id}/remitir`)
      .send({ fecha: hoy })
      .expect(200);
    const tal = (
      await api()
        .post('/tesoreria/talonarios')
        .send({
          bankAccountId: cuenta.id,
          prefijo: 'tal',
          primero: 1,
          ultimo: 10,
        })
        .expect(201)
    ).body;
    const talon = (
      await api()
        .post('/tesoreria/talones')
        .send({
          direccion: 'emitido',
          vencimientoId: vfc2.id,
          importe: vfc2.pendingAmount,
          fechaEmision: '2026-11-20',
          talonarioId: tal.id,
        })
        .expect(201)
    ).body;
    expect(await saldo('5729')).toBeCloseTo(-vfc2.pendingAmount, 2);

    const movs = await extracto(cuenta.id, [
      `${hoy};TRANSF PROMOCIONES ATALAYA ${numero};1205.00;10000`,
      `${hoy};CARGO REMESA ${r.numero};-${r.total.toFixed(2)};9000`,
      `${hoy};CARGO REMESA DUPLICADO;-${r.total.toFixed(2)};8000`,
      `${hoy};PAGO TALON ${talon.numero};-${vfc2.pendingAmount.toFixed(2)};7000`,
      `${hoy};COMISION MANTENIMIENTO;-12.30;6990`,
    ]);
    const mov = (c: string) => movs.find((m) => m.concept.startsWith(c))!;

    const sug = (
      await api()
        .get(
          `/bank-reconciliation/asistida/sugerencias?bankAccountId=${cuenta.id}`,
        )
        .expect(200)
    ).body as {
      transactionId: string;
      sugerencias: {
        tipo: string;
        id: string;
        comision: number;
        confianza: string;
      }[];
    }[];
    const de = (m: { id: string }) =>
      sug.find((s) => s.transactionId === m.id)!.sugerencias;
    // Importe con comisión (25) + 6 días (16) + referencia (25) + tercero (5) = 71.
    expect(de(mov('TRANSF'))[0]).toMatchObject({
      tipo: 'vencimiento',
      comision: 5,
      confianza: hoy === '2026-11-26' ? 'media' : expect.any(String),
    });
    expect(de(mov('CARGO REMESA REM'))[0]).toMatchObject({
      tipo: 'remesa',
      id: r.id,
      comision: 0,
    });
    expect(de(mov('PAGO TALON'))[0]).toMatchObject({
      tipo: 'talon',
      id: talon.id,
    });
    expect(de(mov('COMISION'))).toEqual([]);

    // Remesa: solo enlaza (ya contabilizada al remitir); no se concilia dos veces.
    const banco0 = await saldo('5720');
    await api()
      .post(
        `/bank-reconciliation/transacciones/${mov('CARGO REMESA REM').id}/conciliacion`,
      )
      .set('Idempotency-Key', `c-${u()}`)
      .send({ tipo: 'remesa', id: r.id })
      .expect(200);
    expect(await saldo('5720')).toBeCloseTo(banco0, 2);
    const duplicada = await api()
      .post(
        `/bank-reconciliation/transacciones/${mov('CARGO REMESA DUP').id}/conciliacion`,
      )
      .send({ tipo: 'remesa', id: r.id });
    expect(duplicada.status).toBe(409);
    expect(duplicada.body.errorCode).toBe('BANK_RECON_TARGET_TAKEN');
    const liqRemesa = (await vencimiento(fc)).settlements[0];
    const comoLiq = await api()
      .post(
        `/bank-reconciliation/transacciones/${mov('CARGO REMESA DUP').id}/conciliacion`,
      )
      .send({ tipo: 'liquidacion', id: liqRemesa.id });
    expect(comoLiq.body.errorCode).toBe('BANK_RECON_TARGET_INVALID');

    // Cobro neto de comisión: liquida el bruto y contabiliza 6260 a 5720.
    const transf = mov('TRANSF');
    const vieja = await api()
      .post(`/bank-reconciliation/transacciones/${transf.id}/conciliacion`)
      .set('If-Match', `"${transf.version + 1}"`)
      .send({
        tipo: 'vencimiento',
        id: (await vencimiento(fv)).id,
        comision: 5,
      });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    const noCuadra = await api()
      .post(`/bank-reconciliation/transacciones/${transf.id}/conciliacion`)
      .send({
        tipo: 'vencimiento',
        id: (await vencimiento(fv)).id,
        comision: 50,
      });
    expect(noCuadra.body.errorCode).toBe('BANK_DIFFERENCE_MISMATCH');
    const conc = (
      await api()
        .post(`/bank-reconciliation/transacciones/${transf.id}/conciliacion`)
        .set('If-Match', `"${transf.version}"`)
        .send({
          tipo: 'vencimiento',
          id: (await vencimiento(fv)).id,
          comision: 5,
        })
        .expect(200)
    ).body;
    expect(conc).toMatchObject({
      reconciliationKind: 'vencimiento',
      feeAmount: 5,
      version: transf.version + 1,
    });
    expect((await vencimiento(fv)).pendingAmount).toBe(0);
    expect(await saldo('6260')).toBe(5);
    expect(await saldo('5720')).toBeCloseTo(banco0 + 1205, 2);

    // Talón: el extracto prueba la compensación (5729 ↔ 5720 a su fecha).
    await api()
      .post(
        `/bank-reconciliation/transacciones/${mov('PAGO TALON').id}/conciliacion`,
      )
      .send({ tipo: 'talon', id: talon.id })
      .expect(200);
    expect(
      (await api().get(`/tesoreria/talones/${talon.id}`).expect(200)).body
        .estado,
    ).toBe('cobrado');
    expect(await saldo('5729')).toBeCloseTo(0, 2);

    // Comisión sin documento; un abono no es comisión.
    await api()
      .post(
        `/bank-reconciliation/transacciones/${mov('COMISION').id}/conciliacion`,
      )
      .send({ tipo: 'comision' })
      .expect(200);
    expect(await saldo('6260')).toBeCloseTo(17.3, 2);

    // Desconciliar con anulación: la deuda vuelve y la comisión se revierte.
    const desc = (
      await api()
        .post(`/bank-reconciliation/transacciones/${transf.id}/desconciliacion`)
        .set('If-Match', `"${conc.version}"`)
        .send({ anularLiquidacion: true, motivo: 'Era de otro cliente' })
        .expect(200)
    ).body;
    expect(desc).toMatchObject({ reconciliationKind: null, feeAmount: 0 });
    expect((await vencimiento(fv)).pendingAmount).toBe(1210);
    expect(await saldo('6260')).toBeCloseTo(12.3, 2);
    const dos = await api()
      .post(`/bank-reconciliation/transacciones/${transf.id}/desconciliacion`)
      .send({});
    expect(dos.body.errorCode).toBe('BANK_MOVEMENT_NOT_RECONCILED');

    // Período cerrado: ni se concilia con asiento ni se desconcilia lo contabilizado.
    const oct = await extracto(cuenta.id, [
      '2026-10-15;COMISION OCTUBRE;-9.99;5000',
      '2026-10-16;COMISION TRANSFERENCIA OCT;-4.00;4996',
    ]);
    const c1 = oct.find((m) => m.concept === 'COMISION OCTUBRE')!;
    const c2 = oct.find((m) => m.concept === 'COMISION TRANSFERENCIA OCT')!;
    await api()
      .post(`/bank-reconciliation/transacciones/${c1.id}/conciliacion`)
      .send({ tipo: 'comision' })
      .expect(200);
    await api().post('/contabilidad/periodos/2026/10/cerrar').expect(200);
    const desCerrado = await api()
      .post(`/bank-reconciliation/transacciones/${c1.id}/desconciliacion`)
      .send({});
    expect(desCerrado.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const concCerrado = await api()
      .post(`/bank-reconciliation/transacciones/${c2.id}/conciliacion`)
      .send({ tipo: 'comision' });
    expect(concCerrado.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');
    const estado = (
      await api().get(`/bank-reconciliation/transacciones/${c2.id}`).expect(200)
    ).body;
    expect(estado).toMatchObject({
      reconciliationKind: null,
      version: c2.version,
    });
    expect(
      (
        await api()
          .get(`/bank-reconciliation/transacciones/${c1.id}`)
          .expect(200)
      ).body.reconciliationKind,
    ).toBe('comision');

    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get(
        `/bank-reconciliation/asistida/sugerencias?bankAccountId=${cuenta.id}`,
      )
      .expect(200);
    await authed(app, lector.accessToken)
      .post(`/bank-reconciliation/transacciones/${transf.id}/conciliacion`)
      .send({ tipo: 'comision' })
      .expect(403);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('previsión de liquidez: saldo contable sin 5729, cartera, talones, compras, cuenta y obra', async () => {
    const obra = await createProject(app, token);
    const otraObra = await createProject(app, token);
    const cuenta = await cuentaBanco();
    const prov = await createContact(app, token, {
      kind: 'proveedor',
      legalName: 'Grúas Sur SL',
    });
    const cliente = await createContact(app, token, {
      legalName: 'Promociones Atalaya SA',
    });
    await api()
      .post('/contabilidad/asientos')
      .send({
        fecha: '2026-11-01',
        concepto: 'Aportación',
        lineas: [
          { cuenta: '5720', debe: 10000, haber: 0 },
          { cuenta: '1000', debe: 0, haber: 10000 },
        ],
      })
      .expect(201);
    await venta(obra.id, cliente.id, 1000); // cobro 1210 el 2026-12-02
    const fc = await compra(otraObra.id, prov.id, 500);
    const vfc = await vencimiento(fc);
    const tal = (
      await api()
        .post('/tesoreria/talonarios')
        .send({
          bankAccountId: cuenta.id,
          prefijo: 'pr',
          primero: 1,
          ultimo: 5,
        })
        .expect(201)
    ).body;
    await api()
      .post('/tesoreria/talones')
      .send({
        direccion: 'emitido',
        vencimientoId: vfc.id,
        importe: vfc.pendingAmount,
        fechaEmision: '2026-11-20',
        fechaVencimiento: '2026-12-10',
        talonarioId: tal.id,
      })
      .expect(201);
    await api()
      .post('/compras/pedidos')
      .send({
        projectId: obra.id,
        contactId: prov.id,
        fecha: '2026-11-02',
        descripcion: 'Encofrado',
        lineas: [
          {
            tipo: 'servicio',
            descripcion: 'Encofrado',
            cantidad: 1,
            precioUnitario: 500,
          },
        ],
      })
      .expect(201);

    const url = '/tesoreria/liquidez?desde=2026-11-26';
    const p = (await api().get(url).expect(200)).body;
    expect((await api().get(url).expect(200)).body).toEqual(p);
    expect(p).toMatchObject({
      fuenteSaldo: 'contable',
      saldoInicial: 10000,
      saldoTransito5729: -vfc.pendingAmount,
      supuestos: { plazoCobroDias: 60, plazoPagoDias: 60 },
    });
    expect(p.horizontes.map((h: { dias: number }) => h.dias)).toEqual([
      7, 30, 60, 90,
    ]);
    const [h7, h30, h60] = p.horizontes;
    expect(h7.porCategoria.cobros.entradas).toBe(1210);
    expect(h7.porCategoria.talones.salidas).toBe(0);
    expect(h30.porCategoria.talones.salidas).toBe(vfc.pendingAmount);
    expect(h30.porCategoria.compras.salidas).toBe(0);
    expect(h60.porCategoria.compras.salidas).toBe(500); // 2026-11-02 + 60 días
    expect(h60.saldoFinal).toBeCloseTo(
      10000 + 1210 - vfc.pendingAmount - 500,
      2,
    );
    expect(
      p.cuentas.map((c: { bankAccountId: string }) => c.bankAccountId),
    ).toContain(cuenta.id);
    expect(p.semanas.length).toBeGreaterThan(10);

    const mal = await api().get('/tesoreria/liquidez?horizontes=0,400');
    expect(mal.status).toBe(422);
    expect(mal.body.errorCode).toBe('LIQ_HORIZON_INVALID');

    // Por cuenta: saldo declarado y solo lo asignado a la cuenta (el talón).
    const porCuenta = (
      await api()
        .get(`${url}&bankAccountId=${cuenta.id}&horizontes=30`)
        .expect(200)
    ).body;
    expect(porCuenta.fuenteSaldo).toBe('cuenta');
    expect(porCuenta.horizontes[0]).toMatchObject({
      entradas: 0,
      salidas: vfc.pendingAmount,
    });

    // Rol obra: solo sus obras y sin saldo de bancos.
    const jefe = await createObraUser(app, token, [obra.id]);
    await authed(app, jefe.tokens.accessToken).get(url).expect(403);
    await authed(app, jefe.tokens.accessToken)
      .get(`${url}&projectId=${otraObra.id}`)
      .expect(403);
    const deObra = (
      await authed(app, jefe.tokens.accessToken)
        .get(`${url}&projectId=${obra.id}&horizontes=90`)
        .expect(200)
    ).body;
    expect(deObra).toMatchObject({
      fuenteSaldo: 'ninguno',
      saldoInicial: 0,
      cuentas: [],
    });
    expect(deObra.horizontes[0].porCategoria).toMatchObject({
      cobros: { entradas: 1210, salidas: 0 },
      talones: { entradas: 0, salidas: 0 },
      compras: { entradas: 0, salidas: 500 },
    });
  });
});
