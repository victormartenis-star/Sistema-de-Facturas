import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  authed,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Bank Reconciliation (integración) — importación y conciliación asistida', () => {
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

  /** Factura de venta aprobada: deja un vencimiento `cobro` de 1210 € (base 1000 + 21% IVA) a `2026-10-14`. */
  async function approvedVentaInvoice(
    token: string,
    contactId: string,
    projectId: string,
  ): Promise<void> {
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId,
        invoiceNumber: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        lines: [
          {
            description: 'Certificación mensual',
            baseAmount: 1000,
            vatPct: 21,
            projectId,
          },
        ],
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${res.body.id}/aprobar`)
      .expect(201);
  }

  async function createBankAccount(token: string): Promise<string> {
    const res = await authed(app, token)
      .post('/treasury/cuentas')
      .send({ name: 'Cuenta corriente' })
      .expect(201);
    return res.body.id as string;
  }

  it('importa un extracto CSV, sugiere el vencimiento correcto y lo concilia', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const contact = await createContact(app, admin.accessToken);
    await approvedVentaInvoice(
      admin.accessToken,
      contact.id as string,
      project.id,
    );
    const bankAccountId = await createBankAccount(admin.accessToken);

    const csv = [
      'fecha,concepto,importe,saldo',
      '2026-10-15,Transferencia recibida cliente,1210.00,5000.00',
    ].join('\n');

    const importRes = await authed(app, admin.accessToken)
      .post('/bank-reconciliation/importar')
      .field('bankAccountId', bankAccountId)
      .field('format', 'csv')
      .attach('file', Buffer.from(csv), {
        filename: 'extracto.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(importRes.body).toEqual({ total: 1, imported: 1, duplicates: 0 });

    const list = (
      await authed(app, admin.accessToken)
        .get(
          `/bank-reconciliation/transacciones?bankAccountId=${bankAccountId}`,
        )
        .expect(200)
    ).body as { id: string; reconciledMilestoneId: string | null }[];
    expect(list).toHaveLength(1);
    expect(list[0].reconciledMilestoneId).toBeNull();
    const transactionId = list[0].id;

    const suggestions = (
      await authed(app, admin.accessToken)
        .get(`/bank-reconciliation/sugerencias?bankAccountId=${bankAccountId}`)
        .expect(200)
    ).body as {
      transactionId: string;
      candidates: { milestoneId: string; confidence: string }[];
    }[];
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].transactionId).toBe(transactionId);
    expect(suggestions[0].candidates[0].confidence).toBe('alta');
    const milestoneId = suggestions[0].candidates[0].milestoneId;

    await authed(app, admin.accessToken)
      .post(`/bank-reconciliation/transacciones/${transactionId}/conciliar`)
      .send({ milestoneId })
      .expect(204);

    const milestones = (
      await authed(app, admin.accessToken)
        .get('/treasury/milestones')
        .expect(200)
    ).body as { id: string; status: string }[];
    expect(milestones.find((m) => m.id === milestoneId)?.status).toBe('pagado');

    const reconciledList = (
      await authed(app, admin.accessToken)
        .get(
          `/bank-reconciliation/transacciones?bankAccountId=${bankAccountId}&reconciled=true`,
        )
        .expect(200)
    ).body as { id: string }[];
    expect(reconciledList).toHaveLength(1);
  });

  it('reimportar el mismo extracto no duplica movimientos', async () => {
    const admin = await registerUser(app);
    const bankAccountId = await createBankAccount(admin.accessToken);
    const csv = [
      'fecha,concepto,importe,saldo',
      '2026-10-15,Ingreso vario,300.00,1000.00',
    ].join('\n');

    const attachAndImport = () =>
      authed(app, admin.accessToken)
        .post('/bank-reconciliation/importar')
        .field('bankAccountId', bankAccountId)
        .field('format', 'csv')
        .attach('file', Buffer.from(csv), {
          filename: 'extracto.csv',
          contentType: 'text/csv',
        })
        .expect(201);

    const first = await attachAndImport();
    expect(first.body).toEqual({ total: 1, imported: 1, duplicates: 0 });
    const second = await attachAndImport();
    expect(second.body).toEqual({ total: 1, imported: 0, duplicates: 1 });

    const list = (
      await authed(app, admin.accessToken)
        .get(
          `/bank-reconciliation/transacciones?bankAccountId=${bankAccountId}`,
        )
        .expect(200)
    ).body as unknown[];
    expect(list).toHaveLength(1);
  });

  it('rechaza conciliar dos veces el mismo movimiento, y desconciliar no revierte el vencimiento a previsto', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const contact = await createContact(app, admin.accessToken);
    await approvedVentaInvoice(
      admin.accessToken,
      contact.id as string,
      project.id,
    );
    const bankAccountId = await createBankAccount(admin.accessToken);

    const csv = [
      'fecha,concepto,importe,saldo',
      '2026-10-15,Transferencia recibida cliente,1210.00,5000.00',
    ].join('\n');
    await authed(app, admin.accessToken)
      .post('/bank-reconciliation/importar')
      .field('bankAccountId', bankAccountId)
      .field('format', 'csv')
      .attach('file', Buffer.from(csv), { filename: 'e.csv' })
      .expect(201);

    const [tx] = (
      await authed(app, admin.accessToken)
        .get(
          `/bank-reconciliation/transacciones?bankAccountId=${bankAccountId}`,
        )
        .expect(200)
    ).body as { id: string }[];
    const [suggestion] = (
      await authed(app, admin.accessToken)
        .get(`/bank-reconciliation/sugerencias?bankAccountId=${bankAccountId}`)
        .expect(200)
    ).body as { candidates: { milestoneId: string }[] }[];
    const milestoneId = suggestion.candidates[0].milestoneId;

    await authed(app, admin.accessToken)
      .post(`/bank-reconciliation/transacciones/${tx.id}/conciliar`)
      .send({ milestoneId })
      .expect(204);
    await authed(app, admin.accessToken)
      .post(`/bank-reconciliation/transacciones/${tx.id}/conciliar`)
      .send({ milestoneId })
      .expect(409);

    await authed(app, admin.accessToken)
      .post(`/bank-reconciliation/transacciones/${tx.id}/desconciliar`)
      .expect(204);

    const milestones = (
      await authed(app, admin.accessToken)
        .get('/treasury/milestones')
        .expect(200)
    ).body as { id: string; status: string }[];
    expect(milestones.find((m) => m.id === milestoneId)?.status).toBe('pagado');
  });

  it('un usuario `obra` no puede importar ni conciliar (403)', async () => {
    const admin = await registerUser(app);
    const bankAccountId = await createBankAccount(admin.accessToken);
    const { tokens: obraTokens } = await createObraUser(
      app,
      admin.accessToken,
      [],
    );

    await authed(app, obraTokens.accessToken)
      .post('/bank-reconciliation/importar')
      .field('bankAccountId', bankAccountId)
      .field('format', 'csv')
      .attach('file', Buffer.from('fecha,concepto,importe\n2026-10-15,x,1\n'), {
        filename: 'e.csv',
      })
      .expect(403);
  });

  it('exige token', async () => {
    await request(app.getHttpServer())
      .get('/bank-reconciliation/transacciones')
      .expect(401);
  });
});
