import { INestApplication } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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
 * Escritura única de estado (`common/cambiar-estado.ts`): reglas de la
 * máquina de estados y carreras entre peticiones concurrentes (Postgres real).
 */
describe('Estado único (integración) — máquina de estados y carreras', () => {
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

  const sufijo = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  async function pedido(token: string, projectId: string, contactId: string) {
    const res = await authed(app, token)
      .post('/purchase-orders')
      .send({
        projectId,
        contactId,
        orderDate: '2026-09-14',
        description: 'Suministro de pruebas',
        amount: 500,
      })
      .expect(201);
    return res.body.id as string;
  }

  async function compraAprobada(
    token: string,
    projectId: string,
    contactId: string,
  ): Promise<string> {
    const orderId = await pedido(token, projectId, contactId);
    const note = await authed(app, token)
      .post('/delivery-notes')
      .send({
        contactId,
        orderId,
        noteNumber: `ALB-${sufijo()}`,
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
        invoiceNumber: `FC-${sufijo()}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        deliveryNoteIds: [note.body.id],
        lines: [
          { description: 'Materiales', baseAmount: 500, vatPct: 21, projectId },
        ],
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${inv.body.id}/aprobar`)
      .expect(201);
    return inv.body.id as string;
  }

  it('un pedido cerrado no se puede anular (409) y cerrar dos veces da 409', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const prov = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      legalName: 'Proveedor SL',
    });
    const id = await pedido(admin.accessToken, project.id, prov.id);

    await authed(app, admin.accessToken)
      .post(`/purchase-orders/${id}/cerrar`)
      .expect(201);
    await authed(app, admin.accessToken)
      .post(`/purchase-orders/${id}/anular`)
      .expect(409);
    await authed(app, admin.accessToken)
      .post(`/purchase-orders/${id}/cerrar`)
      .expect(409);

    const res = await authed(app, admin.accessToken)
      .get(`/purchase-orders/${id}`)
      .expect(200);
    expect(res.body.status).toBe('cerrado');
  });

  it('cerrar y anular a la vez: exactamente una respuesta 2xx', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const prov = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      legalName: 'Proveedor SL',
    });
    const id = await pedido(admin.accessToken, project.id, prov.id);
    const [a, b] = await Promise.all([
      authed(app, admin.accessToken).post(`/purchase-orders/${id}/cerrar`),
      authed(app, admin.accessToken).post(`/purchase-orders/${id}/anular`),
    ]);
    const ok = [a.status, b.status].filter((s) => s >= 200 && s < 300);
    expect(ok).toHaveLength(1);
  });

  it('pagar y anular una compra aprobada a la vez: nunca pagada con motivo de anulación', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const prov = await createContact(app, admin.accessToken, {
      kind: 'proveedor',
      legalName: 'Proveedor SL',
    });
    for (let i = 0; i < 5; i++) {
      const id = await compraAprobada(admin.accessToken, project.id, prov.id);
      const [pagar, anular] = await Promise.all([
        authed(app, admin.accessToken).post(`/invoices/${id}/pagar`),
        authed(app, admin.accessToken)
          .post(`/invoices/${id}/anular`)
          .send({ motivo: 'Error de proveedor' }),
      ]);
      const ok = [pagar.status, anular.status].filter(
        (s) => s >= 200 && s < 300,
      );
      expect(ok).toHaveLength(1);
      const final = await authed(app, admin.accessToken)
        .get(`/invoices/${id}`)
        .expect(200);
      if (final.body.status === 'pagada') {
        expect(final.body.cancelReason ?? null).toBeNull();
      } else {
        expect(final.body.status).toBe('anulada');
      }
    }
  });

  it('PATCH y aprobar a la vez sobre un borrador: si aprobar gana, el PATCH da 409 y los importes no cambian', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const cliente = await createContact(app, admin.accessToken, {
      kind: 'cliente',
    });
    for (let i = 0; i < 8; i++) {
      const created = await authed(app, admin.accessToken)
        .post('/invoices')
        .send({
          kind: 'venta',
          contactId: cliente.id,
          invoiceNumber: `F-${sufijo()}`,
          issueDate: '2026-09-14',
          dueDate: '2026-10-14',
          lines: [
            {
              description: 'Certificación',
              baseAmount: 1000,
              vatPct: 21,
              projectId: project.id,
            },
          ],
        })
        .expect(201);
      const id = created.body.id as string;
      const [patch, aprobar] = await Promise.all([
        authed(app, admin.accessToken)
          .patch(`/invoices/${id}`)
          .set(
            'If-Match',
            await ifMatchDe(app, admin.accessToken, `/invoices/${id}`),
          )
          .send({
            lines: [
              {
                description: 'Certificación',
                baseAmount: 2000,
                vatPct: 21,
                projectId: project.id,
              },
            ],
          }),
        authed(app, admin.accessToken).post(`/invoices/${id}/aprobar`),
      ]);
      expect(aprobar.status).toBe(201);
      const final = await authed(app, admin.accessToken)
        .get(`/invoices/${id}`)
        .expect(200);
      expect(final.body.status).toBe('aprobada');
      if (patch.status === 409) {
        expect(final.body.baseAmount).toBe(1000);
      } else {
        // El PATCH ganó la carrera: la aprobación ve ya los importes nuevos.
        expect(patch.status).toBe(200);
        expect(final.body.baseAmount).toBe(2000);
      }
      const venc = await authed(app, admin.accessToken)
        .get('/treasury/milestones')
        .expect(200);
      const suma = (venc.body as { invoiceId: string; amount: number }[])
        .filter((m) => m.invoiceId === id)
        .reduce((s, m) => s + m.amount, 0);
      expect(Math.round(suma * 100)).toBe(
        Math.round(final.body.totalAmount * 100),
      );
    }
  });

  it('arquitectura: ningún `status:` dentro de `.set({` fuera de cambiar-estado.ts', () => {
    /**
     * Ficheros que escriben `status` de entidades que TODAVÍA no tienen
     * máquina de estados en @erp/shared (no se inventan estados). Son
     * deuda explícita: al modelar su tabla de transiciones se migran y
     * salen de esta lista. Los documentos del flujo de compra/venta (pedido,
     * albarán, factura, certificación, presupuesto, vencimiento) NO pueden
     * aparecer aquí.
     */
    const SIN_MAQUINA_DE_ESTADOS = [
      'modules/comparativos/comparativos.service.ts', // adjudicación
      'modules/investors/investors.service.ts', // estado de inversor/operación
      'modules/permisos/permisos.service.ts', // estado de permiso
      'modules/proveedores/proveedores.service.ts', // estado de ficha
      'modules/real-estate/real-estate.service.ts', // reserva/venta/cobro de unidades
      'ocr/extraction.service.ts', // estado de extracción OCR
      'ocr/validation.service.ts', // validación/rechazo de extracciones
      'projects/projects.service.ts', // estado de obra
    ];
    const raiz = join(__dirname, '..', '..', 'src');
    const ficheros: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (p.endsWith('.ts')) ficheros.push(p);
      }
    };
    recorrer(raiz);
    const infractores: string[] = [];
    for (const f of ficheros) {
      const rel = relative(raiz, f).split(sep).join('/');
      if (rel === 'common/cambiar-estado.ts') continue;
      if (SIN_MAQUINA_DE_ESTADOS.includes(rel)) continue;
      const src = readFileSync(f, 'utf8');
      const re = /\.set\(\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // Cuerpo del objeto hasta su llave de cierre equilibrada.
        let depth = 1;
        let i = m.index + m[0].length;
        const ini = i;
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          i++;
        }
        const cuerpo = src.slice(ini, i - 1);
        // `status` como clave (`status: x` o `status,`), no como valor.
        if (/(^|[{,])\s*status\s*(:|,|$)/.test(cuerpo)) {
          infractores.push(`${rel}: ${cuerpo.slice(0, 60)}`);
        }
      }
    }
    expect(infractores).toEqual([]);
  });
});
