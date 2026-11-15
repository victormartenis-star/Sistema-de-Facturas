import { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getDb } from '@erp/db';
import {
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Concurrencia optimista (cabecera `If-Match`, columna `version`): ver
 * `apps/api/src/common/version.ts`.
 */
describe('Versión optimista (integración) — If-Match', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    delete process.env.EXIGIR_VERSION;
    await app.close();
  });

  beforeEach(async () => {
    delete process.env.EXIGIR_VERSION;
    await resetTestDb();
    token = (await registerUser(app, { email: 'admin@test.dintel.es' }))
      .accessToken;
  });

  /** Una entidad editable: dónde se edita, cómo se lee y qué campo se toca. */
  interface Entidad {
    nombre: string;
    campo: string;
    /** URL del PATCH / DELETE. */
    url: string;
    /** Lee la entidad (con su `version`). */
    leer: () => Promise<Record<string, unknown>>;
    /** Cuerpo del PATCH que fija `campo` al valor dado. */
    cuerpo: (valor: string) => Record<string, unknown>;
  }

  async function crearEntidades(): Promise<Entidad[]> {
    const project = await createProject(app, token, {
      contractAmount: 100_000,
    });
    const proveedor = await createContact(app, token, { kind: 'proveedor' });
    const cliente = await createContact(app, token, { kind: 'cliente' });

    // Factura (borrador)
    const factura = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'Línea',
            baseAmount: 1000,
            vatPct: 21,
            projectId: project.id,
          },
        ],
      })
      .expect(201);

    // Presupuesto y partida
    const budget = await createBudget(app, token, project.id);
    const item = await addBudgetItem(app, token, budget.id);

    // Pedido
    const pedido = await authed(app, token)
      .post('/purchase-orders')
      .send({
        projectId: project.id,
        contactId: proveedor.id,
        orderDate: '2026-09-14',
        description: 'Suministro',
        amount: 500,
      })
      .expect(201);

    // Albarán
    const albaran = await authed(app, token)
      .post('/delivery-notes')
      .send({
        contactId: proveedor.id,
        orderId: pedido.body.id,
        noteNumber: `ALB-${Date.now()}`,
        noteDate: '2026-09-14',
        amount: 500,
      })
      .expect(201);

    // Certificación y línea
    const cert = await authed(app, token)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 40,
      })
      .expect(201);
    const linea = await authed(app, token)
      .post(`/certifications/${cert.body.id}/lines`)
      .send({
        budgetItemId: item.id,
        cumulativePct: 40,
        cumulativeAmount: 400,
        periodAmount: 400,
      })
      .expect(201);

    const get = async (url: string) =>
      (await authed(app, token).get(url).expect(200)).body as Record<
        string,
        unknown
      >;

    return [
      {
        nombre: 'factura (borrador)',
        campo: 'notes',
        url: `/invoices/${factura.body.id}`,
        leer: () => get(`/invoices/${factura.body.id}`),
        cuerpo: (v) => ({ notes: v }),
      },
      {
        nombre: 'presupuesto',
        campo: 'name',
        url: `/budgets/${budget.id}`,
        leer: () => get(`/budgets/${budget.id}`),
        cuerpo: (v) => ({ name: v }),
      },
      {
        nombre: 'partida de presupuesto',
        campo: 'name',
        url: `/budget-items/${item.id}`,
        leer: async () => {
          const det = await get(`/budgets/${budget.id}`);
          return (det.items as Record<string, unknown>[]).find(
            (i) => i.id === item.id,
          )!;
        },
        cuerpo: (v) => ({ name: v }),
      },
      {
        nombre: 'pedido',
        campo: 'description',
        url: `/purchase-orders/${pedido.body.id}`,
        leer: () => get(`/purchase-orders/${pedido.body.id}`),
        cuerpo: (v) => ({ description: v }),
      },
      {
        nombre: 'albarán',
        campo: 'description',
        url: `/delivery-notes/${albaran.body.id}`,
        leer: async () => {
          const lista = await authed(app, token)
            .get('/delivery-notes')
            .expect(200);
          return (lista.body as Record<string, unknown>[]).find(
            (n) => n.id === albaran.body.id,
          )!;
        },
        cuerpo: (v) => ({ description: v }),
      },
      {
        nombre: 'línea de certificación',
        campo: 'notes',
        url: `/certifications/${cert.body.id}/lines/${linea.body.id}`,
        leer: async () => {
          const lista = await authed(app, token)
            .get(`/certifications/${cert.body.id}/lines`)
            .expect(200);
          return (lista.body as Record<string, unknown>[]).find(
            (l) => l.id === linea.body.id,
          )!;
        },
        cuerpo: (v) => ({ notes: v }),
      },
    ];
  }

  it('migración: las 7 tablas tienen version integer NOT NULL DEFAULT 1 y invoice_lines no', async () => {
    const res = await getDb().execute(sql`
      SELECT table_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE column_name = 'version' AND table_schema = 'public'
      ORDER BY table_name`);
    const filas = res.rows as {
      table_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string;
    }[];
    expect(filas.map((f) => f.table_name)).toEqual(
      expect.arrayContaining([
        'budget_items',
        'budgets',
        'certification_lines',
        'certifications',
        'delivery_notes',
        'invoices',
        'purchase_orders',
      ]),
    );
    expect(filas.map((f) => f.table_name)).not.toContain('invoice_lines');
    for (const f of filas) {
      expect(f.data_type).toBe('integer');
      expect(f.is_nullable).toBe('NO');
      expect(f.column_default).toBe('1');
    }
  });

  it('migración: una fila creada antes de la columna (INSERT sin version) tiene version = 1', async () => {
    const ents = await crearEntidades();
    const res = await getDb().execute(
      sql`SELECT version FROM invoices UNION ALL SELECT version FROM budgets UNION ALL SELECT version FROM certifications`,
    );
    expect((res.rows as { version: number }[]).map((r) => r.version)).toEqual([
      1, 1, 1,
    ]);
    expect(ents.length).toBeGreaterThan(0);
  });

  it('GET devuelve version 1 en todas las entidades y la certificación', async () => {
    const ents = await crearEntidades();
    for (const e of ents) {
      expect((await e.leer()).version).toBe(1);
    }
    const certs = await authed(app, token).get('/certifications').expect(200);
    expect(certs.body[0].version).toBe(1);
  });

  it('PATCH con If-Match "1" → 200 y version 2; repetir con "1" → 409 VERSION_CONFLICT', async () => {
    const ents = await crearEntidades();
    for (const e of ents) {
      const ok = await authed(app, token)
        .patch(e.url)
        .set('If-Match', '"1"')
        .send(e.cuerpo('primero'))
        .expect(200);
      expect(ok.body.version).toBe(2);
      expect((await e.leer()).version).toBe(2);

      const conflicto = await authed(app, token)
        .patch(e.url)
        .set('If-Match', '"1"')
        .send(e.cuerpo('segundo'))
        .expect(409);
      expect(conflicto.body).toMatchObject({
        code: 'VERSION_CONFLICT',
        versionActual: 2,
      });
      expect((await e.leer())[e.campo]).toBe('primero');
    }
  });

  it('If-Match sin comillas (1) también se acepta', async () => {
    const [factura] = await crearEntidades();
    await authed(app, token)
      .patch(factura.url)
      .set('If-Match', '1')
      .send(factura.cuerpo('x'))
      .expect(200);
    expect((await factura.leer()).version).toBe(2);
  });

  it('concurrencia real: dos PATCH simultáneos con If-Match "1" → un 200 y un 409, versión final 2', async () => {
    const ents = await crearEntidades();
    for (const e of ents) {
      const [a, b] = await Promise.all([
        authed(app, token)
          .patch(e.url)
          .set('If-Match', '"1"')
          .send(e.cuerpo('valor-A')),
        authed(app, token)
          .patch(e.url)
          .set('If-Match', '"1"')
          .send(e.cuerpo('valor-B')),
      ]);
      const estados = [a.status, b.status].sort();
      expect({ entidad: e.nombre, estados }).toEqual({
        entidad: e.nombre,
        estados: [200, 409],
      });
      const ganador = a.status === 200 ? 'valor-A' : 'valor-B';
      const perdedor = a.status === 200 ? b : a;
      expect(perdedor.body.code).toBe('VERSION_CONFLICT');
      const final = await e.leer();
      expect(final.version).toBe(2);
      expect(final[e.campo]).toBe(ganador);
    }
  });

  it('una acción POST (aprobar) incrementa la versión: un PATCH posterior con la versión vieja da 409', async () => {
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const project = await createProject(app, token);
    const f = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'L',
            baseAmount: 100,
            vatPct: 21,
            projectId: project.id,
          },
        ],
      })
      .expect(201);
    expect(f.body.version).toBe(1);

    // La acción no exige If-Match.
    await authed(app, token).post(`/invoices/${f.body.id}/aprobar`).expect(201);
    const tras = await authed(app, token).get(`/invoices/${f.body.id}`);
    expect(tras.body.version).toBe(2);

    const res = await authed(app, token)
      .patch(`/invoices/${f.body.id}`)
      .set('If-Match', '"1"')
      .send({ notes: 'tarde' })
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'VERSION_CONFLICT',
      versionActual: 2,
    });
  });

  it('una acción POST con If-Match desfasado → 409 VERSION_CONFLICT; con el correcto → 201', async () => {
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const project = await createProject(app, token);
    const f = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `F-${Date.now()}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'L',
            baseAmount: 100,
            vatPct: 21,
            projectId: project.id,
          },
        ],
      })
      .expect(201);
    const mala = await authed(app, token)
      .post(`/invoices/${f.body.id}/aprobar`)
      .set('If-Match', '"7"')
      .expect(409);
    expect(mala.body).toMatchObject({
      code: 'VERSION_CONFLICT',
      versionActual: 1,
    });
    await authed(app, token)
      .post(`/invoices/${f.body.id}/aprobar`)
      .set('If-Match', '"1"')
      .expect(201);
  });

  it('política por defecto (EXIGIR_VERSION sin definir): PATCH y DELETE sin If-Match → 428; con If-Match → 200', async () => {
    expect(process.env.EXIGIR_VERSION).toBeUndefined();
    const [factura] = await crearEntidades();
    const res = await authed(app, token)
      .patch(factura.url)
      .send(factura.cuerpo('sin cabecera'))
      .expect(428);
    expect(res.body.code).toBe('PRECONDITION_REQUIRED');
    await authed(app, token).delete(factura.url).expect(428);
    await authed(app, token)
      .patch(factura.url)
      .set('If-Match', '"1"')
      .send(factura.cuerpo('con cabecera'))
      .expect(200);
  });

  it('política EXIGIR_VERSION=false (explícito): sin If-Match → 200 y se incrementa', async () => {
    const [factura] = await crearEntidades();
    process.env.EXIGIR_VERSION = 'false';
    try {
      await authed(app, token)
        .patch(factura.url)
        .send(factura.cuerpo('sin cabecera'))
        .expect(200);
      expect((await factura.leer()).version).toBe(2);
    } finally {
      delete process.env.EXIGIR_VERSION;
    }
  });

  it('política EXIGIR_VERSION=true: sin If-Match → 428 (PATCH y DELETE); con If-Match y acciones POST siguen funcionando', async () => {
    const ents = await crearEntidades();
    const factura = ents[0];
    process.env.EXIGIR_VERSION = 'true';
    try {
      for (const e of ents) {
        const res = await authed(app, token)
          .patch(e.url)
          .send(e.cuerpo('x'))
          .expect(428);
        expect(res.body.code).toBe('PRECONDITION_REQUIRED');
      }
      await authed(app, token).delete(factura.url).expect(428);

      await authed(app, token)
        .patch(factura.url)
        .set('If-Match', '"1"')
        .send(factura.cuerpo('con cabecera'))
        .expect(200);
      // Las acciones no exigen If-Match.
      await authed(app, token).post(`${factura.url}/aprobar`).expect(201);
    } finally {
      delete process.env.EXIGIR_VERSION;
    }
  });

  it('If-Match basura → 400', async () => {
    const [factura] = await crearEntidades();
    for (const basura of ['abc', '0', '-1', '1.5', '"1"x']) {
      await authed(app, token)
        .patch(factura.url)
        .set('If-Match', basura)
        .send(factura.cuerpo('x'))
        .expect(400);
    }
    // Ni siquiera con el flag desactivado se ignora una cabecera mal formada.
    expect((await factura.leer()).version).toBe(1);
  });

  it('DELETE con If-Match desfasado → 409; con el correcto → 204', async () => {
    const [factura] = await crearEntidades();
    await authed(app, token)
      .patch(factura.url)
      .set('If-Match', '"1"')
      .send(factura.cuerpo('x'))
      .expect(200);
    await authed(app, token)
      .delete(factura.url)
      .set('If-Match', '"1"')
      .expect(409);
    await authed(app, token)
      .delete(factura.url)
      .set('If-Match', '"2"')
      .expect(204);
  });

  it('PATCH sobre un recurso inexistente con If-Match → 404', async () => {
    await authed(app, token)
      .patch('/invoices/00000000-0000-0000-0000-000000000000')
      .set('If-Match', '"1"')
      .send({ notes: 'x' })
      .expect(404);
  });
});
