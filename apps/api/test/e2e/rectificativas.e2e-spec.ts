import { INestApplication } from '@nestjs/common';
import {
  authed,
  createContact,
  createObraUser,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Fase 3, tramo 2: facturas rectificativas (total y por diferencias), motivo
 * de anulación, bloqueo de anulación de ventas aprobadas y bloqueo de
 * Facturae/VeriFactu para rectificativas.
 */
describe('Facturas rectificativas y anulación (integración)', () => {
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

  async function ventaAprobada(
    token: string,
    contactId: string,
    projectId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId,
        invoiceNumber: `F-${unico()}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        retentionPct: 5,
        lines: [
          {
            description: 'Certificación mensual',
            baseAmount: 1000,
            vatPct: 21,
            projectId,
          },
        ],
        ...overrides,
      })
      .expect(201);
    const id = res.body.id as string;
    await authed(app, token).post(`/invoices/${id}/aprobar`).expect(201);
    return id;
  }

  /** Compra aprobada con un albarán validado de 500 €. */
  async function compraAprobada(
    token: string,
    contactId: string,
    projectId: string,
  ): Promise<{ invoiceId: string; noteId: string }> {
    const order = await authed(app, token)
      .post('/purchase-orders')
      .send({
        projectId,
        contactId,
        orderDate: '2026-09-14',
        description: 'Suministro',
        amount: 500,
      })
      .expect(201);
    const note = await authed(app, token)
      .post('/delivery-notes')
      .send({
        contactId,
        orderId: order.body.id,
        noteNumber: `ALB-${unico()}`,
        noteDate: '2026-09-14',
        amount: 500,
      })
      .expect(201);
    await authed(app, token)
      .post(`/delivery-notes/${note.body.id}/validar`)
      .expect(201);
    const inv = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId,
        invoiceNumber: `FC-${unico()}`,
        issueDate: '2026-09-14',
        deliveryNoteIds: [note.body.id],
        lines: [
          { description: 'Materiales', baseAmount: 500, vatPct: 21, projectId },
        ],
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${inv.body.id}/aprobar`)
      .expect(201);
    return { invoiceId: inv.body.id as string, noteId: note.body.id as string };
  }

  async function albaran(
    token: string,
    noteId: string,
  ): Promise<{ body: { status: string; invoiceId: string | null } }> {
    const res = await authed(app, token).get('/delivery-notes').expect(200);
    const found = (res.body as { id: string }[]).find((n) => n.id === noteId);
    return { body: found as never };
  }

  async function entorno() {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const project = await createProject(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const proveedor = await createContact(app, token, { kind: 'proveedor' });
    return { token, project, cliente, proveedor };
  }

  describe('POST /invoices/:id/anular', () => {
    it('no anula una venta aprobada (409): se corrige con rectificativa', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const res = await authed(app, token)
        .post(`/invoices/${id}/anular`)
        .send({ motivo: 'Error de tecleo' })
        .expect(409);
      expect(res.body.message).toMatch(/rectificativa/);
      const dto = await authed(app, token).get(`/invoices/${id}`).expect(200);
      expect(dto.body.status).toBe('aprobada');
    });

    it('una compra aprobada exige motivo (400) y con motivo se anula, liberando el albarán', async () => {
      const { token, project, proveedor } = await entorno();
      const { invoiceId, noteId } = await compraAprobada(
        token,
        proveedor.id,
        project.id,
      );
      await authed(app, token)
        .post(`/invoices/${invoiceId}/anular`)
        .expect(400);
      const res = await authed(app, token)
        .post(`/invoices/${invoiceId}/anular`)
        .send({ motivo: 'Factura duplicada del proveedor' })
        .expect(201);
      expect(res.body.status).toBe('anulada');
      expect(res.body.cancelReason).toBe('Factura duplicada del proveedor');
      const note = await albaran(token, noteId);
      expect(note.body.status).toBe('validado');
      expect(note.body.invoiceId).toBeNull();
    });

    it('un borrador se anula sin motivo', async () => {
      const { token, project, cliente } = await entorno();
      const res = await authed(app, token)
        .post('/invoices')
        .send({
          kind: 'venta',
          contactId: cliente.id,
          invoiceNumber: `F-${unico()}`,
          issueDate: '2026-09-14',
          lines: [
            {
              description: 'x',
              baseAmount: 10,
              vatPct: 21,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      const anulada = await authed(app, token)
        .post(`/invoices/${res.body.id}/anular`)
        .expect(201);
      expect(anulada.body.status).toBe('anulada');
    });

    it('una compra con un vencimiento pagado no se anula (409)', async () => {
      const { token, project, proveedor } = await entorno();
      const { invoiceId } = await compraAprobada(
        token,
        proveedor.id,
        project.id,
      );
      const ms = await authed(app, token)
        .get('/treasury/milestones')
        .expect(200);
      await authed(app, token)
        .post(`/treasury/milestones/${ms.body[0].id}/pagar`)
        .expect(204);
      await authed(app, token)
        .post(`/invoices/${invoiceId}/anular`)
        .send({ motivo: 'Intento tras pagar' })
        .expect(409);
    });
  });

  describe('POST /invoices/:id/rectificar', () => {
    it('total: crea la rectificativa en borrador con serie automática y líneas invertidas', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const res = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Cliente equivocado en la factura',
        })
        .expect(201);
      expect(res.body.status).toBe('borrador');
      expect(res.body.invoiceNumber).toBe('R-2026-0001');
      expect(res.body.rectifiesInvoiceId).toBe(id);
      expect(res.body.rectificationKind).toBe('total');
      expect(res.body.baseAmount).toBe(-1000);
      expect(res.body.totalAmount).toBe(-1210);
      expect(res.body.retentionAmount).toBe(-50);
      expect(res.body.lines[0].baseAmount).toBe(-1000);

      // La original no cambia hasta aprobar la rectificativa.
      const orig = await authed(app, token).get(`/invoices/${id}`).expect(200);
      expect(orig.body.status).toBe('aprobada');
      expect(orig.body.rectifiedByInvoiceIds).toEqual([res.body.id]);

      // Segunda rectificativa total sobre la misma original: 409.
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Otra vez la misma',
        })
        .expect(409);
    });

    it('total: al aprobar, la original pasa a rectificada y se eliminan sus vencimientos previstos', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const before = await authed(app, token)
        .get('/treasury/milestones')
        .expect(200);
      expect(before.body).toHaveLength(2); // ordinario + retención

      const rect = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Importe mal facturado',
        })
        .expect(201);
      const aprobada = await authed(app, token)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(201);
      // Sin cobros previos: nada que devolver, la rectificativa nace liquidada.
      expect(aprobada.body.status).toBe('pagada');

      const orig = await authed(app, token).get(`/invoices/${id}`).expect(200);
      expect(orig.body.status).toBe('rectificada');
      const after = await authed(app, token)
        .get('/treasury/milestones')
        .expect(200);
      expect(after.body).toHaveLength(0);

      // Una factura rectificada ya no se rectifica ni se anula.
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-02',
          motivo: 'Ya estaba rectificada',
        })
        .expect(409);
      await authed(app, token)
        .post(`/invoices/${id}/anular`)
        .send({ motivo: 'Intento de anular' })
        .expect(409);
    });

    it('total de una factura ya cobrada: genera el vencimiento de devolución en dirección inversa', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const ms = await authed(app, token)
        .get('/treasury/milestones')
        .expect(200);
      const ordinario = ms.body.find(
        (m: { kind: string }) => m.kind === 'ordinario',
      );
      await authed(app, token)
        .post(`/treasury/milestones/${ordinario.id}/pagar`)
        .expect(204);

      const rect = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Devolución tras cobro',
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(201);

      const all = await authed(app, token)
        .get('/treasury/milestones')
        .expect(200);
      const devolucion = all.body.filter(
        (m: { invoiceId: string }) => m.invoiceId === rect.body.id,
      );
      expect(devolucion).toHaveLength(1);
      expect(devolucion[0]).toMatchObject({
        direction: 'pago',
        status: 'previsto',
      });
      expect(Number(devolucion[0].amount)).toBeCloseTo(1160, 2); // 1210 - 50
      // El retenido previsto de la original desaparece; el cobrado se conserva.
      const deLaOriginal = all.body.filter(
        (m: { invoiceId: string }) => m.invoiceId === id,
      );
      expect(
        deLaOriginal.every((m: { status: string }) => m.status === 'pagado'),
      ).toBe(true);
    });

    it('total de una compra: el albarán vuelve a validado y sin factura', async () => {
      const { token, project, proveedor } = await entorno();
      const { invoiceId, noteId } = await compraAprobada(
        token,
        proveedor.id,
        project.id,
      );
      const rect = await authed(app, token)
        .post(`/invoices/${invoiceId}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'El proveedor se equivocó',
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(201);
      const note = await albaran(token, noteId);
      expect(note.body.status).toBe('validado');
      expect(note.body.invoiceId).toBeNull();
    });

    it('por diferencias: exige líneas (400) y no cambia la original al aprobar', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'diferencias',
          rectificationMotive: 'R4',
          rectificationType: 'I',
          issueDate: '2026-10-01',
          motivo: 'Descuento pactado',
        })
        .expect(400);
      const rect = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'diferencias',
          rectificationMotive: 'R4',
          rectificationType: 'I',
          issueDate: '2026-10-01',
          motivo: 'Descuento pactado',
          lines: [
            {
              description: 'Descuento',
              baseAmount: -100,
              vatPct: 21,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      expect(rect.body.rectificationKind).toBe('diferencias');
      expect(rect.body.baseAmount).toBe(-100);
      expect(rect.body.totalAmount).toBe(-121);
      expect(rect.body.retentionAmount).toBe(-5);

      const aprobada = await authed(app, token)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(201);
      expect(aprobada.body.status).toBe('aprobada');
      const orig = await authed(app, token).get(`/invoices/${id}`).expect(200);
      expect(orig.body.status).toBe('aprobada');

      const ms = await authed(app, token)
        .get('/treasury/milestones')
        .expect(200);
      const delta = ms.body.filter(
        (m: { invoiceId: string }) => m.invoiceId === rect.body.id,
      );
      expect(delta.map((m: { kind: string }) => m.kind).sort()).toEqual([
        'ordinario',
        'retencion',
      ]);
      expect(
        delta.every((m: { direction: string }) => m.direction === 'pago'),
      ).toBe(true);
      expect(delta.every((m: { amount: string }) => Number(m.amount) > 0)).toBe(
        true,
      );
    });

    it('rechaza rectificar un borrador (409) y la numeración de la serie es correlativa', async () => {
      const { token, project, cliente } = await entorno();
      const borrador = await authed(app, token)
        .post('/invoices')
        .send({
          kind: 'venta',
          contactId: cliente.id,
          invoiceNumber: `F-${unico()}`,
          issueDate: '2026-09-14',
          lines: [
            {
              description: 'x',
              baseAmount: 10,
              vatPct: 21,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${borrador.body.id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Es un borrador',
        })
        .expect(409);

      const a = await ventaAprobada(token, cliente.id, project.id);
      const b = await ventaAprobada(token, cliente.id, project.id);
      const ra = await authed(app, token)
        .post(`/invoices/${a}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Primera',
        })
        .expect(201);
      const rb = await authed(app, token)
        .post(`/invoices/${b}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Segunda',
        })
        .expect(201);
      expect(ra.body.invoiceNumber).toBe('R-2026-0001');
      expect(rb.body.invoiceNumber).toBe('R-2026-0002');
    });

    it('GET /invoices?rectificativas=true lista solo las rectificativas y status=rectificada filtra', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const rect = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Listado',
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(201);
      const soloRect = await authed(app, token)
        .get('/invoices?rectificativas=true')
        .expect(200);
      expect(soloRect.body.map((i: { id: string }) => i.id)).toEqual([
        rect.body.id,
      ]);
      const rectificadas = await authed(app, token)
        .get('/invoices?status=rectificada')
        .expect(200);
      expect(rectificadas.body.map((i: { id: string }) => i.id)).toEqual([id]);
    });

    it('Facturae y VeriFactu de una rectificativa devuelven 409', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const rect = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'diferencias',
          rectificationMotive: 'R4',
          rectificationType: 'I',
          issueDate: '2026-10-01',
          motivo: 'Ajuste de precio',
          lines: [
            {
              description: 'Ajuste',
              baseAmount: -10,
              vatPct: 21,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      await authed(app, token)
        .post(`/invoices/${rect.body.id}/aprobar`)
        .expect(201);
      await authed(app, token)
        .get(`/invoices/${rect.body.id}/facturae`)
        .expect(409);
      await authed(app, token)
        .post(`/invoices/${rect.body.id}/verifactu/enviar`)
        .expect(409);
    });

    it('motivo y tipo oficiales: obligatorios, se devuelven en el DTO y no abren Facturae/VeriFactu', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const base = {
        clase: 'total',
        issueDate: '2026-10-01',
        motivo: 'Cliente equivocado en la factura',
      };
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({ ...base, rectificationType: 'S' })
        .expect(400);
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({ ...base, rectificationMotive: 'R1' })
        .expect(400);
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({ ...base, rectificationMotive: 'R9', rectificationType: 'S' })
        .expect(400);
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({ ...base, rectificationMotive: 'R1', rectificationType: 'I' })
        .expect(400);
      // Diferencias con tipo S (aunque lleve líneas) también es incoherente.
      await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({
          ...base,
          clase: 'diferencias',
          rectificationMotive: 'R1',
          rectificationType: 'S',
          lines: [{ description: 'Ajuste', baseAmount: -10, vatPct: 21 }],
        })
        .expect(400);
      const res = await authed(app, token)
        .post(`/invoices/${id}/rectificar`)
        .send({ ...base, rectificationMotive: 'R1', rectificationType: 'S' })
        .expect(201);
      expect(res.body.rectificationMotive).toBe('R1');
      expect(res.body.rectificationType).toBe('S');
      expect(res.body.rectificationKind).toBe('total');
      const leida = await authed(app, token)
        .get(`/invoices/${res.body.id}`)
        .expect(200);
      expect(leida.body.rectificationMotive).toBe('R1');
      expect(leida.body.rectificationType).toBe('S');
      const orig = await authed(app, token).get(`/invoices/${id}`).expect(200);
      expect(orig.body.rectificationMotive).toBeNull();
      expect(orig.body.rectificationType).toBeNull();

      await authed(app, token)
        .post(`/invoices/${res.body.id}/aprobar`)
        .expect(201);
      await authed(app, token)
        .get(`/invoices/${res.body.id}/facturae`)
        .expect(409);
      await authed(app, token)
        .post(`/invoices/${res.body.id}/verifactu/enviar`)
        .expect(409);
    });

    it('motivo o tipo en una factura que no es rectificativa: 400', async () => {
      const { token, project, cliente } = await entorno();
      const cuerpo = (numero: string, extra: Record<string, string>) => ({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: numero,
        issueDate: '2026-10-01',
        lines: [
          {
            description: 'Obra',
            baseAmount: 100,
            vatPct: 21,
            projectId: project.id,
          },
        ],
        ...extra,
      });
      await authed(app, token)
        .post('/invoices')
        .send(cuerpo('F-NO-RECT-1', { rectificationMotive: 'R1' }))
        .expect(400);
      await authed(app, token)
        .post('/invoices')
        .send(cuerpo('F-NO-RECT-2', { rectificationType: 'S' }))
        .expect(400);
      const ok = await authed(app, token)
        .post('/invoices')
        .send(cuerpo('F-NO-RECT-3', {}))
        .expect(201);
      expect(ok.body.rectificationMotive).toBeNull();
      expect(ok.body.rectificationType).toBeNull();
      await authed(app, token)
        .patch(`/invoices/${ok.body.id}`)
        .send({ rectificationMotive: 'R1' })
        .expect(400);
    });

    it('RBAC: el rol obra no puede rectificar (403)', async () => {
      const { token, project, cliente } = await entorno();
      const id = await ventaAprobada(token, cliente.id, project.id);
      const obra = await createObraUser(app, token, [project.id as string]);
      await authed(app, obra.tokens.accessToken)
        .post(`/invoices/${id}/rectificar`)
        .send({
          clase: 'total',
          rectificationMotive: 'R4',
          rectificationType: 'S',
          issueDate: '2026-10-01',
          motivo: 'Sin permiso',
        })
        .expect(403);
    });
  });
});
