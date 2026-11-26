import { INestApplication } from '@nestjs/common';
import {
  authed,
  createObraUser,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Fase 6 (Enterprise Asset Management): ficha y jerarquía de equipos,
 * contadores, asignación a obra, planes preventivos y órdenes de trabajo
 * preventivas y correctivas, disponibilidad y coste de explotación por
 * equipo y obra sin duplicar amortización ni cargos de obra; acceso por
 * obra, concurrencia, idempotencia y auditoría.
 */
describe('EAM de maquinaria (integración)', () => {
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
  const ficha = async (id: string) =>
    (await api().get(`/eam/equipos/${id}`).expect(200)).body;
  const parte = (
    projectId: string,
    equipoId: string,
    workDate: string,
    hoursUsed: number,
  ) =>
    api()
      .post('/partes-diarios/maquinaria')
      .send({
        projectId,
        machineName: 'Grúa',
        equipoId,
        workDate,
        hoursUsed,
        hourlyRate: 40,
      })
      .expect(201);

  it('ficha, jerarquía, contadores, asignación, preventivo, órdenes y explotación', async () => {
    const obra1 = await createProject(app, token);
    const obra2 = await createProject(app, token);
    const grua = (
      await api()
        .post('/equipos')
        .send({ nombre: 'Grúa torre GT-50' })
        .expect(201)
    ).body;
    const motor = (
      await api()
        .post('/equipos')
        .send({ nombre: 'Motor de elevación', tipo: 'otro' })
        .expect(201)
    ).body;

    // Ficha y jerarquía: el motor es componente de la grúa; sin ciclos ni códigos repetidos.
    const g0 = await ficha(grua.id);
    const conCodigo = (
      await api()
        .patch(`/eam/equipos/${grua.id}/ficha`)
        .set('If-Match', `"${g0.version}"`)
        .send({ codigo: 'gt-50', numeroSerie: 'SN-2231' })
        .expect(200)
    ).body;
    expect(conCodigo).toMatchObject({
      codigo: 'GT-50',
      numeroSerie: 'SN-2231',
      version: g0.version + 1,
    });
    const vieja = await api()
      .patch(`/eam/equipos/${grua.id}/ficha`)
      .set('If-Match', `"${g0.version}"`)
      .send({ numeroSerie: 'X' });
    expect(vieja.status).toBe(409);
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
    await api()
      .patch(`/eam/equipos/${motor.id}/ficha`)
      .send({ padreId: grua.id, codigo: 'GT-50-M' })
      .expect(200);
    const ciclo = await api()
      .patch(`/eam/equipos/${grua.id}/ficha`)
      .send({ padreId: motor.id });
    expect(ciclo.status).toBe(422);
    expect(ciclo.body.errorCode).toBe('EAM_HIERARCHY_CYCLE');
    expect(ciclo.headers['x-request-id']).toBeDefined();
    const dup = await api()
      .patch(`/eam/equipos/${motor.id}/ficha`)
      .send({ codigo: 'GT-50' });
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('EAM_CODE_DUPLICATE');
    expect((await ficha(grua.id)).componentes).toEqual([
      { id: motor.id, nombre: 'Motor de elevación', codigo: 'GT-50-M' },
    ]);

    // Contadores: avance, sin retroceso ni salto imposible; corrección motivada.
    const lectura = (body: Record<string, unknown>) =>
      api()
        .post(`/eam/equipos/${grua.id}/lecturas`)
        .send({ tipo: 'horas', ...body });
    await lectura({ fecha: '2026-10-01', valor: 1000 }).expect(201);
    await lectura({ fecha: '2026-10-03', valor: 1040 }).expect(201);
    expect(
      (await lectura({ fecha: '2026-10-04', valor: 900 })).body.errorCode,
    ).toBe('EAM_COUNTER_BACKWARDS');
    expect(
      (await lectura({ fecha: '2026-10-04', valor: 1200 })).body.errorCode,
    ).toBe('EAM_COUNTER_IMPLAUSIBLE');
    expect(
      (await lectura({ fecha: '2026-10-04', valor: 1030, correccion: true }))
        .body.errorCode,
    ).toBe('EAM_COUNTER_REASON_REQUIRED');
    await lectura({
      fecha: '2026-10-04',
      valor: 1035,
      correccion: true,
      motivo: 'Lectura mal anotada',
    }).expect(201);
    expect(await ficha(grua.id)).toMatchObject({
      contadorHoras: 1035,
      contadorFecha: '2026-10-04',
    });
    const historia = (
      await api().get(`/eam/equipos/${grua.id}/lecturas`).expect(200)
    ).body;
    expect(historia[0]).toMatchObject({
      valor: 1035,
      anterior: 1040,
      origen: 'correccion',
      motivo: 'Lectura mal anotada',
    });

    // Asignación a obra: una a la vez.
    const a1 = (
      await api()
        .post(`/eam/equipos/${grua.id}/asignaciones`)
        .set('Idempotency-Key', `as-${u()}`)
        .send({ projectId: obra1.id, desde: '2026-10-01', hasta: '2026-10-20' })
        .expect(201)
    ).body;
    const pisa = await api()
      .post(`/eam/equipos/${grua.id}/asignaciones`)
      .send({ projectId: obra2.id, desde: '2026-10-15' });
    expect(pisa.status).toBe(409);
    expect(pisa.body.errorCode).toBe('EAM_ASSIGNMENT_OVERLAP');
    await api()
      .post(`/eam/equipos/${grua.id}/asignaciones`)
      .send({ projectId: obra2.id, desde: '2026-10-21' })
      .expect(201);
    expect(a1.projectNombre).toBe(obra1.name);

    // Plan preventivo por horas: 800 + 250 = 1050, con 1035 está próximo.
    const plan = (
      await api()
        .post(`/eam/equipos/${grua.id}/planes`)
        .send({
          nombre: 'Engrase y revisión 250 h',
          intervaloHoras: 250,
          ultimaHoras: 800,
          ultimaFecha: '2026-06-01',
        })
        .expect(201)
    ).body;
    expect(plan).toMatchObject({
      estado: 'proximo',
      criterio: 'horas',
      horasProximas: 1050,
      horasRestantes: 15,
    });
    const sinIntervalo = await api()
      .post(`/eam/equipos/${grua.id}/planes`)
      .send({ nombre: 'Sin intervalo' });
    expect(sinIntervalo.body.errorCode).toBe('EAM_PLAN_INTERVAL_REQUIRED');
    const generadas = (
      await api()
        .post('/eam/planes/generar-ordenes')
        .send({ fecha: '2026-10-09' })
        .expect(200)
    ).body;
    expect(generadas).toHaveLength(1);
    expect(generadas[0]).toMatchObject({
      tipo: 'preventiva',
      planId: plan.id,
      estado: 'abierta',
      prioridad: 'media',
    });
    expect(
      (await api().post('/eam/planes/generar-ordenes').send({}).expect(200))
        .body,
    ).toEqual([]);
    expect((await ficha(grua.id)).preventivo).toBe('proximo');

    // Aviso de avería del jefe de obra (idempotente) y límites de su rol.
    const jefe = await createObraUser(app, token, [obra1.id]);
    const jefeApi = () => authed(app, jefe.tokens.accessToken);
    const clave = `ot-${u()}`;
    const aviso = () =>
      jefeApi()
        .post('/eam/ordenes')
        .set('Idempotency-Key', clave)
        .send({
          equipoId: grua.id,
          tipo: 'correctiva',
          prioridad: 'urgente',
          projectId: obra1.id,
          descripcion: 'Fuga hidráulica en el carro',
          fechaAviso: '2026-10-09',
        })
        .expect(201);
    const ot = (await aviso()).body;
    expect((await aviso()).body.id).toBe(ot.id);
    expect(ot).toMatchObject({
      numero: 'OT-2026-0002',
      estado: 'abierta',
      projectNombre: obra1.name,
    });
    await jefeApi()
      .post('/eam/ordenes')
      .send({
        equipoId: grua.id,
        tipo: 'preventiva',
        projectId: obra1.id,
        descripcion: 'Revisión no permitida',
        fechaAviso: '2026-10-09',
      })
      .expect(403);
    await jefeApi()
      .post(`/eam/ordenes/${ot.id}/acciones`)
      .send({ accion: 'iniciar', fecha: '2026-10-10' })
      .expect(403);
    const ajeno = await createObraUser(app, token, [obra2.id]);
    expect(
      (
        await authed(app, ajeno.tokens.accessToken)
          .get('/eam/equipos')
          .expect(200)
      ).body.map((e: { id: string }) => e.id),
    ).toEqual([grua.id]);
    const otroJefe = await createObraUser(app, token, []);
    await authed(app, otroJefe.tokens.accessToken)
      .get(`/eam/equipos/${grua.id}`)
      .expect(404);

    // Ciclo de la orden correctiva; la obra no recibe el coste (sin duplicar).
    const costeObraAntes = (
      await api().get(`/projects/${obra1.id}/margenes`).expect(200)
    ).body.obra.costeReal;
    const mal = await api()
      .post(`/eam/ordenes/${ot.id}/acciones`)
      .send({ accion: 'cerrar', fecha: '2026-10-11' });
    expect(mal.status).toBe(409);
    expect(mal.body.errorCode).toBe('EAM_WO_INVALID_TRANSITION');
    const enCurso = (
      await api()
        .post(`/eam/ordenes/${ot.id}/acciones`)
        .set('If-Match', `"${ot.version}"`)
        .send({ accion: 'iniciar', fecha: '2026-10-10' })
        .expect(200)
    ).body;
    expect((await ficha(grua.id)).estado).toBe('en_mantenimiento');
    const parada = await api()
      .post(`/eam/ordenes/${ot.id}/acciones`)
      .send({ accion: 'cerrar', fecha: '2026-10-11', horasParada: 49 });
    expect(parada.body.errorCode).toBe('EAM_WO_DOWNTIME_INVALID');
    const cerrada = (
      await api()
        .post(`/eam/ordenes/${ot.id}/acciones`)
        .set('If-Match', `"${enCurso.version}"`)
        .set('Idempotency-Key', `c-${u()}`)
        .send({
          accion: 'cerrar',
          fecha: '2026-10-11',
          horasParada: 16,
          horasManoObra: 3.5,
          tarifaManoObra: 42.15,
          costeRepuestos: 120.4,
          lecturaHoras: 1045,
          notas: 'Latiguillo sustituido',
        })
        .expect(200)
    ).body;
    expect(cerrada).toMatchObject({
      estado: 'cerrada',
      costeManoObra: 147.53,
      costeTotal: 267.93,
      horasParada: 16,
    });
    expect(await ficha(grua.id)).toMatchObject({
      estado: 'operativo',
      contadorHoras: 1045,
    });
    expect(
      (await api().get(`/projects/${obra1.id}/margenes`).expect(200)).body.obra
        .costeReal,
    ).toBe(costeObraAntes);
    const historico = (
      await api().get(`/equipos/${grua.id}/mantenimientos`).expect(200)
    ).body;
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ tipo: 'correctivo', coste: 267.93 });

    // Preventiva generada: al cerrar actualiza la última ejecución del plan.
    const prev = generadas[0];
    await api()
      .post(`/eam/ordenes/${prev.id}/acciones`)
      .send({ accion: 'iniciar', fecha: '2026-10-12' })
      .expect(200);
    const sinMotivo = await api()
      .post(`/eam/ordenes/${prev.id}/acciones`)
      .send({ accion: 'cancelar', fecha: '2026-10-12' });
    expect(sinMotivo.body.errorCode).toBe('EAM_WO_REASON_REQUIRED');
    await api()
      .post(`/eam/ordenes/${prev.id}/acciones`)
      .send({
        accion: 'cerrar',
        fecha: '2026-10-12',
        horasParada: 4,
        costeExterno: 32.07,
      })
      .expect(200);
    const planDespues = (
      await api().get(`/eam/equipos/${grua.id}/planes`).expect(200)
    ).body[0];
    expect(planDespues).toMatchObject({
      estado: 'al_dia',
      ultimaFecha: '2026-10-12',
      ultimaHoras: 1045,
      horasProximas: 1295,
      ordenAbiertaId: null,
    });

    // Mantenimiento suelto (sin orden), partes de uso y amortización contabilizada.
    await api()
      .post('/equipos/mantenimientos')
      .send({
        equipoId: grua.id,
        tipo: 'preventivo',
        fecha: '2026-10-15',
        coste: 50,
      })
      .expect(201);
    await parte(obra1.id, grua.id, '2026-10-05', 8);
    await parte(obra1.id, grua.id, '2026-10-06', 7.5);
    await parte(obra2.id, grua.id, '2026-10-22', 6);
    await api()
      .post('/activos')
      .send({
        codigo: `AF-${u()}`.slice(0, 30),
        nombre: 'Grúa torre',
        categoria: 'maquinaria',
        equipoId: grua.id,
        fechaAdquisicion: '2025-12-20',
        fechaInicio: '2026-01-01',
        coste: 12000,
        vidaUtilMeses: 12,
      })
      .expect(201);
    await api()
      .post('/activos/amortizar')
      .send({ hasta: '2026-10' })
      .expect(200);
    expect((await ficha(grua.id)).activoFijo).toMatchObject({
      estado: 'activo',
    });

    const url = '/eam/explotacion?desde=2026-10-01&hasta=2026-10-31';
    const ex = (await api().get(url).expect(200)).body;
    const fila = ex.equipos.find(
      (e: { equipoId: string }) => e.equipoId === grua.id,
    );
    expect(fila).toMatchObject({
      diasAsignados: 31,
      horasCalendario: 248,
      horasParada: 20,
      horasDisponibles: 228,
      horasTrabajadas: 21.5,
      disponibilidadPct: 91.94,
      utilizacionPct: 9.43,
      averias: 1,
      mtbfHoras: 21.5,
      mttrHoras: 16,
      ordenesCerradas: 2,
      coste: {
        amortizacion: 1000, // octubre: la ya contabilizada, no se reasienta
        mantenimiento: 350, // 267,93 + 32,07 de órdenes + 50 suelto (el de la orden no se repite)
        total: 1350,
        imputadoObras: 860,
        diferencia: -490,
        coberturaPct: 63.7,
        costeHora: 62.79,
      },
    });
    expect(ex.obras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: obra1.id,
          horasTrabajadas: 15.5,
          imputado: 620,
          mantenimientoAtribuido: 267.93,
        }),
        expect.objectContaining({
          projectId: obra2.id,
          horasTrabajadas: 6,
          imputado: 240,
          mantenimientoAtribuido: 0,
        }),
      ]),
    );

    // Por obra (jefe de obra): calendario de sus días y amortización prorrateada.
    await jefeApi().get(url).expect(403);
    const deObra = (
      await jefeApi().get(`${url}&projectId=${obra1.id}`).expect(200)
    ).body;
    expect(deObra.equipos[0]).toMatchObject({
      diasAsignados: 20,
      horasCalendario: 160,
      horasParada: 16,
      disponibilidadPct: 90,
      horasTrabajadas: 15.5,
      coste: {
        amortizacion: 645.16,
        mantenimiento: 267.93,
        imputadoObras: 620,
      },
    });
    expect(deObra.obras.map((o: { projectId: string }) => o.projectId)).toEqual(
      [obra1.id],
    );
    const rango = await api().get(
      '/eam/explotacion?desde=2026-10-31&hasta=2026-10-01',
    );
    expect(rango.body.errorCode).toBe('EAM_RANGE_INVALID');

    const lector = await createUserWithRole(app, token, 'lector');
    await authed(app, lector.accessToken).get('/eam/ordenes').expect(200);
    await authed(app, lector.accessToken)
      .post(`/eam/equipos/${grua.id}/lecturas`)
      .send({ tipo: 'km', fecha: '2026-10-05', valor: 1 })
      .expect(403);
    const integridad = await api().get('/audit/verify-integrity').expect(200);
    expect(integridad.body.integra).toBe(true);
  });
});
