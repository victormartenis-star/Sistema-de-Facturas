import { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  auditLog,
  certificacionesSubcontrata,
  contratosSubcontrata,
  getDb,
} from '@erp/db';
import type {
  CertSubcontrataDto,
  ContratoSubcontrataResumenDto,
  RetencionGarantiaDto,
} from '@erp/shared';
import { crearEmpresa } from './audit-test-utils';
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
 * Certificaciones de subcontrata y retención de garantía
 * (`apps/api/src/modules/subcontratas`).
 */
describe('Subcontratas (integración) — certificaciones a origen y garantía', () => {
  let app: INestApplication;
  let companyId: string;

  beforeAll(async () => {
    app = await createTestApp();
    companyId = await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  interface Escenario {
    token: string;
    proyectoId: string;
    proveedorId: string;
    contratoId: string;
  }

  /** Admin, obra, subcontrata y contrato activo de 100.000 € al 5 %. */
  async function escenario(): Promise<Escenario> {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const token = admin.accessToken;
    const obra = await createProject(app, token);
    const proveedor = await authed(app, token)
      .post('/proveedores')
      .send({
        razonSocial: 'Estructuras del Turia SL',
        cifNif: `B${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        tipo: 'subcontrata',
      })
      .expect(201);
    const proveedorId = (proveedor.body as { id: string }).id;
    const contrato = await authed(app, token)
      .post(`/proveedores/${proveedorId}/contratos`)
      .send({
        proveedorId,
        proyectoId: obra.id,
        numeroContrato: `SUB-${Math.random().toString(36).slice(2, 8)}`,
        fechaInicio: '2026-09-01',
        fechaFinPrevista: '2027-03-31',
        importeTotal: 100_000,
        retencionGarantiaPct: 5,
      })
      .expect(201);
    const contratoId = (contrato.body as { id: string }).id;
    await activar(token, contratoId, 'activo');
    return { token, proyectoId: obra.id, proveedorId, contratoId };
  }

  async function activar(token: string, contratoId: string, status: string) {
    await authed(app, token)
      .patch(`/proveedores/contratos/${contratoId}`)
      .send({ status })
      .expect(200);
  }

  async function certificar(
    e: Escenario,
    importeOrigen: number,
    mes = '2026-10',
  ): Promise<CertSubcontrataDto> {
    const res = await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: `${mes}-28`,
        periodoDesde: `${mes}-01`,
        periodoHasta: `${mes}-28`,
        importeOrigen,
      })
      .expect(201);
    return res.body as CertSubcontrataDto;
  }

  async function aprobar(
    e: Escenario,
    cert: CertSubcontrataDto,
  ): Promise<CertSubcontrataDto> {
    const res = await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${cert.id}/aprobar`)
      .set('If-Match', `"${cert.version}"`)
      .expect(201);
    return res.body as CertSubcontrataDto;
  }

  async function contratoEnBd(contratoId: string) {
    const [c] = await getDb()
      .select()
      .from(contratosSubcontrata)
      .where(eq(contratosSubcontrata.id, contratoId));
    return c;
  }

  it('certifica a origen: periodo, retención y líquido; aprobar actualiza el ejecutado del contrato', async () => {
    const e = await escenario();

    const c1 = await certificar(e, 25_000);
    expect(c1).toMatchObject({
      numero: 1,
      status: 'borrador',
      version: 1,
      importeOrigen: 25_000,
      importeAnterior: 0,
      importePeriodo: 25_000,
      retencionPct: 5,
      retencionImporte: 1_250,
      importeLiquido: 23_750,
    });
    // El borrador no cuenta como producción.
    expect(Number((await contratoEnBd(e.contratoId)).importeEjecutado)).toBe(0);

    const aprobacion = await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${c1.id}/aprobar`)
      .set('If-Match', `"${c1.version}"`)
      .set('X-Request-Id', 'subc-aprob-0001')
      .expect(201);
    expect(aprobacion.headers['x-request-id']).toBe('subc-aprob-0001');
    const a1 = aprobacion.body as CertSubcontrataDto;
    expect(a1.status).toBe('aprobada');
    expect(a1.version).toBe(2);
    // El X-Request-Id queda como correlationId de la entrada de auditoría.
    const correlada = await authed(app, e.token)
      .get('/audit?correlationId=subc-aprob-0001')
      .expect(200);
    expect(correlada.body).toEqual([
      expect.objectContaining({
        entityType: 'cert_subcontrata',
        entityId: c1.id,
        action: 'update',
        meta: { accion: 'aprobar' },
      }),
    ]);
    expect(a1.aprobadaAt).not.toBeNull();

    const c2 = await certificar(e, 60_000, '2026-11');
    expect(c2).toMatchObject({
      numero: 2,
      importeAnterior: 25_000,
      importePeriodo: 35_000,
      retencionImporte: 1_750,
      importeLiquido: 33_250,
    });
    await aprobar(e, c2);

    const contrato = await contratoEnBd(e.contratoId);
    expect(Number(contrato.importeEjecutado)).toBe(60_000);
    expect(Number(contrato.pctEjecutado)).toBe(60);

    const lista = await authed(app, e.token)
      .get(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .expect(200);
    expect((lista.body as CertSubcontrataDto[]).map((c) => c.numero)).toEqual([
      1, 2,
    ]);

    const resumen = await authed(app, e.token)
      .get('/subcontratas/contratos')
      .expect(200);
    const fila = (resumen.body as ContratoSubcontrataResumenDto[]).find(
      (c) => c.id === e.contratoId,
    );
    expect(fila).toMatchObject({
      proveedorNombre: 'Estructuras del Turia SL',
      importeEjecutado: 60_000,
      retencionPendiente: 3_000,
      certificacionesVigentes: 2,
      hayBorrador: false,
    });
  });

  it('reglas de negocio: exceso sobre contrato y bajada a origen → 422; dos borradores o contrato no activo → 409', async () => {
    const e = await escenario();

    await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-10-28',
        periodoDesde: '2026-10-01',
        periodoHasta: '2026-10-28',
        importeOrigen: 100_000.01,
      })
      .expect(422);

    const c1 = await certificar(e, 40_000);
    await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-10-29',
        periodoDesde: '2026-10-01',
        periodoHasta: '2026-10-29',
        importeOrigen: 45_000,
      })
      .expect(409);
    await aprobar(e, c1);

    const baja = await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-11-28',
        periodoDesde: '2026-11-01',
        periodoHasta: '2026-11-28',
        importeOrigen: 30_000,
      })
      .expect(422);
    expect(JSON.stringify(baja.body)).toMatch(/anula la última/);

    // Validación Zod: campos desconocidos → 400.
    await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-11-28',
        periodoDesde: '2026-11-01',
        periodoHasta: '2026-11-28',
        importeOrigen: 50_000,
        retencionPct: 0,
      })
      .expect(400);

    await activar(e.token, e.contratoId, 'completado');
    await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-11-28',
        periodoDesde: '2026-11-01',
        periodoHasta: '2026-11-28',
        importeOrigen: 50_000,
      })
      .expect(409);
  });

  it('If-Match: PATCH y DELETE sin versión → 428; versión desfasada → 409; la correcta recalcula', async () => {
    const e = await escenario();
    const c1 = await certificar(e, 10_000);
    const url = `/subcontratas/certificaciones/${c1.id}`;

    await authed(app, e.token)
      .patch(url)
      .send({ importeOrigen: 12_000 })
      .expect(428);
    await authed(app, e.token).delete(url).expect(428);

    const editada = await authed(app, e.token)
      .patch(url)
      .set('If-Match', '"1"')
      .send({ importeOrigen: 12_000 })
      .expect(200);
    expect(editada.body).toMatchObject({
      version: 2,
      importePeriodo: 12_000,
      retencionImporte: 600,
      importeLiquido: 11_400,
    });

    await authed(app, e.token)
      .patch(url)
      .set('If-Match', '"1"')
      .send({ importeOrigen: 13_000 })
      .expect(409)
      .expect((r) =>
        expect(JSON.stringify(r.body)).toContain('VERSION_CONFLICT'),
      );

    await authed(app, e.token).delete(url).set('If-Match', '"2"').expect(204);
    await authed(app, e.token).get(url).expect(404);
    // Tras borrar el borrador se puede volver a crear el nº 1.
    expect((await certificar(e, 5_000)).numero).toBe(1);
  });

  it('PRL: con un documento bloqueante vencido no se aprueba (409) ni se paga', async () => {
    const e = await escenario();
    const c1 = await certificar(e, 20_000);
    const aprobada = await aprobar(e, c1);

    await authed(app, e.token)
      .post(`/proveedores/${e.proveedorId}/documentos-prl`)
      .send({
        docType: 'seguro_rc',
        numeroExpediente: 'RC-2025-001',
        fechaEmision: '2025-01-01',
        fechaVencimiento: '2025-12-31',
      })
      .expect(201);

    const pago = await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${aprobada.id}/pagar`)
      .send({ fechaPago: '2026-11-15' })
      .expect(409);
    expect(JSON.stringify(pago.body)).toMatch(/PRL/);

    const c2 = await certificar(e, 30_000, '2026-11');
    await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${c2.id}/aprobar`)
      .expect(409);
  });

  it('pagar y anular: estados terminales, solo se anula la última y el ejecutado vuelve atrás', async () => {
    const e = await escenario();
    const a1 = await aprobar(e, await certificar(e, 20_000));
    const a2 = await aprobar(e, await certificar(e, 50_000, '2026-11'));

    // Fecha de pago anterior a la certificación → 422.
    await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${a1.id}/pagar`)
      .send({ fechaPago: '2026-10-01' })
      .expect(422);
    const pagada = await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${a1.id}/pagar`)
      .send({ fechaPago: '2026-11-05' })
      .expect(201);
    expect(pagada.body).toMatchObject({
      status: 'pagada',
      fechaPago: '2026-11-05',
    });

    // Pagada es terminal.
    await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${a1.id}/anular`)
      .send({ motivo: 'Error de medición' })
      .expect(409);

    // La nº 1 no es la última: tampoco se podría anular aunque no estuviera pagada.
    const anulada = await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${a2.id}/anular`)
      .send({ motivo: 'Medición duplicada' })
      .expect(201);
    expect(anulada.body).toMatchObject({
      status: 'anulada',
      motivoAnulacion: 'Medición duplicada',
    });

    const contrato = await contratoEnBd(e.contratoId);
    expect(Number(contrato.importeEjecutado)).toBe(20_000);
    expect(Number(contrato.pctEjecutado)).toBe(20);

    // La siguiente certificación se calcula sobre la nº 1 y toma el nº 3.
    const c3 = await certificar(e, 45_000, '2026-12');
    expect(c3).toMatchObject({
      numero: 3,
      importeAnterior: 20_000,
      importePeriodo: 25_000,
    });
  });

  it('garantía: solo con contrato completado y hasta lo pendiente; queda auditada en la cadena', async () => {
    const e = await escenario();
    await aprobar(e, await certificar(e, 40_000));
    await aprobar(e, await certificar(e, 100_000, '2026-11'));
    // Retenido: 5 % de 100.000 = 5.000.

    const urlDev = `/subcontratas/contratos/${e.contratoId}/devoluciones-garantia`;
    const cuerpo = {
      fecha: '2027-12-01',
      importe: 3_000,
      motivo: 'Fin del plazo de garantía (parcial)',
    };
    await authed(app, e.token).post(urlDev).send(cuerpo).expect(409);

    await activar(e.token, e.contratoId, 'completado');
    await authed(app, e.token)
      .post(urlDev)
      .send({ ...cuerpo, importe: 5_000.01 })
      .expect(422);
    const tras = await authed(app, e.token)
      .post(urlDev)
      .send(cuerpo)
      .expect(201);
    expect(tras.body as RetencionGarantiaDto).toMatchObject({
      retenido: 5_000,
      devuelto: 3_000,
      pendiente: 2_000,
    });
    expect((tras.body as RetencionGarantiaDto).devoluciones).toHaveLength(1);

    const saldo = await authed(app, e.token)
      .get(`/subcontratas/contratos/${e.contratoId}/retenciones`)
      .expect(200);
    expect((saldo.body as RetencionGarantiaDto).pendiente).toBe(2_000);

    // Auditoría encadenada: altas, aprobaciones y devolución.
    const entradas = await getDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, companyId),
          eq(auditLog.entityType, 'cert_subcontrata'),
        ),
      );
    expect(entradas.length).toBe(4); // 2 altas + 2 aprobaciones
    expect(entradas.every((x) => x.entryHash !== null)).toBe(true);
    const porTipo = await authed(app, e.token)
      .get('/audit?entityType=devolucion_garantia')
      .expect(200);
    expect(porTipo.body).toHaveLength(1);

    const integridad = await authed(app, e.token)
      .get('/audit/verify-integrity')
      .expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('permisos: obra mide pero no aprueba, solo ve sus obras; el lector no escribe', async () => {
    const e = await escenario();
    const otraObra = await createProject(app, e.token);
    const obra = await createObraUser(app, e.token, [e.proyectoId]);
    const obraAjena = await createObraUser(app, e.token, [otraObra.id]);
    const lector = await createUserWithRole(app, e.token, 'lector');

    const cert = await authed(app, obra.tokens.accessToken)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-10-28',
        periodoDesde: '2026-10-01',
        periodoHasta: '2026-10-28',
        importeOrigen: 10_000,
      })
      .expect(201);
    await authed(app, obra.tokens.accessToken)
      .post(`/subcontratas/certificaciones/${cert.body.id}/aprobar`)
      .expect(403);

    await authed(app, obraAjena.tokens.accessToken)
      .get(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .expect(404);
    const listaAjena = await authed(app, obraAjena.tokens.accessToken)
      .get('/subcontratas/contratos')
      .expect(200);
    expect(listaAjena.body).toEqual([]);

    await authed(app, lector.accessToken)
      .get(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .expect(200);
    await authed(app, lector.accessToken)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-11-28',
        periodoDesde: '2026-11-01',
        periodoHasta: '2026-11-28',
        importeOrigen: 20_000,
      })
      .expect(403);
  });

  it('multiempresa: un contrato o certificación de otra empresa responde 404', async () => {
    const e = await escenario();
    const contrato = await contratoEnBd(e.contratoId);
    const otraEmpresa = await crearEmpresa('Otra Constructora SA');
    const [ajeno] = await getDb()
      .insert(contratosSubcontrata)
      .values({
        companyId: otraEmpresa,
        proveedorId: contrato.proveedorId,
        proyectoId: contrato.proyectoId,
        numeroContrato: 'AJENO-1',
        fechaInicio: '2026-01-01',
        fechaFinPrevista: '2026-12-31',
        importeTotal: '1000.00',
        status: 'activo',
      })
      .returning();
    const [certAjena] = await getDb()
      .insert(certificacionesSubcontrata)
      .values({
        companyId: otraEmpresa,
        contratoId: ajeno.id,
        numero: 1,
        fecha: '2026-02-01',
        periodoDesde: '2026-01-01',
        periodoHasta: '2026-01-31',
        importeOrigen: '100.00',
        importeAnterior: '0.00',
        importePeriodo: '100.00',
        retencionPct: '5.00',
        retencionImporte: '5.00',
        importeLiquido: '95.00',
      })
      .returning();

    await authed(app, e.token)
      .get(`/subcontratas/contratos/${ajeno.id}/certificaciones`)
      .expect(404);
    await authed(app, e.token)
      .get(`/subcontratas/certificaciones/${certAjena.id}`)
      .expect(404);
    await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${certAjena.id}/aprobar`)
      .expect(404);
    // Regresión: PATCH /proveedores/contratos/:id no filtraba por empresa.
    await authed(app, e.token)
      .patch(`/proveedores/contratos/${ajeno.id}`)
      .send({ status: 'cancelado' })
      .expect(404);
    expect((await contratoEnBd(ajeno.id)).status).toBe('activo');
    const lista = await authed(app, e.token)
      .get('/subcontratas/contratos')
      .expect(200);
    expect(
      (lista.body as ContratoSubcontrataResumenDto[]).map((c) => c.id),
    ).not.toContain(ajeno.id);
  });

  it('la base rechaza una fila descuadrada aunque se salte la API (CHECK)', async () => {
    const e = await escenario();
    await expect(
      getDb().insert(certificacionesSubcontrata).values({
        companyId,
        contratoId: e.contratoId,
        numero: 1,
        fecha: '2026-10-28',
        periodoDesde: '2026-10-01',
        periodoHasta: '2026-10-28',
        importeOrigen: '1000.00',
        importeAnterior: '0.00',
        importePeriodo: '1000.00',
        retencionPct: '5.00',
        retencionImporte: '50.00',
        importeLiquido: '1000.00', // debería ser 950
      }),
    ).rejects.toThrow();
  });
});
