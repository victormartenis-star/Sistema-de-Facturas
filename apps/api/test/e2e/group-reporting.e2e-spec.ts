import { INestApplication } from '@nestjs/common';
import {
  authed,
  createTestApp,
  createUserWithRole,
  loginUser,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Group Reporting (Fase 8): alta controlada de sociedades por API y su
 * vinculación al grupo, eliminación inversión–patrimonio neto con socios
 * externos y fondo de comercio, puesta en equivalencia, conversión de
 * moneda extranjera con diferencia de conversión (CTA), permisos y cadena
 * de auditoría. Todas las sociedades salvo la matriz nacen por la API.
 */
describe('Group Reporting: sociedades, inversión–PN y moneda extranjera (integración)', () => {
  let app: INestApplication;
  let companyA: string;
  let tokenA: string;
  const PASSWORD = 'Test1234!';

  beforeAll(async () => {
    app = await createTestApp();
    companyA = await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    tokenA = (
      await registerUser(app, {
        email: `gr-a-${Date.now()}@test.dintel.es`,
        password: PASSWORD,
      })
    ).accessToken;
    await A().post('/contabilidad/cuentas/inicializar').expect(200);
  });

  const A = () => authed(app, tokenA);
  const u = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const nif = () => `B${u().slice(-8).toUpperCase()}`;

  async function nuevoGrupo(nombre = `Grupo ${u()}`) {
    const g = await A().post('/holding/grupos').send({ nombre }).expect(201);
    return g.body as { id: string };
  }

  /** Alta por API con admin propio; devuelve id, token del admin y miembro. */
  async function altaSociedad(body: Record<string, unknown>) {
    const email = `gr-soc-${u()}@test.dintel.es`;
    const r = await A()
      .post('/holding/sociedades')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        nombre: `Sociedad ${u()}`,
        nif: nif(),
        administrador: { email, password: PASSWORD, fullName: 'Admin filial' },
        ...body,
      })
      .expect(201);
    const token = (await loginUser(app, email, PASSWORD)).accessToken;
    return {
      id: r.body.id as string,
      miembroId: r.body.miembroId as string | null,
      as: () => authed(app, token),
    };
  }

  type Cliente = ReturnType<typeof authed>;
  async function asiento(
    c: Cliente,
    fecha: string,
    lineas: { cuenta: string; debe?: number; haber?: number }[],
  ) {
    await c
      .post('/contabilidad/asientos')
      .send({ fecha, concepto: 'Asiento de prueba', lineas })
      .expect(201);
  }

  const fila = (body: { porMasa: { clave: string }[] }, clave: string) =>
    body.porMasa.find((f) => f.clave === clave) as unknown as {
      consolidado: number;
      porSociedad: Record<string, number>;
    };

  it('alta de sociedad por API: plan, admin, vínculo al grupo, idempotencia y permisos', async () => {
    const g = await nuevoGrupo();
    const clave = crypto.randomUUID();
    const email = `gr-admin-${u()}@test.dintel.es`;
    const cuerpo = {
      nombre: 'Dintel Filial SL',
      nif: nif(),
      monedaFuncional: 'eur',
      administrador: { email, password: PASSWORD, fullName: 'Admin Filial' },
      grupo: {
        grupoId: g.id,
        participacionPct: 80,
        fechaAlta: '2026-01-01',
        costeInversion: 900,
      },
    };
    const r = await A()
      .post('/holding/sociedades')
      .set('Idempotency-Key', clave)
      .send(cuerpo)
      .expect(201);
    expect(r.body).toMatchObject({
      nombre: 'Dintel Filial SL',
      monedaFuncional: 'EUR',
      altaPorCompanyId: companyA,
      administrador: { email },
      version: 1,
    });
    expect(r.body.miembroId).toEqual(expect.any(String));
    // Reintento con la misma clave: misma respuesta, sin segunda sociedad.
    const replay = await A()
      .post('/holding/sociedades')
      .set('Idempotency-Key', clave)
      .send(cuerpo)
      .expect(201);
    expect(replay.body.id).toBe(r.body.id);
    const dup = await A()
      .post('/holding/sociedades')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ ...cuerpo, administrador: undefined, grupo: undefined });
    expect(dup.status).toBe(409);
    expect(dup.headers['content-type']).toContain('application/problem+json');
    expect(dup.body.errorCode).toBe('GROUP_COMPANY_NIF_DUPLICATE');
    expect(dup.headers['x-request-id']).toEqual(expect.any(String));

    // Vinculada al grupo con sus parámetros de inversión.
    const grupo = await A().get(`/holding/grupos/${g.id}`).expect(200);
    const miembro = grupo.body.miembros.find(
      (m: { companyId: string }) => m.companyId === r.body.id,
    );
    expect(miembro).toMatchObject({
      participacionPct: 80,
      metodo: 'global',
      costeInversion: 900,
      cuentaInversion: '2403',
      patrimonioAdquisicion: null,
      monedaFuncional: 'EUR',
      accesible: true,
    });
    // Quien la creó la gestiona y la ve como accesible.
    const gest = await A().get('/holding/sociedades/gestionadas').expect(200);
    expect(gest.body.map((s: { id: string }) => s.id).sort()).toEqual(
      [companyA, r.body.id].sort(),
    );
    // El admin de la nueva sociedad entra y tiene su PGC base.
    const filial = authed(
      app,
      (await loginUser(app, email, PASSWORD)).accessToken,
    );
    const cuentas = await filial.get('/contabilidad/cuentas').expect(200);
    expect(
      (cuentas.body.items ?? cuentas.body).some(
        (c: { codigo: string }) => c.codigo === '2403',
      ),
    ).toBe(true);
    // La filial no ve el grupo de A.
    expect((await filial.get(`/holding/grupos/${g.id}`)).status).toBe(404);

    // Edición con If-Match: sin cabecera 428, con versión 200.
    await A()
      .patch(`/holding/sociedades/${r.body.id}`)
      .send({ nombre: 'Dintel Filial Renombrada SL' })
      .expect(428);
    const ed = await A()
      .patch(`/holding/sociedades/${r.body.id}`)
      .set('If-Match', '"1"')
      .send({ nombre: 'Dintel Filial Renombrada SL' })
      .expect(200);
    expect(ed.body.version).toBe(2);
    // La filial no puede editar a la matriz (no la gestiona).
    const ajena = await filial
      .patch(`/holding/sociedades/${companyA}`)
      .set('If-Match', '"1"')
      .send({ nombre: 'Intento' });
    expect(ajena.status).toBe(404);
    expect(ajena.body.errorCode).toBe('GROUP_COMPANY_NOT_FOUND');

    // Permisos: solo admin da de alta sociedades; gerente no.
    const gerente = await createUserWithRole(app, tokenA, 'gerente');
    const g403 = await authed(app, gerente.accessToken)
      .post('/holding/sociedades')
      .send({ nombre: 'No autorizada SL', nif: nif() });
    expect(g403.status).toBe(403);
    // Puesta en equivalencia sin coste: 422 con código semántico.
    const sinCoste = await A()
      .post('/holding/sociedades')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        nombre: 'Asociada SL',
        nif: nif(),
        grupo: {
          grupoId: g.id,
          participacionPct: 30,
          metodo: 'puesta_equivalencia',
          fechaAlta: '2026-01-01',
        },
      });
    expect(sinCoste.status).toBe(422);
    expect(sinCoste.body.errorCode).toBe('CONSOLIDATION_INVESTMENT_REQUIRED');

    // Auditoría: alta en la cadena de A y génesis en la de la filial, íntegras.
    const audit = await A().get('/audit?entityType=company').expect(200);
    expect((audit.body.items ?? audit.body).length).toBeGreaterThanOrEqual(2);
    for (const c of [A(), filial]) {
      const integ = await c.get('/audit/verify-integrity').expect(200);
      expect(integ.body.integra).toBe(true);
    }
  });

  it('eliminación inversión–PN: fondo de comercio, socios externos y puesta en equivalencia', async () => {
    const g = await nuevoGrupo();
    const filial = await altaSociedad({
      grupo: {
        grupoId: g.id,
        participacionPct: 80,
        fechaAlta: '2026-01-01',
        costeInversion: 900,
      },
    });
    const asociada = await altaSociedad({
      grupo: {
        grupoId: g.id,
        participacionPct: 30,
        metodo: 'puesta_equivalencia',
        fechaAlta: '2026-01-01',
        costeInversion: 400,
        cuentaInversion: '2404',
      },
    });
    // Matriz: capital 1.400 invertido en la filial (900) y la asociada (400).
    await asiento(A(), '2026-01-01', [
      { cuenta: '2403', debe: 900 },
      { cuenta: '2404', debe: 400 },
      { cuenta: '5720', debe: 100 },
      { cuenta: '1000', haber: 1400 },
    ]);
    // Filial: PN de 1.000 a la toma de control y 300 de beneficio en 2026.
    await asiento(filial.as(), '2026-01-01', [
      { cuenta: '2130', debe: 1000 },
      { cuenta: '1000', haber: 1000 },
    ]);
    await asiento(filial.as(), '2026-06-30', [
      { cuenta: '5720', debe: 300 },
      { cuenta: '7050', haber: 300 },
    ]);
    // Asociada: PN de 1.000 y 200 de beneficio.
    await asiento(asociada.as(), '2026-01-01', [
      { cuenta: '2130', debe: 1000 },
      { cuenta: '1000', haber: 1000 },
    ]);
    await asiento(asociada.as(), '2026-05-01', [
      { cuenta: '5720', debe: 200 },
      { cuenta: '7050', haber: 200 },
    ]);

    const r = await A()
      .get(`/holding/grupos/${g.id}/estados?desde=2026-01-01&hasta=2026-12-31`)
      .expect(200);
    const inv = new Map(
      r.body.inversionPatrimonio.map((i: { companyId: string }) => [
        i.companyId,
        i,
      ]),
    );
    expect(inv.get(filial.id)).toMatchObject({
      metodo: 'global',
      patrimonioAdquisicion: 1000,
      patrimonioDelMayor: true,
      participacionAdquirida: 800,
      fondoComercio: 100,
      sociosExternosAdquisicion: 200,
      sociosExternosPosteriores: 0,
    });
    expect(inv.get(asociada.id)).toMatchObject({
      metodo: 'puesta_equivalencia',
      cuentaInversion: '2404',
      participacionAdquirida: 300,
      fondoComercio: 100,
      valorPuestaEquivalencia: 460,
      resultadoPuestaEquivalencia: 60,
    });
    // La asociada no integra sus saldos línea a línea.
    expect(fila(r.body, 'activo').porSociedad).not.toHaveProperty(asociada.id);
    expect(r.body.totales).toMatchObject({
      activo: 1960,
      patrimonio: 1600,
      resultado: 360,
      descuadreBalance: 0,
    });
    expect(r.body.sociosExternos).toMatchObject({
      patrimonio: 200,
      resultado: 60,
    });
    expect(r.body.resultadoAtribuidoDominante).toBe(300);
    expect(r.body.fondoComercio).toBe(200);
    // Cada ajuste automático de inversión cuadra al céntimo.
    for (const i of r.body.inversionPatrimonio as {
      ajustes: { lineas: { debe: number; haber: number }[] }[];
    }[]) {
      for (const a of i.ajustes) {
        const cents = a.lineas.reduce(
          (s, l) => s + Math.round(l.debe * 100) - Math.round(l.haber * 100),
          0,
        );
        expect(cents).toBe(0);
      }
    }

    // Ejercicio siguiente: el beneficio de 2026 pasa a reservas y los socios
    // externos reciben su 20 % de la variación posterior (60).
    const r27 = await A()
      .get(`/holding/grupos/${g.id}/estados?desde=2027-01-01&hasta=2027-12-31`)
      .expect(200);
    const f27 = r27.body.inversionPatrimonio.find(
      (i: { companyId: string }) => i.companyId === filial.id,
    );
    expect(f27).toMatchObject({
      sociosExternosAdquisicion: 200,
      sociosExternosPosteriores: 60,
      diferenciaNegativa: 0,
    });
    expect(r27.body.sociosExternos.patrimonio).toBe(260);
    expect(r27.body.totales.descuadreBalance).toBe(0);

    // Editar los parámetros de inversión exige If-Match y queda auditado.
    const grupo = await A().get(`/holding/grupos/${g.id}`).expect(200);
    const m = grupo.body.miembros.find(
      (x: { companyId: string }) => x.companyId === filial.id,
    );
    await A()
      .patch(`/holding/grupos/${g.id}/miembros/${m.id}`)
      .set('If-Match', `"${m.version}"`)
      .send({ costeInversion: 700 })
      .expect(200);
    const tras = await A()
      .get(`/holding/grupos/${g.id}/estados?desde=2026-01-01&hasta=2026-12-31`)
      .expect(200);
    const fTras = tras.body.inversionPatrimonio.find(
      (i: { companyId: string }) => i.companyId === filial.id,
    );
    // Coste 700 < parte adquirida 800: diferencia negativa a resultados.
    expect(fTras).toMatchObject({ fondoComercio: 0, diferenciaNegativa: 100 });
    expect(tras.body.totales).toMatchObject({
      resultado: 460,
      descuadreBalance: 0,
    });
    const audit = await A()
      .get('/audit?entityType=corporate_group_member')
      .expect(200);
    const cambios = (audit.body.items ?? audit.body) as {
      action: string;
    }[];
    expect(cambios.some((e) => e.action === 'update')).toBe(true);
  });

  it('moneda extranjera: tipos de cambio, CTA exacta, tesorería y periodo cerrado', async () => {
    const g = await nuevoGrupo();
    const usa = await altaSociedad({
      nombre: 'Dintel USA Inc',
      nif: `US${u().slice(-7)}`,
      monedaFuncional: 'USD',
      grupo: {
        grupoId: g.id,
        participacionPct: 100,
        fechaAlta: '2026-01-01',
        costeInversion: 800,
      },
    });
    await asiento(A(), '2026-01-01', [
      { cuenta: '2403', debe: 800 },
      { cuenta: '1000', haber: 800 },
    ]);
    // Filial en USD: capital 1.000, ventas 500 y compras 400.
    await asiento(usa.as(), '2026-01-01', [
      { cuenta: '2130', debe: 1000 },
      { cuenta: '1000', haber: 1000 },
    ]);
    await asiento(usa.as(), '2026-06-30', [
      { cuenta: '5720', debe: 500 },
      { cuenta: '7050', haber: 500 },
    ]);
    await asiento(usa.as(), '2026-07-15', [
      { cuenta: '6000', debe: 400 },
      { cuenta: '5720', haber: 400 },
    ]);
    const PERIODO = 'desde=2026-01-01&hasta=2026-12-31';

    // Sin tipos: 422 con la lista completa de lo que falta.
    const falta = await A().get(`/holding/grupos/${g.id}/estados?${PERIODO}`);
    expect(falta.status).toBe(422);
    expect(falta.body.errorCode).toBe('FX_RATE_MISSING');
    expect(
      falta.body.faltan.map((f: { tipo: string }) => f.tipo).sort(),
    ).toEqual(['cierre', 'historico', 'medio']);

    const tipo = (body: Record<string, unknown>) =>
      A()
        .post(`/holding/grupos/${g.id}/tipos-cambio`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send(body);
    const cierre = await tipo({
      moneda: 'USD',
      tipo: 'cierre',
      desde: '2026-12-31',
      tasa: 0.9,
    }).expect(201);
    await tipo({
      moneda: 'USD',
      tipo: 'medio',
      desde: '2026-01-01',
      hasta: '2026-12-31',
      tasa: 0.95,
    }).expect(201);
    await tipo({
      moneda: 'USD',
      tipo: 'historico',
      desde: '2026-01-01',
      tasa: 0.8,
    }).expect(201);
    const dup = await tipo({
      moneda: 'USD',
      tipo: 'cierre',
      desde: '2026-12-31',
      tasa: 0.91,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('FX_RATE_DUPLICATE');
    const eur = await tipo({
      moneda: 'EUR',
      tipo: 'cierre',
      desde: '2026-12-31',
      tasa: 1,
    });
    expect(eur.body.errorCode).toBe('FX_SAME_CURRENCY');

    const r = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    // 2130 900 + 5720 90 − capital 800 − ventas 475 + compras 380 = 95 de CTA.
    expect(r.body.monedaPresentacion).toBe('EUR');
    expect(r.body.conversion).toEqual([
      expect.objectContaining({
        companyId: usa.id,
        monedaFuncional: 'USD',
        tasas: { cierre: 0.9, medio: 0.95, historico: 0.8 },
        diferenciaConversion: 95,
      }),
    ]);
    expect(r.body.diferenciaConversion).toBe(95);
    expect(fila(r.body, 'activo').porSociedad[usa.id]).toBe(990);
    expect(r.body.totales).toMatchObject({
      activo: 990,
      patrimonio: 895,
      resultado: 95,
      descuadreBalance: 0,
    });
    // PN a la toma de control: 1.000 USD × 0,80 histórico = 800 = coste.
    expect(r.body.inversionPatrimonio[0]).toMatchObject({
      patrimonioAdquisicion: 800,
      fondoComercio: 0,
      diferenciaNegativa: 0,
    });

    // Cambio de tipo con concurrencia optimista; recalcula la CTA.
    await A()
      .patch(`/holding/grupos/${g.id}/tipos-cambio/${cierre.body.id}`)
      .send({ tasa: 0.92 })
      .expect(428);
    const ed = await A()
      .patch(`/holding/grupos/${g.id}/tipos-cambio/${cierre.body.id}`)
      .set('If-Match', `"${cierre.body.version}"`)
      .send({ tasa: 0.92 })
      .expect(200);
    expect(ed.body).toMatchObject({ tasa: 0.92, version: 2 });
    const r2 = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    expect(r2.body.diferenciaConversion).toBe(117);
    expect(r2.body.totales.descuadreBalance).toBe(0);
    // Tesorería: 100 USD al cierre de 0,92.
    const t = await A()
      .get(`/holding/grupos/${g.id}/tesoreria?hasta=2026-12-31`)
      .expect(200);
    expect(t.body.liquidez).toBe(92);

    // Moneda funcional bloqueada con asientos.
    const bloq = await A()
      .patch(`/holding/sociedades/${usa.id}`)
      .set('If-Match', '"1"')
      .send({ monedaFuncional: 'GBP' });
    expect(bloq.status).toBe(422);
    expect(bloq.body.errorCode).toBe('GROUP_COMPANY_CURRENCY_LOCKED');

    // Lector: lee los tipos pero no los cambia.
    const lector = await createUserWithRole(app, tokenA, 'lector');
    const L = authed(app, lector.accessToken);
    expect(
      (await L.get(`/holding/grupos/${g.id}/tipos-cambio`).expect(200)).body,
    ).toHaveLength(3);
    expect(
      (
        await L.post(`/holding/grupos/${g.id}/tipos-cambio`).send({
          moneda: 'GBP',
          tipo: 'cierre',
          desde: '2026-12-31',
          tasa: 1.1,
        })
      ).status,
    ).toBe(403);

    // Cierre: el snapshot conserva la CTA y el tipo ya no se toca.
    await A()
      .post(`/holding/grupos/${g.id}/cierres`)
      .send({ desde: '2026-01-01', hasta: '2026-12-31' })
      .expect(201);
    const cerrado = await A()
      .get(`/holding/grupos/${g.id}/estados?${PERIODO}`)
      .expect(200);
    expect(cerrado.body).toMatchObject({
      cerrado: true,
      diferenciaConversion: 117,
    });
    const tarde = await A()
      .patch(`/holding/grupos/${g.id}/tipos-cambio/${cierre.body.id}`)
      .set('If-Match', '"2"')
      .send({ tasa: 0.5 });
    expect(tarde.status).toBe(409);
    expect(tarde.body.errorCode).toBe('CONSOLIDATION_PERIOD_CLOSED');

    const audit = await A()
      .get('/audit?entityType=consolidation_fx_rate')
      .expect(200);
    expect((audit.body.items ?? audit.body).length).toBe(4);
    for (const c of [A(), usa.as()]) {
      const integ = await c.get('/audit/verify-integrity').expect(200);
      expect(integ.body.integra).toBe(true);
    }
  });
});
