import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { companies, getDb, users } from '@erp/db';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  loginUser,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Consolidación de grupo: dos sociedades reales (A matriz, B filial) con
 * operaciones intragrupo contabilizadas por la interfaz contable de cada
 * una; eliminación en el consolidado, descuadres intercompañía, socios
 * externos, tesorería, ajustes, cierres, aislamiento por permisos y cadena
 * de auditoría.
 */
describe('Consolidación de grupo / holding (integración)', () => {
  let app: INestApplication;
  let companyA: string;
  let companyB: string;
  const NIF_A = 'B00000000';
  const NIF_B = 'B99999999';
  const PASSWORD = 'Test1234!';
  let tokenA: string;
  let emailA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await createTestApp();
    companyA = await seedCompany();
    // B con fecha antigua: el alta pública sigue yendo a A (la más reciente).
    const [b] = await getDb()
      .insert(companies)
      .values({
        name: 'Filial de Pruebas SL',
        taxId: 'B-99.999.999',
        createdAt: new Date('2000-01-01T00:00:00Z'),
      })
      .returning();
    companyB = b.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clienteFilial = null;
    await resetTestDb();
    emailA = `holding-a-${Date.now()}@test.dintel.es`;
    tokenA = (await registerUser(app, { email: emailA, password: PASSWORD }))
      .accessToken;
    // Admin de B: mismo hash de contraseña, empresa B.
    const db = getDb();
    const [ua] = await db.select().from(users).where(eq(users.email, emailA));
    const emailB = `holding-b-${Date.now()}@test.dintel.es`;
    await db.insert(users).values({
      companyId: companyB,
      email: emailB,
      passwordHash: ua.passwordHash,
      fullName: 'Admin Filial',
      role: 'admin',
    });
    tokenB = (await loginUser(app, emailB, PASSWORD)).accessToken;
  });

  const A = () => authed(app, tokenA);
  const B = () => authed(app, tokenB);
  const u = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const PERIODO = 'desde=2026-01-01&hasta=2026-12-31';

  let clienteFilial: string | null = null;

  /** A vende a B (factura de venta aprobada en A). */
  async function ventaA(base: number) {
    clienteFilial ??= (
      await createContact(app, tokenA, {
        kind: 'cliente',
        legalName: `Filial ${u()}`,
        taxId: NIF_B,
      })
    ).id;
    const cliente = { id: clienteFilial };
    const f = await A()
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-${u()}`,
        issueDate: '2026-03-10',
        dueDate: '2026-04-10',
        lines: [{ description: 'Servicios', baseAmount: base, vatPct: 21 }],
      })
      .expect(201);
    await A().post(`/invoices/${f.body.id}/aprobar`).expect(201);
  }

  /** B compra a A (o a un tercero): pedido, albarán validado y factura aprobada en B. */
  async function compraB(base: number, nif = NIF_A) {
    const proveedor = await createContact(app, tokenB, {
      kind: 'proveedor',
      legalName: `Proveedor ${u()}`,
      taxId: nif,
    });
    const obra = await createProject(app, tokenB, { code: `OB-${u()}` });
    const pedido = await B()
      .post('/purchase-orders')
      .send({
        projectId: obra.id,
        contactId: proveedor.id,
        orderDate: '2026-03-01',
        description: 'Servicios intragrupo',
        amount: base,
      })
      .expect(201);
    const alb = await B()
      .post('/delivery-notes')
      .send({
        contactId: proveedor.id,
        orderId: pedido.body.id,
        noteNumber: `ALB-${u()}`,
        noteDate: '2026-03-05',
        amount: base,
      })
      .expect(201);
    await B().post(`/delivery-notes/${alb.body.id}/validar`).expect(201);
    const f = await B()
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: proveedor.id,
        invoiceNumber: `FC-${u()}`,
        issueDate: '2026-03-10',
        deliveryNoteIds: [alb.body.id],
        lines: [
          {
            description: 'Servicios',
            baseAmount: base,
            vatPct: 21,
            projectId: obra.id,
          },
        ],
      })
      .expect(201);
    await B().post(`/invoices/${f.body.id}/aprobar`).expect(201);
  }

  async function contabilizar() {
    await A().post('/contabilidad/interfaz/contabilizar').expect(200);
    await B().post('/contabilidad/interfaz/contabilizar').expect(200);
  }

  /** B autoriza a A; A crea el grupo e integra a B. */
  async function grupo(pct = 100) {
    await B().post('/holding/permisos').send({ email: emailA }).expect(201);
    const g = await A()
      .post('/holding/grupos')
      .send({ nombre: `Grupo ${u()}` })
      .expect(201);
    const r = await A()
      .post(`/holding/grupos/${g.body.id}/miembros`)
      .send({
        companyId: companyB,
        participacionPct: pct,
        fechaAlta: '2026-01-01',
      })
      .expect(201);
    return r.body as {
      id: string;
      miembros: { id: string; companyId: string; version: number }[];
    };
  }

  it('consolida dos sociedades y elimina las operaciones y saldos intragrupo', async () => {
    await ventaA(1000);
    await compraB(1000);
    await contabilizar();
    const g = await grupo();

    const r = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    const ingreso = r.body.porMasa.find(
      (f: { clave: string }) => f.clave === 'ingreso',
    );
    expect(ingreso.porSociedad[companyA]).toBe(1000);
    expect(ingreso).toMatchObject({
      agregado: 1000,
      eliminaciones: -1000,
      consolidado: 0,
    });
    const gasto = r.body.porMasa.find(
      (f: { clave: string }) => f.clave === 'gasto',
    );
    expect(gasto.porSociedad[companyB]).toBe(1000);
    expect(gasto.consolidado).toBe(0);
    expect(r.body.conciliacionIntragrupo).toEqual([
      expect.objectContaining({
        vendedor: companyA,
        comprador: companyB,
        ventas: 1000,
        compras: 1000,
        cobrar: 1210,
        pagar: 1210,
        descuadre: false,
      }),
    ]);
    expect(r.body).toMatchObject({
      descuadreIntercompania: false,
      eliminacionesAutomaticas: 2210,
      cerrado: false,
    });
    expect(r.body.totales).toMatchObject({ resultado: 0, descuadreBalance: 0 });

    const t = await A()
      .get(`/holding/grupos/${g.id}/tesoreria?hasta=2026-12-31`)
      .expect(200);
    expect(t.body).toMatchObject({
      cobrosPendientes: 0,
      pagosPendientes: 0,
      intragrupoEliminado: { cobros: 1210, pagos: 1210 },
    });
    expect(t.body.cartera).toHaveLength(2);
  });

  it('detecta descuadres intercompañía, no cierra sin forzar y congela el periodo', async () => {
    await ventaA(1000);
    await ventaA(500); // B no la ha registrado
    await compraB(1000);
    await contabilizar();
    const g = await grupo();

    const ic = await A()
      .get(`/holding/grupos/${g.id}/intercompania?${PERIODO}`)
      .expect(200);
    expect(ic.body.descuadre).toBe(true);
    expect(ic.body.conciliacion[0]).toMatchObject({
      ventas: 1500,
      compras: 1000,
      diferenciaOperaciones: 500,
      diferenciaSaldos: 605,
    });
    const e = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    // El descuadre queda en 5550 (grupo 5) y el balance sigue cuadrando.
    expect(e.body.totales.descuadreBalance).toBe(0);

    const sinForzar = await A()
      .post(`/holding/grupos/${g.id}/cierres`)
      .send({ desde: '2026-01-01', hasta: '2026-12-31' });
    expect(sinForzar.status).toBe(409);
    expect(sinForzar.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(sinForzar.body.errorCode).toBe('INTERCOMPANY_MISMATCH');

    await A()
      .post(`/holding/grupos/${g.id}/cierres`)
      .send({ desde: '2026-01-01', hasta: '2026-12-31', forzar: true })
      .expect(201);
    const otra = await A()
      .post(`/holding/grupos/${g.id}/cierres`)
      .send({ desde: '2026-01-01', hasta: '2026-12-31', forzar: true });
    expect(otra.body.errorCode).toBe('CONSOLIDATION_PERIOD_CLOSED');
    const cerrado = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    expect(cerrado.body.cerrado).toBe(true);
    const ajuste = await A().post(`/holding/grupos/${g.id}/ajustes`).send({
      fecha: '2026-06-30',
      concepto: 'Ajuste tardío',
      cuentaDebe: '7050',
      cuentaHaber: '5550',
      importe: 500,
    });
    expect(ajuste.body.errorCode).toBe('CONSOLIDATION_PERIOD_CLOSED');
  });

  it('socios externos con participación < 100 % y ajustes manuales con If-Match', async () => {
    await compraB(1000, 'A11111111'); // compra a un tercero
    await contabilizar();
    const g = await grupo();
    const filial = g.miembros.find((m) => m.companyId === companyB)!;
    await A()
      .patch(`/holding/grupos/${g.id}/miembros/${filial.id}`)
      .send({ participacionPct: 60 })
      .expect(428);
    await A()
      .patch(`/holding/grupos/${g.id}/miembros/${filial.id}`)
      .set('If-Match', `"${filial.version}"`)
      .send({ participacionPct: 60 })
      .expect(200);
    const r = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    // B pierde 1.000 (gasto con un tercero): el 40 % es de socios externos.
    expect(r.body.sociosExternos.resultado).toBe(-400);
    expect(r.body.resultadoAtribuidoDominante).toBe(-600);

    const aj = await A()
      .post(`/holding/grupos/${g.id}/ajustes`)
      .set('Idempotency-Key', '3f3e7a4c-2b1d-4c3e-9f8a-7b6c5d4e3f21')
      .send({
        fecha: '2026-06-30',
        concepto: 'Reclasificación de gasto a partidas pendientes',
        cuentaDebe: '5550',
        cuentaHaber: '6000',
        importe: 1000,
      })
      .expect(201);
    const tras = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    expect(tras.body.totales.gastos).toBe(0);
    expect(tras.body.ajustesManuales).toHaveLength(1);
    await A()
      .post(`/holding/grupos/${g.id}/ajustes/${aj.body.id}/anular`)
      .set('If-Match', `"${aj.body.version}"`)
      .send({ motivo: 'Duplicado' })
      .expect(200);
    const anulada = await A()
      .post(`/holding/grupos/${g.id}/ajustes/${aj.body.id}/anular`)
      .send({ motivo: 'Otra vez' });
    expect(anulada.status).toBe(409);
  });

  it('aislamiento: sin permiso de la filial no se integra ni se consolida', async () => {
    const g = await A()
      .post('/holding/grupos')
      .send({ nombre: 'Grupo sin permiso' })
      .expect(201);
    const sinPermiso = await A()
      .post(`/holding/grupos/${g.body.id}/miembros`)
      .send({
        companyId: companyB,
        participacionPct: 100,
        fechaAlta: '2026-01-01',
      });
    expect(sinPermiso.status).toBe(403);
    expect(sinPermiso.body.errorCode).toBe('HOLDING_COMPANY_ACCESS_DENIED');
    expect(sinPermiso.body.correlationId).toEqual(expect.any(String));

    const gr = await grupo();
    const dup = await A().post(`/holding/grupos/${gr.id}/miembros`).send({
      companyId: companyB,
      participacionPct: 50,
      fechaAlta: '2026-02-01',
    });
    expect(dup.body.errorCode).toBe('HOLDING_MEMBER_DUPLICATE');

    // Listado de varios grupos (carga agrupada): cada uno con sus miembros.
    const lista = await A().get('/holding/grupos').expect(200);
    const porNombre = new Map(
      lista.body.map((x: { nombre: string; miembros: unknown[] }) => [
        x.nombre,
        x.miembros.length,
      ]),
    );
    expect(porNombre.get('Grupo sin permiso')).toBe(1);
    expect(lista.body).toHaveLength(2);
    expect(
      lista.body.find((x: { id: string }) => x.id === gr.id).miembros,
    ).toHaveLength(2);

    // La filial revoca el permiso: el consolidado deja de ser accesible.
    const permisos = await B().get('/holding/permisos').expect(200);
    await B()
      .post(`/holding/permisos/${permisos.body[0].id}/revocar`)
      .expect(200);
    const corte = await A().get(`/holding/grupos/${gr.id}/estados?${PERIODO}`);
    expect(corte.status).toBe(403);
    expect(corte.body).toMatchObject({
      errorCode: 'HOLDING_COMPANY_ACCESS_DENIED',
      sociedades: [companyB],
    });
    // B no ve los grupos de A.
    const ajeno = await B().get(`/holding/grupos/${gr.id}`);
    expect(ajeno.status).toBe(404);
    expect(ajeno.body.errorCode).toBe('HOLDING_NOT_FOUND');
    // Las sociedades accesibles de A vuelven a ser solo la suya.
    const soc = await A().get('/holding/sociedades').expect(200);
    expect(soc.body.map((s: { companyId: string }) => s.companyId)).toEqual([
      companyA,
    ]);

    // Cadenas de auditoría íntegras en ambas sociedades.
    for (const c of [A, B]) {
      const integ = await c().get('/audit/verify-integrity').expect(200);
      expect(integ.body.integra).toBe(true);
    }
    const audit = await A()
      .get('/audit?entityType=corporate_group_member')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBeGreaterThanOrEqual(2);
  });

  it('roles: el rol obra no accede a la consolidación', async () => {
    const obra = await A()
      .post('/users')
      .send({
        email: `obra-${u()}@test.dintel.es`,
        password: PASSWORD,
        fullName: 'Jefe',
        role: 'obra',
      })
      .expect(201);
    const t = await loginUser(app, obra.body.email, PASSWORD);
    await authed(app, t.accessToken).get('/holding/grupos').expect(403);
  });
});
