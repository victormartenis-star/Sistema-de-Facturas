import { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  auditLog,
  contratosSubcontrata,
  getDb,
  invoices,
  paymentMilestones,
} from '@erp/db';
import type { CertSubcontrataDto, InvoiceDto } from '@erp/shared';
import { crearEmpresa } from './audit-test-utils';
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
 * Factura de compra generada desde una certificación de subcontrata
 * (`POST /subcontratas/certificaciones/:id/factura-compra`).
 */
describe('Subcontratas (integración) — factura de compra desde certificación', () => {
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
    contactId: string | null;
    contratoId: string;
  }

  async function escenario(
    opciones: { conContacto?: boolean; retencionPct?: number } = {},
  ): Promise<Escenario> {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const token = admin.accessToken;
    const obra = await createProject(app, token);
    const contacto =
      opciones.conContacto === false
        ? null
        : await createContact(app, token, {
            kind: 'proveedor',
            legalName: 'Estructuras del Turia SL',
            taxId: 'B46000001',
          });
    const proveedor = await authed(app, token)
      .post('/proveedores')
      .send({
        razonSocial: 'Estructuras del Turia SL',
        cifNif: 'B46000001',
        tipo: 'subcontrata',
        ...(contacto && { contactId: contacto.id }),
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
        retencionGarantiaPct: opciones.retencionPct ?? 5,
      })
      .expect(201);
    const contratoId = (contrato.body as { id: string }).id;
    await authed(app, token)
      .patch(`/proveedores/contratos/${contratoId}`)
      .send({ status: 'activo' })
      .expect(200);
    return {
      token,
      proyectoId: obra.id,
      proveedorId,
      contactId: contacto?.id ?? null,
      contratoId,
    };
  }

  async function certAprobada(
    e: Escenario,
    importeOrigen = 25_000,
  ): Promise<CertSubcontrataDto> {
    const c = await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-10-28',
        periodoDesde: '2026-10-01',
        periodoHasta: '2026-10-28',
        importeOrigen,
      })
      .expect(201);
    const a = await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${c.body.id}/aprobar`)
      .expect(201);
    return a.body as CertSubcontrataDto;
  }

  const url = (id: string) =>
    `/subcontratas/certificaciones/${id}/factura-compra`;
  const factura = {
    invoiceNumber: 'ETU-2026-0101',
    issueDate: '2026-10-31',
  };

  it('genera la factura de compra aprobada: base = periodo, misma retención, obra imputada y vencimientos de pago', async () => {
    const e = await escenario();
    const cert = await certAprobada(e);

    const res = await authed(app, e.token)
      .post(url(cert.id))
      .set('If-Match', `"${cert.version}"`)
      .set('X-Request-Id', 'fact-subc-0001')
      .send(factura)
      .expect(201);
    expect(res.headers['x-request-id']).toBe('fact-subc-0001');
    const dto = res.body as CertSubcontrataDto;
    expect(dto.version).toBe(cert.version + 1);
    expect(dto.facturaCompra).toMatchObject({
      invoiceNumber: 'ETU-2026-0101',
      status: 'aprobada',
      baseAmount: 25_000,
      retentionAmount: 1_250,
      totalAmount: 25_000, // ISP por defecto: IVA 0
    });

    const inv = await authed(app, e.token)
      .get(`/invoices/${dto.facturaCompra!.id}`)
      .expect(200);
    const invoice = inv.body as InvoiceDto;
    expect(invoice).toMatchObject({
      kind: 'compra',
      status: 'aprobada',
      contactId: e.contactId,
      isp: true,
      vatAmount: 0,
      retentionPct: 5,
      certSubcontrataId: cert.id,
    });
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]).toMatchObject({
      baseAmount: 25_000,
      projectId: e.proyectoId,
    });

    const vencimientos = await getDb()
      .select()
      .from(paymentMilestones)
      .where(eq(paymentMilestones.invoiceId, invoice.id));
    expect(
      vencimientos.map((v) => [v.direction, v.kind, Number(v.amount)]).sort(),
    ).toEqual([
      ['pago', 'ordinario', 23_750],
      ['pago', 'retencion', 1_250],
    ]);

    // El enlace se ve también desde el listado de certificaciones.
    const lista = await authed(app, e.token)
      .get(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .expect(200);
    expect((lista.body as CertSubcontrataDto[])[0].facturaCompra?.id).toBe(
      invoice.id,
    );

    // Auditoría en la cadena, correlacionada con el X-Request-Id.
    const correlada = await authed(app, e.token)
      .get('/audit?correlationId=fact-subc-0001')
      .expect(200);
    expect(
      (correlada.body as { entityType: string; action: string }[])
        .map((x) => `${x.entityType}:${x.action}`)
        .sort(),
    ).toEqual(['cert_subcontrata:update', 'invoice:create', 'invoice:update']);
    const integridad = await authed(app, e.token)
      .get('/audit/verify-integrity')
      .expect(200);
    expect(integridad.body.integra).toBe(true);
  });

  it('sin ISP aplica el tipo de IVA indicado; la retención sigue sobre la base', async () => {
    const e = await escenario();
    const cert = await certAprobada(e, 10_000);
    const res = await authed(app, e.token)
      .post(url(cert.id))
      .send({ ...factura, isp: false, vatPct: 21 })
      .expect(201);
    expect((res.body as CertSubcontrataDto).facturaCompra).toMatchObject({
      baseAmount: 10_000,
      totalAmount: 12_100,
      retentionAmount: 500,
    });
  });

  it('validaciones: borrador y duplicado → 409 RFC 7807; versión desfasada → 409; campos ajenos → 400', async () => {
    const e = await escenario();
    const borrador = await authed(app, e.token)
      .post(`/subcontratas/contratos/${e.contratoId}/certificaciones`)
      .send({
        fecha: '2026-10-28',
        periodoDesde: '2026-10-01',
        periodoHasta: '2026-10-28',
        importeOrigen: 5_000,
      })
      .expect(201);
    const noApta = await authed(app, e.token)
      .post(url(borrador.body.id))
      .send(factura)
      .expect(409);
    expect(noApta.headers['content-type']).toMatch(
      /application\/problem\+json/,
    );
    expect(JSON.stringify(noApta.body)).toMatch(/aprobada o pagada/);

    const cert = (
      await authed(app, e.token)
        .post(`/subcontratas/certificaciones/${borrador.body.id}/aprobar`)
        .expect(201)
    ).body as CertSubcontrataDto;

    await authed(app, e.token)
      .post(url(cert.id))
      .send({ ...factura, baseAmount: 1 })
      .expect(400);
    await authed(app, e.token)
      .post(url(cert.id))
      .set('If-Match', `"${cert.version - 1}"`)
      .send(factura)
      .expect(409)
      .expect((r) =>
        expect(JSON.stringify(r.body)).toContain('VERSION_CONFLICT'),
      );

    await authed(app, e.token).post(url(cert.id)).send(factura).expect(201);
    const dup = await authed(app, e.token)
      .post(url(cert.id))
      .send({ ...factura, invoiceNumber: 'ETU-2026-0102' })
      .expect(409);
    expect(JSON.stringify(dup.body)).toMatch(/ya tiene la factura de compra/);
    const filas = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.certSubcontrataId, cert.id));
    expect(filas).toHaveLength(1);
  });

  it('Idempotency-Key: el reintento devuelve la misma respuesta y no crea otra factura', async () => {
    const e = await escenario();
    const cert = await certAprobada(e);
    const r1 = await authed(app, e.token)
      .post(url(cert.id))
      .set('Idempotency-Key', 'f6a1c2d3-0000-4000-8000-000000000001')
      .send(factura)
      .expect(201);
    const r2 = await authed(app, e.token)
      .post(url(cert.id))
      .set('Idempotency-Key', 'f6a1c2d3-0000-4000-8000-000000000001')
      .send(factura)
      .expect(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.facturaCompra.id).toBe(r1.body.facturaCompra.id);
    const filas = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.certSubcontrataId, cert.id));
    expect(filas).toHaveLength(1);
  });

  it('subcontrata sin contacto o con PRL vencido → 409; retención por encima del 20 % → 422', async () => {
    const sinContacto = await escenario({ conContacto: false });
    const c1 = await certAprobada(sinContacto);
    const r1 = await authed(app, sinContacto.token)
      .post(url(c1.id))
      .send(factura)
      .expect(409);
    expect(JSON.stringify(r1.body)).toMatch(/no tiene contacto vinculado/);

    await resetTestDb();
    const alta = await escenario({ retencionPct: 30 });
    const c2 = await certAprobada(alta);
    const r2 = await authed(app, alta.token)
      .post(url(c2.id))
      .send(factura)
      .expect(422);
    expect(JSON.stringify(r2.body)).toMatch(/supera el máximo de 20 %/);

    await resetTestDb();
    const prl = await escenario();
    const c3 = await certAprobada(prl);
    await authed(app, prl.token)
      .post(`/proveedores/${prl.proveedorId}/documentos-prl`)
      .send({
        docType: 'certificado_ss',
        numeroExpediente: 'SS-2025-9',
        fechaEmision: '2025-01-01',
        fechaVencimiento: '2025-06-30',
      })
      .expect(201);
    const r3 = await authed(app, prl.token)
      .post(url(c3.id))
      .send(factura)
      .expect(409);
    expect(JSON.stringify(r3.body)).toMatch(/PRL/);
    const filas = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.companyId, companyId));
    expect(filas).toHaveLength(0);
  });

  it('con factura viva la certificación no se anula; anulada la factura, se puede volver a generar', async () => {
    const e = await escenario();
    const cert = await certAprobada(e);
    const generada = (
      await authed(app, e.token).post(url(cert.id)).send(factura).expect(201)
    ).body as CertSubcontrataDto;

    const bloqueo = await authed(app, e.token)
      .post(`/subcontratas/certificaciones/${cert.id}/anular`)
      .send({ motivo: 'Medición errónea' })
      .expect(409);
    expect(JSON.stringify(bloqueo.body)).toMatch(/ETU-2026-0101/);

    await authed(app, e.token)
      .post(`/invoices/${generada.facturaCompra!.id}/anular`)
      .send({ motivo: 'Factura recibida con datos erróneos' })
      .expect(201);
    const tras = await authed(app, e.token)
      .get(`/subcontratas/certificaciones/${cert.id}`)
      .expect(200);
    expect((tras.body as CertSubcontrataDto).facturaCompra).toBeNull();

    const nueva = await authed(app, e.token)
      .post(url(cert.id))
      .send({ ...factura, invoiceNumber: 'ETU-2026-0101-R' })
      .expect(201);
    expect(
      (nueva.body as CertSubcontrataDto).facturaCompra?.invoiceNumber,
    ).toBe('ETU-2026-0101-R');
  });

  it('permisos y multiempresa: obra y lector → 403; certificación de otra empresa → 404', async () => {
    const e = await escenario();
    const cert = await certAprobada(e);
    const obra = await createObraUser(app, e.token, [e.proyectoId]);
    const lector = await createUserWithRole(app, e.token, 'lector');
    await authed(app, obra.tokens.accessToken)
      .post(url(cert.id))
      .send(factura)
      .expect(403);
    await authed(app, lector.accessToken)
      .post(url(cert.id))
      .send(factura)
      .expect(403);

    const otra = await crearEmpresa('Otra Constructora SA');
    await getDb()
      .update(contratosSubcontrata)
      .set({ companyId: otra })
      .where(eq(contratosSubcontrata.id, e.contratoId));
    // La certificación sigue en nuestra empresa pero su contrato no: 404.
    await authed(app, e.token).post(url(cert.id)).send(factura).expect(404);
    const audit = await getDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, companyId),
          eq(auditLog.entityType, 'invoice'),
        ),
      );
    expect(audit).toHaveLength(0);
  });
});
