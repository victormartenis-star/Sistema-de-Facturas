import { INestApplication } from '@nestjs/common';
import {
  authed,
  createObraUser,
  createPhase,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Control analítico (Fase 9): centros de coste con cuentas asignadas y
 * apuntes explícitos, ciclos de distribución e imputación (porcentaje,
 * producción y horas) con simulación, ejecución idempotente, cuadre al
 * céntimo y reversión en orden inverso; periodo cerrado, acceso por obra,
 * rolling forecast por escenario con línea base y cadena de auditoría.
 */
describe('Control analítico: centros de coste, repartos y rolling forecast (integración)', () => {
  let app: INestApplication;
  let token: string;
  let p1: string;
  let p2: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    token = (
      await registerUser(app, { email: `ca-${Date.now()}@test.dintel.es` })
    ).accessToken;
    await A().post('/contabilidad/cuentas/inicializar').expect(200);
    p1 = (
      await createProject(app, token, {
        code: 'OB-1',
        contractAmount: 100_000,
        expectedEnd: '2026-12-31',
      })
    ).id;
    p2 = (
      await createProject(app, token, { code: 'OB-2', contractAmount: 50_000 })
    ).id;
  });

  const A = () => authed(app, token);
  const clave = () => crypto.randomUUID();
  const ANIO = { desde: '2026-01-01', hasta: '2026-12-31' };
  const cents = (vs: number[]) =>
    vs.reduce((s, v) => s + Math.round(v * 100), 0);

  async function centro(body: Record<string, unknown>) {
    const r = await A()
      .post('/control-analitico/centros')
      .set('Idempotency-Key', clave())
      .send(body)
      .expect(201);
    return r.body as { id: string; version: number };
  }

  async function gasto(
    fecha: string,
    cuenta: string,
    importe: number,
    extra: Record<string, unknown> = {},
  ) {
    await A()
      .post('/contabilidad/asientos')
      .send({
        fecha,
        concepto: `Gasto ${cuenta}`,
        lineas: [
          { cuenta, debe: importe, ...extra },
          { cuenta: '5720', haber: importe },
        ],
      })
      .expect(201);
  }

  async function ciclo(body: Record<string, unknown>) {
    const r = await A()
      .post('/control-analitico/ciclos')
      .set('Idempotency-Key', clave())
      .send(body)
      .expect(201);
    return r.body as { id: string; version: number };
  }

  const saldo = async (id: string, p = ANIO) => {
    const r = await A()
      .get(
        `/control-analitico/centros/saldos?desde=${p.desde}&hasta=${p.hasta}`,
      )
      .expect(200);
    return r.body.find((s: { centroId: string }) => s.centroId === id) as {
      primario: number;
      recibido: number;
      repartido: number;
      saldo: number;
    };
  };

  it('centros, distribución por porcentaje e imputación por producción con reversión en orden inverso', async () => {
    const adm = await centro({
      codigo: 'adm',
      nombre: 'Administración central',
      tipo: 'estructura',
      cuentas: ['62'],
    });
    const dup = await A()
      .post('/control-analitico/centros')
      .send({ codigo: 'ADM', nombre: 'Otra' });
    expect(dup.status).toBe(409);
    expect(dup.headers['content-type']).toContain('application/problem+json');
    expect(dup.body.errorCode).toBe('COST_CENTER_CODE_DUPLICATE');
    const tomada = await A()
      .post('/control-analitico/centros')
      .send({ codigo: 'PARQUE', nombre: 'Parque', cuentas: ['62'] });
    expect(tomada.body.errorCode).toBe('COST_CENTER_ACCOUNT_TAKEN');
    const parque = await centro({
      codigo: 'PARQUE',
      nombre: 'Parque de maquinaria',
      tipo: 'apoyo',
      padreId: adm.id,
      cuentas: ['621'],
    });
    // Jerarquía sin ciclos y concurrencia optimista.
    const ciclico = await A()
      .patch(`/control-analitico/centros/${adm.id}`)
      .set('If-Match', `"${adm.version}"`)
      .send({ padreId: parque.id });
    expect(ciclico.body.errorCode).toBe('COST_CENTER_HIERARCHY_CYCLE');
    await A()
      .patch(`/control-analitico/centros/${adm.id}`)
      .send({ nombre: 'Sin cabecera' })
      .expect(428);

    // Coste primario: 6220 → ADM (prefijo 62), 6210 → PARQUE (621, más
    // largo) y 6400 al centro explícito; obra y centro a la vez, rechazado.
    await gasto('2026-03-10', '6220', 1000);
    await gasto('2026-03-12', '6210', 300);
    await gasto('2026-03-15', '6400', 200, { costCenterId: adm.id });
    const ambos = await A()
      .post('/contabilidad/asientos')
      .send({
        fecha: '2026-03-15',
        concepto: 'Ambos',
        lineas: [
          { cuenta: '6400', debe: 1, costCenterId: adm.id, projectId: p1 },
          { cuenta: '5720', haber: 1 },
        ],
      });
    expect(ambos.status).toBe(400);
    expect(await saldo(adm.id)).toMatchObject({ primario: 1200, saldo: 1200 });
    expect(await saldo(parque.id)).toMatchObject({ primario: 300 });

    const c1 = await ciclo({
      codigo: 'DIST-ADM',
      nombre: 'Distribución de administración',
      tipo: 'distribucion',
      criterio: 'porcentaje',
      emisores: [adm.id],
      receptores: [
        { projectId: p1, pesoPct: 33.3333 },
        { projectId: p2, pesoPct: 33.3333 },
        { costCenterId: parque.id, pesoPct: 33.3334 },
      ],
    });
    const sim = await A()
      .post(`/control-analitico/ciclos/${c1.id}/simular`)
      .send(ANIO)
      .expect(200);
    expect(sim.body.totalRepartido).toBe(1200);
    expect(
      cents(sim.body.lineas.map((l: { importe: number }) => l.importe)),
    ).toBe(120000);
    const recibe = (clave: string) =>
      sim.body.porReceptor.find((x: { clave: string }) => x.clave === clave)
        .importe;
    expect(recibe(`obra:${p1}`)).toBe(400);
    expect(recibe(`obra:${p2}`)).toBe(399.99);
    expect(recibe(`centro:${parque.id}`)).toBe(400.01);
    // La simulación no escribe.
    expect((await saldo(adm.id)).saldo).toBe(1200);

    const k1 = clave();
    const run1 = await A()
      .post(`/control-analitico/ciclos/${c1.id}/ejecutar`)
      .set('Idempotency-Key', k1)
      .send(ANIO)
      .expect(201);
    const replay = await A()
      .post(`/control-analitico/ciclos/${c1.id}/ejecutar`)
      .set('Idempotency-Key', k1)
      .send(ANIO)
      .expect(201);
    expect(replay.body.id).toBe(run1.body.id);
    const otra = await A()
      .post(`/control-analitico/ciclos/${c1.id}/ejecutar`)
      .set('Idempotency-Key', clave())
      .send(ANIO);
    expect(otra.status).toBe(409);
    expect(otra.body.errorCode).toBe('ALLOCATION_ALREADY_POSTED');
    expect(await saldo(adm.id)).toMatchObject({ repartido: 1200, saldo: 0 });
    expect(await saldo(parque.id)).toMatchObject({
      recibido: 400.01,
      saldo: 700.01,
    });

    // Imputación del parque por producción certificada (30.000 : 5.000).
    await A()
      .post('/certifications')
      .send({ projectId: p1, certDate: '2026-06-30', cumulativePct: 30 })
      .expect(201);
    await A()
      .post('/certifications')
      .send({ projectId: p2, certDate: '2026-06-30', cumulativePct: 10 })
      .expect(201);
    const c2 = await ciclo({
      codigo: 'IMP-PARQUE',
      nombre: 'Imputación del parque',
      tipo: 'imputacion',
      criterio: 'produccion',
      cuentaImputacion: '6290',
      emisores: [parque.id],
      receptores: [{ projectId: p1 }, { projectId: p2 }],
    });
    const run2 = await A()
      .post(`/control-analitico/ciclos/${c2.id}/ejecutar`)
      .set('Idempotency-Key', clave())
      .send(ANIO)
      .expect(201);
    expect(run2.body.total).toBe(700.01);
    const porObra = (id: string) =>
      run2.body.lineas.find((l: { receptorId: string }) => l.receptorId === id);
    // 700,01 × 6/7 = 600,0086 → 600,01 con el céntimo de resto.
    expect(porObra(p1)).toMatchObject({
      cuenta: '6290',
      importe: 600.01,
      residuo: 1,
    });
    expect(porObra(p2)).toMatchObject({ importe: 100, residuo: 0 });
    expect((await saldo(parque.id)).saldo).toBe(0);

    const coste = await A()
      .get('/control-analitico/coste-obras?hasta=2026-12-31')
      .expect(200);
    const de = (id: string) =>
      coste.body.find((c: { projectId: string }) => c.projectId === id);
    expect(de(p1)).toMatchObject({ indirectos: 1000.01 });
    expect(de(p2)).toMatchObject({ indirectos: 499.99 });

    // Reversión: solo la última vigente, con If-Match.
    const noUltima = await A()
      .post(`/control-analitico/ejecuciones/${run1.body.id}/revertir`)
      .set('If-Match', `"${run1.body.version}"`)
      .send({ motivo: 'Pesos mal' });
    expect(noUltima.status).toBe(409);
    expect(noUltima.body.errorCode).toBe('ALLOCATION_NOT_LATEST');
    await A()
      .post(`/control-analitico/ejecuciones/${run2.body.id}/revertir`)
      .send({ motivo: 'Sin cabecera' })
      .expect(428);
    const rev2 = await A()
      .post(`/control-analitico/ejecuciones/${run2.body.id}/revertir`)
      .set('If-Match', `"${run2.body.version}"`)
      .send({ motivo: 'Producción provisional' })
      .expect(200);
    expect(rev2.body).toMatchObject({ estado: 'revertido', version: 2 });
    const otraVez = await A()
      .post(`/control-analitico/ejecuciones/${run2.body.id}/revertir`)
      .set('If-Match', '"2"')
      .send({ motivo: 'Otra' });
    expect(otraVez.body.errorCode).toBe('ALLOCATION_RUN_REVERSED');
    await A()
      .post(`/control-analitico/ejecuciones/${run1.body.id}/revertir`)
      .set('If-Match', `"${run1.body.version}"`)
      .send({ motivo: 'Rehacer' })
      .expect(200);
    expect(await saldo(adm.id)).toMatchObject({ repartido: 0, saldo: 1200 });
    const lista = await A().get('/control-analitico/ejecuciones').expect(200);
    expect(lista.body.map((e: { estado: string }) => e.estado)).toEqual([
      'revertido',
      'revertido',
    ]);

    const audit = await A().get('/audit?entityType=allocation_run').expect(200);
    expect((audit.body.items ?? audit.body).length).toBe(4);
    const integ = await A().get('/audit/verify-integrity').expect(200);
    expect(integ.body.integra).toBe(true);
  });

  it('periodo cerrado, criterio por horas y acceso por obra', async () => {
    const adm = await centro({
      codigo: 'ADM',
      nombre: 'Administración',
      cuentas: ['62'],
    });
    await gasto('2026-03-10', '6220', 900);
    const fase = await createPhase(app, token, p2);
    await A()
      .post('/partes-diarios/personal')
      .send({
        projectId: p2,
        phaseId: fase.id,
        workerName: 'Operario',
        workDate: '2026-03-11',
        ordinaryHours: 8,
        overtimeHours: 0,
        ordinaryRate: 20,
        overtimeRate: 0,
      })
      .expect(201);
    const horas = await ciclo({
      codigo: 'HORAS',
      nombre: 'Por horas',
      tipo: 'distribucion',
      criterio: 'horas',
      emisores: [adm.id],
      receptores: [{ projectId: p1 }, { projectId: p2 }],
    });
    const MARZO = { desde: '2026-03-01', hasta: '2026-03-31' };
    const sim = await A()
      .post(`/control-analitico/ciclos/${horas.id}/simular`)
      .send(MARZO)
      .expect(200);
    // Solo la obra 2 tiene horas: recibe todo.
    expect(sim.body.porReceptor).toEqual([
      { clave: `obra:${p1}`, importe: 0 },
      { clave: `obra:${p2}`, importe: 900 },
    ]);
    const sinBase = await A()
      .post(`/control-analitico/ciclos/${horas.id}/simular`)
      .send({ desde: '2026-05-01', hasta: '2026-05-31' });
    expect(sinBase.status).toBe(422);
    expect(sinBase.body.errorCode).toBe('ALLOCATION_NO_BASE');

    await A().post('/contabilidad/periodos/2026/3/cerrar').expect(200);
    const cerrado = await A()
      .post(`/control-analitico/ciclos/${horas.id}/ejecutar`)
      .set('Idempotency-Key', clave())
      .send(MARZO);
    expect(cerrado.status).toBe(409);
    expect(cerrado.body.errorCode).toBe('ALLOCATION_PERIOD_CLOSED');

    // Receptor inexistente.
    const fantasma = await A()
      .post('/control-analitico/ciclos')
      .send({
        codigo: 'X',
        nombre: 'X',
        tipo: 'distribucion',
        criterio: 'porcentaje',
        emisores: [adm.id],
        receptores: [
          { projectId: '99999999-9999-4999-8999-999999999999', pesoPct: 100 },
        ],
      });
    expect(fantasma.status).toBe(404);

    // Rol obra: ve solo sus obras y no gestiona.
    const { tokens } = await createObraUser(app, token, [p1]);
    const O = authed(app, tokens.accessToken);
    const coste = await O.get(
      '/control-analitico/coste-obras?hasta=2026-12-31',
    ).expect(200);
    expect(coste.body.map((c: { projectId: string }) => c.projectId)).toEqual([
      p1,
    ]);
    await O.post('/control-analitico/escenarios/predeterminados').expect(403);
    await O.get('/control-analitico/centros').expect(403);
    await A().post('/control-analitico/escenarios/predeterminados').expect(200);
    const esc = await O.get('/control-analitico/escenarios').expect(200);
    const fc = await O.get(
      `/control-analitico/forecast?escenarioId=${esc.body[0].id}&fecha=2026-06-30`,
    ).expect(200);
    expect(
      fc.body.obras.map((o: { projectId: string }) => o.projectId),
    ).toEqual([p1]);
  });

  it('rolling forecast por escenario, foto como línea base y varianza', async () => {
    const adm = await centro({ codigo: 'ADM', nombre: 'Administración' });
    await gasto('2026-03-10', '6400', 1000, { costCenterId: adm.id });
    const c = await ciclo({
      codigo: 'ADM-OB1',
      nombre: 'Estructura a la obra 1',
      tipo: 'distribucion',
      criterio: 'porcentaje',
      emisores: [adm.id],
      receptores: [{ projectId: p1, pesoPct: 100 }],
    });
    await A()
      .post(`/control-analitico/ciclos/${c.id}/ejecutar`)
      .set('Idempotency-Key', clave())
      .send({ desde: '2026-03-01', hasta: '2026-03-31' })
      .expect(201);
    await A()
      .post(`/projects/${p1}/estimacion-cierre`)
      .send({
        costeEstimado: 80_000,
        motivo: 'Estudio inicial',
        fecha: '2026-03-01',
      })
      .expect(200);
    await A()
      .post('/certifications')
      .send({ projectId: p1, certDate: '2026-06-15', cumulativePct: 30 })
      .expect(201);

    const pre = await A()
      .post('/control-analitico/escenarios/predeterminados')
      .expect(200);
    expect(pre.body).toHaveLength(3);
    expect(
      (
        await A()
          .post('/control-analitico/escenarios/predeterminados')
          .expect(200)
      ).body,
    ).toHaveLength(3);
    const id = (codigo: string) =>
      pre.body.find((e: { codigo: string }) => e.codigo === codigo)
        .id as string;
    const fc = async (codigo: string) =>
      (
        await A()
          .get(
            `/control-analitico/forecast?escenarioId=${id(codigo)}&fecha=2026-06-30`,
          )
          .expect(200)
      ).body;
    const obra1 = (b: { obras: { projectId: string }[] }) =>
      b.obras.find((o) => o.projectId === p1);

    const base = await fc('BASE');
    expect(obra1(base)).toMatchObject({
      costeReal: 0,
      indirectos: 1000,
      costePendiente: 80000,
      eac: 81000,
      certificado: 30000,
      ingresosPendientes: 70000,
      ingresosPrevistos: 100000,
      margen: 19000,
      margenPct: 19,
      mesesRestantes: 6,
      varianza: null,
    });
    expect(obra1(base)!).toHaveProperty('alertas', ['sin_presupuesto']);
    expect(cents(base.serie.map((s: { coste: number }) => s.coste))).toBe(
      8_000_000,
    );
    expect(base.baseline).toBeNull();

    const tension = await fc('TENSIONADO');
    expect(obra1(tension)).toMatchObject({
      costePendiente: 88000,
      eac: 89000,
      ingresosPrevistos: 96500,
      margen: 7500,
      mesesRestantes: 8,
    });

    const foto = await A()
      .post('/control-analitico/fotos')
      .set('Idempotency-Key', clave())
      .send({ escenarioId: id('BASE'), fecha: '2026-06-30', etiqueta: 'Junio' })
      .expect(201);
    expect(foto.body.totales.eac).toBe(base.totales.eac);

    // La EAC sube 10.000: la varianza frente a la foto lo detecta.
    await A()
      .post(`/projects/${p1}/estimacion-cierre`)
      .send({ costeEstimado: 90_000, motivo: 'Revisión', fecha: '2026-06-01' })
      .expect(200);
    const despues = await fc('BASE');
    expect(despues.baseline).toMatchObject({
      id: foto.body.id,
      etiqueta: 'Junio',
    });
    expect(obra1(despues)!).toMatchObject({
      eac: 91000,
      varianza: { eac: 10000, ingresosPrevistos: 0, margen: -10000 },
    });
    expect(despues.varianza).toEqual({
      eac: 10000,
      ingresosPrevistos: 0,
      margen: -10000,
    });

    // Escenario con If-Match y código duplicado.
    const tens = pre.body.find(
      (e: { codigo: string }) => e.codigo === 'TENSIONADO',
    );
    await A()
      .patch(`/control-analitico/escenarios/${tens.id}`)
      .set('If-Match', `"${tens.version}"`)
      .send({ retrasoMeses: 0 })
      .expect(200);
    const stale = await A()
      .patch(`/control-analitico/escenarios/${tens.id}`)
      .set('If-Match', `"${tens.version}"`)
      .send({ retrasoMeses: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.errorCode).toBe('VERSION_CONFLICT');
    const dup = await A()
      .post('/control-analitico/escenarios')
      .send({ codigo: 'BASE', nombre: 'Otra base' });
    expect(dup.body.errorCode).toBe('FORECAST_CODE_DUPLICATE');

    const fotos = await A().get('/control-analitico/fotos').expect(200);
    expect(fotos.body).toHaveLength(1);
    const integ = await A().get('/audit/verify-integrity').expect(200);
    expect(integ.body.integra).toBe(true);
  });
});
