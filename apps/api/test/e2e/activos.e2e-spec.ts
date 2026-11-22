import { INestApplication } from '@nestjs/common';
import {
  authed,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Activos fijos: alta con cuadro de amortización, amortización mensual
 * idempotente contabilizada en el libro mayor (con imputación por obra),
 * respeto de períodos cerrados, baja con resultado y RBAC.
 */
describe('Activos fijos (integración)', () => {
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

  /** Grúa de 12.000 € a 12 meses desde enero de 2026: cuotas de 1.000 €. */
  async function grua(extra: Record<string, unknown> = {}) {
    const obra = await createProject(app, token);
    const equipo = await authed(app, token)
      .post('/equipos')
      .send({ nombre: 'Grúa torre' })
      .expect(201);
    const res = await authed(app, token)
      .post('/activos')
      .send({
        codigo: 'AF-001',
        nombre: 'Grúa torre',
        categoria: 'maquinaria',
        equipoId: equipo.body.id,
        projectId: obra.id,
        fechaAdquisicion: '2025-12-20',
        fechaInicio: '2026-01-01',
        coste: 12000,
        vidaUtilMeses: 12,
        ...extra,
      })
      .expect(201);
    return { activo: res.body, obraId: obra.id, equipoId: equipo.body.id };
  }

  it('alta con cuadro de amortización exacto', async () => {
    const { activo } = await grua();
    expect(activo).toMatchObject({
      codigo: 'AF-001',
      estado: 'activo',
      valorNeto: 12000,
      amortizacionAcumulada: 0,
      amortizadoHasta: null,
    });
    expect(activo.cuadro).toHaveLength(12);
    expect(activo.cuadro[0]).toMatchObject({
      ejercicio: 2026,
      mes: 1,
      importe: 1000,
      contabilizada: false,
    });
    expect(activo.cuadro.at(-1).valorNeto).toBe(0);
  });

  it('rechaza código duplicado, misma máquina dos veces y residual mayor que el coste', async () => {
    const { equipoId } = await grua();
    const dup = await authed(app, token).post('/activos').send({
      codigo: 'AF-001',
      nombre: 'Otro',
      categoria: 'utillaje',
      fechaAdquisicion: '2026-01-01',
      fechaInicio: '2026-01-01',
      coste: 100,
      vidaUtilMeses: 12,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.errorCode).toBe('ASSET_CODE_DUPLICATE');

    const mismaMaquina = await authed(app, token).post('/activos').send({
      codigo: 'AF-002',
      nombre: 'Otro',
      categoria: 'maquinaria',
      equipoId,
      fechaAdquisicion: '2026-01-01',
      fechaInicio: '2026-01-01',
      coste: 100,
      vidaUtilMeses: 12,
    });
    expect(mismaMaquina.body.errorCode).toBe('ASSET_EQUIPO_IN_USE');

    const residual = await authed(app, token).post('/activos').send({
      codigo: 'AF-003',
      nombre: 'Otro',
      categoria: 'utillaje',
      fechaAdquisicion: '2026-01-01',
      fechaInicio: '2026-01-01',
      coste: 100,
      valorResidual: 200,
      vidaUtilMeses: 12,
    });
    expect(residual.status).toBe(400);
  });

  it('amortizar contabiliza una cuota por mes, es idempotente e imputa a la obra', async () => {
    const { activo, obraId } = await grua();
    const r1 = await authed(app, token)
      .post('/activos/amortizar')
      .send({ hasta: '2026-03' })
      .expect(200);
    expect(r1.body).toMatchObject({ cuotas: 3, importe: 3000, omitidos: [] });
    const r2 = await authed(app, token)
      .post('/activos/amortizar')
      .send({ hasta: '2026-03' })
      .expect(200);
    expect(r2.body.cuotas).toBe(0);

    const d = await authed(app, token).get(`/activos/${activo.id}`).expect(200);
    expect(d.body).toMatchObject({
      amortizacionAcumulada: 3000,
      valorNeto: 9000,
      amortizadoHasta: '2026-03',
    });
    expect(d.body.cuadro[2]).toMatchObject({ contabilizada: true });
    expect(d.body.cuadro[2].asientoId).toEqual(expect.any(String));

    const gasto = await authed(app, token)
      .get('/contabilidad/mayor/6810')
      .expect(200);
    expect(gasto.body.saldoFinal).toBe(3000);
    const porObra = await authed(app, token)
      .get(`/contabilidad/sumas-saldos?projectId=${obraId}`)
      .expect(200);
    expect(porObra.body.filas).toEqual([
      expect.objectContaining({ codigo: '6810', saldoDeudor: 3000 }),
    ]);
    const diario = await authed(app, token)
      .get('/contabilidad/asientos?origen=amortizacion')
      .expect(200);
    expect(diario.body.total).toBe(3);
    expect(diario.body.items[0].fecha).toBe('2026-03-31');
  });

  it('un período cerrado se omite y se informa', async () => {
    await grua();
    await authed(app, token)
      .post('/contabilidad/periodos/2026/1/cerrar')
      .expect(200);
    const r = await authed(app, token)
      .post('/activos/amortizar')
      .send({ hasta: '2026-02' })
      .expect(200);
    expect(r.body.cuotas).toBe(0);
    expect(r.body.omitidos).toEqual([
      expect.objectContaining({
        codigo: 'AF-001',
        motivo: expect.stringMatching(/cerrado/),
      }),
    ]);
  });

  it('baja con venta: exige amortización al día, asiento con beneficio y máquina de baja', async () => {
    const { activo, equipoId } = await grua();
    const pronto = await authed(app, token)
      .post(`/activos/${activo.id}/baja`)
      .send({
        fecha: '2026-07-10',
        importeVenta: 7000,
        motivo: 'Venta a tercero',
      });
    expect(pronto.status).toBe(409);
    expect(pronto.body.errorCode).toBe('ASSET_DEPRECIATION_PENDING');

    await authed(app, token)
      .post('/activos/amortizar')
      .send({ hasta: '2026-06' })
      .expect(200);
    const baja = await authed(app, token)
      .post(`/activos/${activo.id}/baja`)
      .send({
        fecha: '2026-07-10',
        importeVenta: 7000,
        motivo: 'Venta a tercero',
      })
      .expect(200);
    expect(baja.body).toMatchObject({
      estado: 'baja',
      fechaBaja: '2026-07-10',
      importeVenta: 7000,
      valorNeto: 6000,
    });

    const asientos = await authed(app, token)
      .get('/contabilidad/asientos?origen=baja_inmovilizado')
      .expect(200);
    expect(asientos.body.items[0].lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: '2813', debe: 6000 }),
        expect.objectContaining({ cuenta: '5720', debe: 7000 }),
        expect.objectContaining({ cuenta: '2130', haber: 12000 }),
        expect.objectContaining({ cuenta: '7710', haber: 1000 }),
      ]),
    );
    const equipo = await authed(app, token)
      .get(`/equipos/${equipoId}`)
      .expect(200);
    expect(equipo.body.estado).toBe('baja');

    const otra = await authed(app, token)
      .post(`/activos/${activo.id}/baja`)
      .send({ fecha: '2026-08-01', motivo: 'Otra vez' });
    expect(otra.body.errorCode).toBe('ASSET_DISPOSED');
    // Un activo de baja ya no se amortiza.
    const r = await authed(app, token)
      .post('/activos/amortizar')
      .send({ hasta: '2026-12' })
      .expect(200);
    expect(r.body.cuotas).toBe(0);
  });

  it('PATCH exige If-Match y solo cambia datos descriptivos', async () => {
    const { activo } = await grua();
    await authed(app, token)
      .patch(`/activos/${activo.id}`)
      .send({ nombre: 'Grúa torre Liebherr' })
      .expect(428);
    const ok = await authed(app, token)
      .patch(`/activos/${activo.id}`)
      .set('If-Match', `"${activo.version}"`)
      .send({ nombre: 'Grúa torre Liebherr' })
      .expect(200);
    expect(ok.body).toMatchObject({
      nombre: 'Grúa torre Liebherr',
      coste: 12000,
    });
    const vieja = await authed(app, token)
      .patch(`/activos/${activo.id}`)
      .set('If-Match', `"${activo.version}"`)
      .send({ nombre: 'Otra' });
    expect(vieja.body.errorCode).toBe('VERSION_CONFLICT');
  });

  it('el rol obra no accede', async () => {
    const obra = await createUserWithRole(app, token, 'obra');
    await authed(app, obra.accessToken).get('/activos').expect(403);
  });
});
