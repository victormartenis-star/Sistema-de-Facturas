import { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getDb } from '@erp/db';
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
 * Contabilidad general: plan PGC, asientos manuales con cuadre, contra-
 * asientos, períodos, interfaz contable (facturas y cobros) y los informes
 * de libro mayor y sumas y saldos. Además, las garantías de la base:
 * trigger de cuadre e inmutabilidad de las líneas.
 */
describe('Contabilidad general (integración)', () => {
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

  const asiento = (lineas: unknown[], fecha = '2026-03-15') => ({
    fecha,
    concepto: 'Aportación de capital',
    lineas,
  });

  it('inicializa el plan PGC de forma idempotente', async () => {
    const r1 = await authed(app, token)
      .post('/contabilidad/cuentas/inicializar')
      .expect(200);
    expect(r1.body.creadas).toBeGreaterThan(20);
    const r2 = await authed(app, token)
      .post('/contabilidad/cuentas/inicializar')
      .expect(200);
    expect(r2.body.creadas).toBe(0);
    const cuentas = await authed(app, token)
      .get('/contabilidad/cuentas?q=Bancos')
      .expect(200);
    expect(cuentas.body.map((c: { codigo: string }) => c.codigo)).toContain(
      '5720',
    );
  });

  it('asiento manual cuadrado: numeración correlativa, mayor y sumas y saldos', async () => {
    const obra = await createProject(app, token);
    const a1 = await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '5720', debe: 10000 },
          { cuenta: '1000', haber: 10000 },
        ]),
      )
      .expect(201);
    expect(a1.body.numero).toBe(1);
    expect(a1.body.totalDebe).toBe(10000);

    const a2 = await authed(app, token)
      .post('/contabilidad/asientos')
      .send({
        fecha: '2026-04-02',
        concepto: 'Alquiler de grúa',
        lineas: [
          { cuenta: '6210', debe: 1200.5, projectId: obra.id },
          { cuenta: '5720', haber: 1200.5 },
        ],
      })
      .expect(201);
    expect(a2.body.numero).toBe(2);

    const mayor = await authed(app, token)
      .get('/contabilidad/mayor/5720?desde=2026-04-01')
      .expect(200);
    expect(mayor.body.saldoInicial).toBe(10000);
    expect(mayor.body.movimientos).toHaveLength(1);
    expect(mayor.body.saldoFinal).toBe(8799.5);

    const ss = await authed(app, token)
      .get('/contabilidad/sumas-saldos')
      .expect(200);
    expect(ss.body.cuadra).toBe(true);
    expect(ss.body.totalDebe).toBe(11200.5);

    const porObra = await authed(app, token)
      .get(`/contabilidad/sumas-saldos?projectId=${obra.id}`)
      .expect(200);
    expect(porObra.body.filas).toEqual([
      expect.objectContaining({ codigo: '6210', saldoDeudor: 1200.5 }),
    ]);
  });

  it('rechaza un asiento descuadrado y cuentas de agrupación con errorCode', async () => {
    const descuadrado = await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '5720', debe: 100 },
          { cuenta: '1000', haber: 99.99 },
        ]),
      );
    expect(descuadrado.status).toBe(400);
    expect(descuadrado.headers['content-type']).toMatch(/problem\+json/);

    const agrupacion = await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '572', debe: 100 },
          { cuenta: '1000', haber: 100 },
        ]),
      );
    expect(agrupacion.status).toBe(422);
    expect(agrupacion.body.errorCode).toBe('LEDGER_ACCOUNT_NOT_POSTABLE');

    const inexistente = await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '5729', debe: 100 },
          { cuenta: '1000', haber: 100 },
        ]),
      );
    expect(inexistente.body.errorCode).toBe('LEDGER_ACCOUNT_NOT_FOUND');
  });

  it('período cerrado bloquea asientos; reabrirlo los permite', async () => {
    await authed(app, token)
      .post('/contabilidad/periodos/2026/3/cerrar')
      .expect(200);
    const res = await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '5720', debe: 1 },
          { cuenta: '1000', haber: 1 },
        ]),
      );
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('FISCAL_PERIOD_CLOSED');

    const periodos = await authed(app, token)
      .get('/contabilidad/periodos/2026')
      .expect(200);
    expect(periodos.body[2].estado).toBe('cerrado');

    await authed(app, token)
      .post('/contabilidad/periodos/2026/3/reabrir')
      .expect(200);
    await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '5720', debe: 1 },
          { cuenta: '1000', haber: 1 },
        ]),
      )
      .expect(201);
  });

  it('anular genera un contra-asiento y deja el saldo a cero; no se anula dos veces', async () => {
    const a = await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '5720', debe: 500 },
          { cuenta: '1000', haber: 500 },
        ]),
      )
      .expect(201);
    const contra = await authed(app, token)
      .post(`/contabilidad/asientos/${a.body.id}/anular`)
      .set('If-Match', `"${a.body.version}"`)
      .send({ motivo: 'Error de importe' })
      .expect(201);
    expect(contra.body.origen).toBe('anulacion');
    expect(contra.body.anulaAId).toBe(a.body.id);
    expect(contra.body.lineas[0]).toMatchObject({ cuenta: '5720', haber: 500 });

    const original = await authed(app, token)
      .get(`/contabilidad/asientos/${a.body.id}`)
      .expect(200);
    expect(original.body.estado).toBe('anulado');

    const mayor = await authed(app, token)
      .get('/contabilidad/mayor/5720')
      .expect(200);
    expect(mayor.body.saldoFinal).toBe(0);

    const otraVez = await authed(app, token)
      .post(`/contabilidad/asientos/${a.body.id}/anular`)
      .send({ motivo: 'Otra vez' });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.errorCode).toBe('JOURNAL_ENTRY_ALREADY_REVERSED');
  });

  it('interfaz contable: factura de venta y su cobro, idempotente y reversible', async () => {
    const obra = await createProject(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const factura = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-05-10',
        dueDate: '2026-06-10',
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
    await authed(app, token)
      .post(`/invoices/${factura.body.id}/aprobar`)
      .expect(201);

    const r1 = await authed(app, token)
      .post('/contabilidad/interfaz/contabilizar')
      .expect(200);
    expect(r1.body.contabilizados).toBe(1);
    const r2 = await authed(app, token)
      .post('/contabilidad/interfaz/contabilizar')
      .expect(200);
    expect(r2.body.contabilizados).toBe(0);

    const diario = await authed(app, token)
      .get('/contabilidad/asientos?origen=factura_venta')
      .expect(200);
    expect(diario.body.total).toBe(1);
    const lineas = diario.body.items[0].lineas;
    expect(lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '4300', debe: 1210 }),
        expect.objectContaining({
          cuenta: '7050',
          haber: 1000,
          projectId: obra.id,
        }),
        expect.objectContaining({ cuenta: '4770', haber: 210 }),
      ]),
    );

    // Cobro: se liquida el vencimiento y la interfaz lo contabiliza.
    const [vto] = (await authed(app, token).get('/treasury/milestones')).body;
    await authed(app, token)
      .post(`/treasury/milestones/${vto.id}/pagar`)
      .expect(204);
    const r3 = await authed(app, token)
      .post('/contabilidad/interfaz/contabilizar')
      .expect(200);
    expect(r3.body.contabilizados).toBe(1);
    const clientes = await authed(app, token)
      .get('/contabilidad/mayor/4300')
      .expect(200);
    expect(clientes.body.saldoFinal).toBe(0);

    // Reabrir el vencimiento: la interfaz anula el asiento del cobro.
    await authed(app, token)
      .post(`/treasury/milestones/${vto.id}/reabrir`)
      .expect(204);
    const r4 = await authed(app, token)
      .post('/contabilidad/interfaz/contabilizar')
      .expect(200);
    expect(r4.body.anulados).toBe(1);
    const clientes2 = await authed(app, token)
      .get('/contabilidad/mayor/4300')
      .expect(200);
    expect(clientes2.body.saldoFinal).toBe(1210);
  });

  it('el rol obra no accede y el lector no contabiliza', async () => {
    const obraUser = await createUserWithRole(app, token, 'obra');
    await authed(app, obraUser.accessToken)
      .get('/contabilidad/cuentas')
      .expect(403);
    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken)
      .get('/contabilidad/sumas-saldos')
      .expect(200);
    await authed(app, lector.accessToken)
      .post('/contabilidad/interfaz/contabilizar')
      .expect(403);
  });

  it('la base rechaza modificar líneas contabilizadas y asientos descuadrados', async () => {
    await authed(app, token)
      .post('/contabilidad/asientos')
      .send(
        asiento([
          { cuenta: '5720', debe: 10 },
          { cuenta: '1000', haber: 10 },
        ]),
      )
      .expect(201);
    const db = getDb();
    await expect(
      db.execute(
        sql`update journal_entry_lines set debit = 11 where debit = 10`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from journal_entries`),
    ).rejects.toThrow();
    // Insertar una línea suelta descuadra el asiento: el trigger diferido lo rechaza.
    await expect(
      db.execute(sql`
        insert into journal_entry_lines (company_id, entry_id, line_no, account_id, debit, credit)
        select je.company_id, je.id, 9, jl.account_id, 5, 0
        from journal_entries je join journal_entry_lines jl on jl.entry_id = je.id
        limit 1`),
    ).rejects.toThrow();
  });
});
