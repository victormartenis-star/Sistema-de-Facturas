import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, invoices } from '@erp/db';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as xpath from 'xpath';
import {
  authed,
  createContact,
  createObraUser,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `GET /invoices/:id/facturae` y la persistencia de la huella VeriFactu
 * (Fase 11) — ver `apps/api/src/invoices/facturae.service.ts` y
 * [[Módulo Facturación]] en Obsidian para el porqué del cacheo.
 */
describe('Facturae / VeriFactu (integración) — huella persistida', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  /** Crea, y opcionalmente aprueba, una factura de venta lista para Facturae. */
  async function createVentaInvoice(
    token: string,
    contactId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId,
        invoiceNumber: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'Certificación mensual',
            baseAmount: 1000,
            vatPct: 21,
          },
        ],
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await authed(app, token).post(`/invoices/${id}/aprobar`).expect(201);
    return id;
  }

  it('genera el XML y persiste hash/previousHash/generatedAt en la factura', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B11111111',
    });
    const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);

    const res = await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}/facturae`)
      .expect(200);
    expect(res.text).toContain('<?xml');
    expect(res.headers['content-type']).toContain('xml');

    const db = getDb();
    const [row] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(row.verifactuHash).not.toBeNull();
    expect(row.verifactuHash).toHaveLength(64); // SHA-256 en hex
    expect(row.verifactuPreviousHash).toBe(''); // primera factura de la empresa: genesis
    expect(row.verifactuGeneratedAt).not.toBeNull();
  });

  it('encadena correctamente: la 2ª factura usa el hash persistido de la 1ª como previousHash', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B22222222',
    });
    const firstId = await createVentaInvoice(admin.accessToken, contact.id, {
      issueDate: '2026-09-10',
    });
    const secondId = await createVentaInvoice(admin.accessToken, contact.id, {
      issueDate: '2026-09-12',
    });

    // Generar solo la 2ª: debe recorrer la 1ª (sin huella todavía), calcularla
    // y persistirla, y encadenar la 2ª a partir de ahí.
    await authed(app, admin.accessToken)
      .get(`/invoices/${secondId}/facturae`)
      .expect(200);

    const db = getDb();
    const [first] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, firstId));
    const [second] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, secondId));

    expect(first.verifactuHash).not.toBeNull();
    expect(second.verifactuPreviousHash).toBe(first.verifactuHash);
  });

  it('reutiliza el hash ya persistido de una factura sin recalcularlo (misma huella en dos peticiones)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B33333333',
    });
    const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);

    await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}/facturae`)
      .expect(200);
    const db = getDb();
    const [afterFirst] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId));

    // Segunda petición: el hash persistido debe reutilizarse tal cual, no
    // recalcularse a partir de un `generatedAt` distinto.
    await authed(app, admin.accessToken)
      .get(`/invoices/${invoiceId}/facturae`)
      .expect(200);
    const [afterSecond] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId));

    expect(afterSecond.verifactuHash).toBe(afterFirst.verifactuHash);
    expect(afterSecond.verifactuGeneratedAt?.toISOString()).toBe(
      afterFirst.verifactuGeneratedAt?.toISOString(),
    );
  });

  it('rechaza Facturae de una factura de compra', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      taxId: 'B44444444',
    });
    const res = await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: contact.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [{ description: 'Material', baseAmount: 500, vatPct: 21 }],
      })
      .expect(201);
    await authed(app, admin.accessToken)
      .get(`/invoices/${(res.body as { id: string }).id}/facturae`)
      .expect(400);
  });

  it('rechaza Facturae de una factura en borrador (sin aprobar)', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const contact = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B55555555',
    });
    const res = await authed(app, admin.accessToken)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: contact.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [{ description: 'Certificación', baseAmount: 500, vatPct: 21 }],
      })
      .expect(201);
    await authed(app, admin.accessToken)
      .get(`/invoices/${(res.body as { id: string }).id}/facturae`)
      .expect(400);
  });

  describe('POST /invoices/:id/verifactu/enviar (Fase 14)', () => {
    it('sin AEAT_CERT_PATH configurado, genera el registro y lo deja en generado_local', async () => {
      delete process.env.AEAT_CERT_PATH;
      delete process.env.AEAT_CERT_PASSWORD;
      delete process.env.AEAT_ENDPOINT_URL;

      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const contact = await createContact(app, admin.accessToken, {
        kind: 'cliente',
        taxId: 'B66666666',
      });
      const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);

      const res = await authed(app, admin.accessToken)
        .post(`/invoices/${invoiceId}/verifactu/enviar`)
        .expect(201);
      expect(res.body.status).toBe('generado_local');
      expect(res.body.sentAt).toBeNull();
      expect(res.body.xml).toContain('<sum:RegistroAlta');
      // El emisor del registro es la propia empresa (seedCompany), no el cliente.
      expect(res.body.xml).toContain('B00000000');

      const db = getDb();
      const [row] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId));
      expect(row.verifactuStatus).toBe('generado_local');
      expect(row.verifactuSentAt).toBeNull();
    });

    it('rechaza una factura de compra o en borrador con 400', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const contact = await createContact(app, admin.accessToken, {
        kind: 'cliente',
        taxId: 'B77777777',
      });
      const draftRes = await authed(app, admin.accessToken)
        .post('/invoices')
        .send({
          kind: 'venta',
          contactId: contact.id,
          invoiceNumber: `F-${Date.now()}`,
          issueDate: '2026-09-14',
          lines: [
            { description: 'Certificación', baseAmount: 500, vatPct: 21 },
          ],
        })
        .expect(201);
      await authed(app, admin.accessToken)
        .post(
          `/invoices/${(draftRes.body as { id: string }).id}/verifactu/enviar`,
        )
        .expect(400);
    });

    it('un usuario `obra` no puede enviar VeriFactu (403)', async () => {
      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const contact = await createContact(app, admin.accessToken, {
        kind: 'cliente',
        taxId: 'B88888888',
      });
      const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);
      const { tokens: obraTokens } = await createObraUser(
        app,
        admin.accessToken,
        [],
      );
      await authed(app, obraTokens.accessToken)
        .post(`/invoices/${invoiceId}/verifactu/enviar`)
        .expect(403);
    });
  });

  describe('GET /invoices/:id/facturae con firma XAdES-BES (Fase 14)', () => {
    let certDir: string;
    let certPath: string;
    let keyPath: string;

    beforeAll(() => {
      // Certificado autofirmado de test, generado para esta pasada de tests
      // y nunca commiteado — ver `FacturaeSigningService` para por qué no es
      // (ni pretende ser) un certificado cualificado real.
      certDir = mkdtempSync(join(tmpdir(), 'facturae-xades-'));
      certPath = join(certDir, 'cert.pem');
      keyPath = join(certDir, 'key.pem');
      execFileSync('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=Test ERP Dintel/O=Empresa de Pruebas de Integracion/C=ES',
      ]);
    });

    afterAll(() => {
      rmSync(certDir, { recursive: true, force: true });
    });

    it('sin certificado configurado, el XML sigue sin firmar (X-Facturae-Signed: false)', async () => {
      delete process.env.FACTURAE_CERT_PATH;
      delete process.env.FACTURAE_KEY_PATH;

      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const contact = await createContact(app, admin.accessToken, {
        kind: 'cliente',
        taxId: 'B99999991',
      });
      const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);

      const res = await authed(app, admin.accessToken)
        .get(`/invoices/${invoiceId}/facturae`)
        .expect(200);
      expect(res.headers['x-facturae-signed']).toBe('false');
      expect(res.text).not.toContain('<ds:Signature');
    });

    it('con certificado configurado, firma con XAdES-BES y la firma valida criptográficamente', async () => {
      process.env.FACTURAE_CERT_PATH = certPath;
      process.env.FACTURAE_KEY_PATH = keyPath;

      const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
      const contact = await createContact(app, admin.accessToken, {
        kind: 'cliente',
        taxId: 'B99999992',
      });
      const invoiceId = await createVentaInvoice(admin.accessToken, contact.id);

      const res = await authed(app, admin.accessToken)
        .get(`/invoices/${invoiceId}/facturae`)
        .expect(200);
      expect(res.headers['x-facturae-signed']).toBe('true');
      const xml = res.text;
      expect(xml).toContain('<ds:Signature');
      expect(xml).toContain('<xades:QualifyingProperties');
      expect(xml).toContain('<xades:SigningTime>');
      expect(xml).toContain('<xades:SigningCertificate>');
      // `<ds:Object>` queda como hermano de `<ds:Signature>`, no anidado
      // dentro — desviación estructural deliberada, ver la cabecera de
      // `FacturaeSigningService` para el porqué (anidarlo invalida la firma).
      expect(xml).toMatch(/<ds:Object[\s\S]*<ds:Signature/);

      // La prueba real: la firma valida contra el propio certificado, con
      // la misma librería que la firmó — no solo "parece" una firma. La API
      // de `xml-crypto` exige seleccionar el nodo `<Signature>` a mano
      // (`loadSignature`) antes de `checkSignature`, ver su README.
      const certPem = readFileSync(certPath, 'utf-8');
      const doc = new DOMParser().parseFromString(xml);
      const signatureNode = xpath.select1(
        "//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']",
        doc,
      );
      const verifier = new SignedXml({ publicCert: certPem });
      verifier.loadSignature(signatureNode as unknown as Node);
      expect(verifier.checkSignature(xml)).toBe(true);

      delete process.env.FACTURAE_CERT_PATH;
      delete process.env.FACTURAE_KEY_PATH;
    });
  });
});
