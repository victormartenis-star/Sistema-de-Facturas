import { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { companies, getDb, idempotencyKeys, invoices } from '@erp/db';
import { jsonCanonico } from '@erp/shared';
import { hashCuerpo } from '../../src/common/idempotencia/idempotencia.interceptor';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Idempotencia con cabecera `Idempotency-Key`
 * (`apps/api/src/common/idempotencia/`).
 */
describe('Idempotencia (integración) — Idempotency-Key', () => {
  let app: INestApplication;
  let token: string;
  let companyId: string;
  let clienteId: string;
  let projectId: string;
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp();
    companyId = await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    token = (await registerUser(app, { email: 'admin@test.dintel.es' }))
      .accessToken;
    clienteId = (await createContact(app, token, { kind: 'cliente' })).id;
    projectId = (await createProject(app, token, { contractAmount: 100_000 }))
      .id;
  });

  function cuerpoFactura() {
    seq += 1;
    return {
      kind: 'venta',
      contactId: clienteId,
      invoiceNumber: `IDEM-${Date.now()}-${seq}`,
      issueDate: '2026-09-14',
      lines: [
        {
          description: 'Línea',
          baseAmount: 1000,
          vatPct: 21,
          projectId,
        },
      ],
    };
  }

  const postConClave = (url: string, clave: string, cuerpo: object) =>
    authed(app, token).post(url).set('Idempotency-Key', clave).send(cuerpo);

  async function contarFacturas(): Promise<number> {
    const [r] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices);
    return r.n;
  }

  it('POST /invoices repetido con la misma clave: mismo id, una fila y replay', async () => {
    const cuerpo = cuerpoFactura();
    const clave = randomUUID();
    const r1 = await postConClave('/invoices', clave, cuerpo);
    expect(r1.status).toBe(201);
    expect(r1.headers['idempotent-replayed']).toBeUndefined();

    const r2 = await postConClave('/invoices', clave, cuerpo);
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body).toEqual(r1.body);
    expect(r2.body.id).toBe(r1.body.id);
    expect(await contarFacturas()).toBe(1);
  });

  it('el mismo cuerpo con las claves en otro orden se considera el mismo cuerpo', async () => {
    const cuerpo = cuerpoFactura();
    const clave = randomUUID();
    await postConClave('/invoices', clave, cuerpo).expect(201);
    const reordenado = Object.fromEntries(Object.entries(cuerpo).reverse());
    const r2 = await postConClave('/invoices', clave, reordenado);
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(await contarFacturas()).toBe(1);
  });

  it('POST /certifications con la misma clave crea una sola certificación', async () => {
    const proyecto = await createProject(app, token, {
      contractAmount: 100_000,
    });
    const cuerpo = {
      projectId: proyecto.id,
      certDate: '2026-09-14',
      cumulativePct: 25,
    };
    const clave = randomUUID();
    const r1 = await postConClave('/certifications', clave, cuerpo);
    expect(r1.status).toBe(201);
    const r2 = await postConClave('/certifications', clave, cuerpo);
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.id).toBe(r1.body.id);
    const lista = await authed(app, token)
      .get(`/certifications?projectId=${proyecto.id}`)
      .expect(200);
    expect(lista.body).toHaveLength(1);
  });

  it('POST /invoices/:id/rectificar con la misma clave crea una sola rectificativa', async () => {
    const factura = await authed(app, token)
      .post('/invoices')
      .send(cuerpoFactura())
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${factura.body.id}/aprobar`)
      .expect(201);
    const cuerpo = {
      clase: 'total',
      rectificationMotive: 'R4',
      rectificationType: 'S',
      facturaeReasonCode: '16',
      issueDate: '2026-10-01',
      motivo: 'Cliente equivocado en la factura',
    };
    const clave = randomUUID();
    const url = `/invoices/${factura.body.id}/rectificar`;
    const r1 = await postConClave(url, clave, cuerpo);
    expect(r1.status).toBe(201);
    const r2 = await postConClave(url, clave, cuerpo);
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.id).toBe(r1.body.id);
    const rect = await getDb()
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.rectifiesInvoiceId, factura.body.id));
    expect(rect).toHaveLength(1);
  });

  it('misma clave con cuerpo distinto o en otra ruta: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const clave = randomUUID();
    await postConClave('/invoices', clave, cuerpoFactura()).expect(201);

    const otroCuerpo = await postConClave('/invoices', clave, cuerpoFactura());
    expect(otroCuerpo.status).toBe(409);
    expect(otroCuerpo.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const otraRuta = await postConClave('/certifications', clave, {});
    expect(otraRuta.status).toBe(409);
    expect(otraRuta.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await contarFacturas()).toBe(1);
  });

  it('concurrencia: 5 POST idénticos con la misma clave crean una sola factura', async () => {
    const cuerpo = cuerpoFactura();
    const clave = randomUUID();
    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () => postConClave('/invoices', clave, cuerpo)),
    );
    for (const r of respuestas) {
      if (r.status === 201) continue;
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
      expect(r.headers['retry-after']).toBe('1');
    }
    const creadas = respuestas.filter(
      (r) => r.status === 201 && !r.headers['idempotent-replayed'],
    );
    expect(creadas).toHaveLength(1);
    expect(await contarFacturas()).toBe(1);
  });

  it('un 400 de validación no deja la clave bloqueada', async () => {
    const clave = randomUUID();
    const erroneo = { ...cuerpoFactura(), lines: [] };
    await postConClave('/invoices', clave, erroneo).expect(400);
    await postConClave('/invoices', clave, erroneo).expect(400);
    const filas = await getDb().select().from(idempotencyKeys);
    expect(filas).toHaveLength(0);

    // Con la clave libre, el mismo identificador sirve con un cuerpo corregido.
    const ok = await postConClave('/invoices', clave, cuerpoFactura());
    expect(ok.status).toBe(201);
    expect(await contarFacturas()).toBe(1);
  });

  it('aislamiento: la clave es por empresa (restricción UNIQUE company_id+key)', async () => {
    // El harness solo admite una empresa (el registro público se cierra con
    // la primera), así que se prueba contra la restricción UNIQUE directamente.
    const db = getDb();
    const [otra] = await db
      .insert(companies)
      .values({ name: 'Otra empresa', taxId: 'B11111111' })
      .returning();
    const base = {
      key: 'misma-clave',
      method: 'POST',
      path: '/invoices',
      requestHash: 'a'.repeat(64),
      status: 'procesando',
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    await db.insert(idempotencyKeys).values({ ...base, companyId });
    await db.insert(idempotencyKeys).values({ ...base, companyId: otra.id });
    await expect(
      db.insert(idempotencyKeys).values({ ...base, companyId }),
    ).rejects.toThrow();
    const filas = await db.select().from(idempotencyKeys);
    expect(filas).toHaveLength(2);
  });

  it('sin cabecera: comportamiento idéntico al actual (no deduplica ni guarda nada)', async () => {
    const cuerpo = cuerpoFactura();
    const r1 = await authed(app, token).post('/invoices').send(cuerpo);
    const r2 = await authed(app, token).post('/invoices').send(cuerpo);
    expect(r1.status).toBe(201);
    expect(r1.headers['idempotent-replayed']).toBeUndefined();
    // Hoy el segundo POST con el mismo número lo para la clave natural (409),
    // no el interceptor: no es un replay.
    expect(r2.status).toBe(409);
    expect(r2.headers['idempotent-replayed']).toBeUndefined();
    expect(r2.body.code).toBe('INVOICE_NUMBER_DUPLICATED');
    expect(await contarFacturas()).toBe(1);
    const filas = await getDb().select().from(idempotencyKeys);
    expect(filas).toHaveLength(0);
  });

  it('una clave "procesando" caducada se puede retomar', async () => {
    const cuerpo = cuerpoFactura();
    const clave = randomUUID();
    await getDb()
      .insert(idempotencyKeys)
      .values({
        companyId,
        key: clave,
        method: 'POST',
        path: '/invoices',
        requestHash: hashCuerpo(cuerpo),
        status: 'procesando',
        lockedUntil: new Date(Date.now() - 5_000),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    const r = await postConClave('/invoices', clave, cuerpo);
    expect(r.status).toBe(201);
    expect(r.headers['idempotent-replayed']).toBeUndefined();
    const [fila] = await getDb().select().from(idempotencyKeys);
    expect(fila.status).toBe('completada');
    expect(fila.responseStatus).toBe(201);
  });

  it('una clave "procesando" vigente responde 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const cuerpo = cuerpoFactura();
    const clave = randomUUID();
    await getDb()
      .insert(idempotencyKeys)
      .values({
        companyId,
        key: clave,
        method: 'POST',
        path: '/invoices',
        requestHash: hashCuerpo(cuerpo),
        status: 'procesando',
        lockedUntil: new Date(Date.now() + 30_000),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    const r = await postConClave('/invoices', clave, cuerpo);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(await contarFacturas()).toBe(0);
  });

  it('una clave con expires_at vencida se trata como inexistente', async () => {
    const cuerpo = cuerpoFactura();
    const clave = randomUUID();
    await getDb()
      .insert(idempotencyKeys)
      .values({
        companyId,
        key: clave,
        method: 'POST',
        path: '/certifications', // otra ruta: si no se ignorara, daría 409
        requestHash: 'b'.repeat(64),
        status: 'completada',
        responseStatus: 201,
        responseBody: { id: 'viejo' },
        expiresAt: new Date(Date.now() - 1_000),
      });
    const r = await postConClave('/invoices', clave, cuerpo);
    expect(r.status).toBe(201);
    expect(r.headers['idempotent-replayed']).toBeUndefined();
    expect(await contarFacturas()).toBe(1);
  });

  describe('hash del cuerpo (unitario)', () => {
    it('mismo objeto con claves en otro orden: mismo SHA-256 hex de 64', () => {
      const h1 = hashCuerpo({ a: 1, b: { c: [1, { y: 1, x: 2 }], d: null } });
      const h2 = hashCuerpo({ b: { d: null, c: [1, { x: 2, y: 1 }] }, a: 1 });
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('objetos distintos: hash distinto', () => {
      expect(hashCuerpo({ a: 1 })).not.toBe(hashCuerpo({ a: 2 }));
      expect(jsonCanonico({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    });
  });
});
