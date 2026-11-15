import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, invoices } from '@erp/db';
import { VERIFACTU_GENESIS_HASH } from '@erp/shared';
import {
  authed,
  createContact,
  createProject,
  createTestApp,
  ifMatchDe,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Integridad de la cadena VeriFactu (auditoría 3.1) y reenvío a la AEAT
 * (3.3): solo se encadenan facturas emitidas, una huella ya enviada no se
 * recalcula nunca, editar un borrador anula su huella y una factura enviada
 * no se reenvía.
 */
describe('VeriFactu: integridad de la cadena (integración)', () => {
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

  const unico = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  async function entorno() {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const project = await createProject(app, token);
    const cliente = await createContact(app, token, { taxId: 'B11111111' });
    return { token, project, cliente };
  }

  async function venta(
    env: Awaited<ReturnType<typeof entorno>>,
    issueDate: string,
    aprobar: boolean,
  ): Promise<string> {
    const res = await authed(app, env.token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: env.cliente.id,
        invoiceNumber: `F-${unico()}`,
        issueDate,
        dueDate: '2026-12-31',
        lines: [
          {
            description: 'Línea',
            baseAmount: 1000,
            vatPct: 21,
            projectId: env.project.id,
          },
        ],
      })
      .expect(201);
    const id = res.body.id as string;
    if (aprobar) {
      await authed(app, env.token).post(`/invoices/${id}/aprobar`).expect(201);
    }
    return id;
  }

  async function fila(id: string) {
    const [r] = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.id, id));
    return r;
  }

  const descargar = (env: { token: string }, id: string) =>
    authed(app, env.token).get(`/invoices/${id}/facturae`);

  it('3.1a: un borrador anterior no entra en la cadena y borrarlo no cambia la huella', async () => {
    const env = await entorno();
    const borrador = await venta(env, '2026-09-01', false);
    const v2 = await venta(env, '2026-09-10', true);
    await descargar(env, v2).expect(200);
    const antes = await fila(v2);
    expect(antes.verifactuPreviousHash).toBe(VERIFACTU_GENESIS_HASH);
    await authed(app, env.token)
      .delete(`/invoices/${borrador}`)
      .set('If-Match', await ifMatchDe(app, env.token, `/invoices/${borrador}`))
      .expect(204);
    await descargar(env, v2).expect(200);
    const despues = await fila(v2);
    expect(despues.verifactuHash).toBe(antes.verifactuHash);
    expect(despues.verifactuPreviousHash).toBe(VERIFACTU_GENESIS_HASH);
  });

  it('3.1a: una anulada (compra de huella previa) tampoco se encadena', async () => {
    const env = await entorno();
    const v1 = await venta(env, '2026-09-01', true);
    await authed(app, env.token).post(`/invoices/${v1}/pagar`).expect(201);
    const borrador = await venta(env, '2026-09-05', false);
    await authed(app, env.token)
      .post(`/invoices/${borrador}/anular`)
      .send({})
      .expect(201);
    const v3 = await venta(env, '2026-09-10', true);
    await descargar(env, v3).expect(200);
    const r1 = await fila(v1);
    const r3 = await fila(v3);
    expect(r3.verifactuPreviousHash).toBe(r1.verifactuHash);
  });

  it('3.1b: una huella ya enviada no se sobrescribe: 409 y huella intacta', async () => {
    const env = await entorno();
    const v2 = await venta(env, '2026-09-10', true);
    await descargar(env, v2).expect(200);
    await getDb()
      .update(invoices)
      .set({ verifactuStatus: 'enviado', verifactuSentAt: new Date() })
      .where(eq(invoices.id, v2));
    const antes = await fila(v2);

    // Una factura con fecha anterior se aprueba después: cambia lo que
    // precede a V2 y obligaría a recalcular su huella.
    await venta(env, '2026-09-01', true);
    const res = await descargar(env, v2);
    expect(res.status).toBe(409);
    const despues = await fila(v2);
    expect(despues.verifactuHash).toBe(antes.verifactuHash);
    expect(despues.verifactuPreviousHash).toBe(antes.verifactuPreviousHash);
    expect(despues.verifactuGeneratedAt?.toISOString()).toBe(
      antes.verifactuGeneratedAt?.toISOString(),
    );
  });

  it('3.1c: editar un borrador anula cualquier huella que tuviera', async () => {
    const env = await entorno();
    const borrador = await venta(env, '2026-09-01', false);
    await getDb()
      .update(invoices)
      .set({
        verifactuHash: 'a'.repeat(64),
        verifactuPreviousHash: 'b'.repeat(64),
        verifactuGeneratedAt: new Date(),
      })
      .where(eq(invoices.id, borrador));
    await authed(app, env.token)
      .patch(`/invoices/${borrador}`)
      .set('If-Match', await ifMatchDe(app, env.token, `/invoices/${borrador}`))
      .send({ notes: 'cambio' })
      .expect(200);
    const r = await fila(borrador);
    expect(r.verifactuHash).toBeNull();
    expect(r.verifactuPreviousHash).toBeNull();
    expect(r.verifactuGeneratedAt).toBeNull();
  });

  it('3.1d: descargas concurrentes dejan una cadena coherente', async () => {
    const env = await entorno();
    const ids: string[] = [];
    for (let i = 1; i <= 6; i++) {
      ids.push(await venta(env, `2026-09-${String(i).padStart(2, '0')}`, true));
    }
    const res = await Promise.all(ids.map((id) => descargar(env, id)));
    for (const r of res) expect(r.status).toBe(200);
    let previo = VERIFACTU_GENESIS_HASH;
    for (const id of ids) {
      const r = await fila(id);
      expect(r.verifactuPreviousHash).toBe(previo);
      previo = r.verifactuHash as string;
    }
  });

  it('3.3: reenviar una factura ya enviada responde 409 y no toca verifactuSentAt', async () => {
    const env = await entorno();
    const id = await venta(env, '2026-09-10', true);
    const sentAt = new Date('2026-09-11T10:00:00.000Z');
    await getDb()
      .update(invoices)
      .set({ verifactuStatus: 'enviado', verifactuSentAt: sentAt })
      .where(eq(invoices.id, id));
    await authed(app, env.token)
      .post(`/invoices/${id}/verifactu/enviar`)
      .expect(409);
    const r = await fila(id);
    expect(r.verifactuStatus).toBe('enviado');
    expect(r.verifactuSentAt?.toISOString()).toBe(sentAt.toISOString());
  });
});
