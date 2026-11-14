import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EXPORT_RECURSOS } from '@erp/shared';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createObraUser,
  createPhase,
  createProject,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/** Fase 3, paso 9: GET /exports/:recurso?format=csv|json. */
describe('Exportaciones (integración) — GET /exports/:recurso', () => {
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

  /** Obra con un dato de cada recurso. Devuelve ids y códigos útiles. */
  async function sembrar(token: string) {
    const project = await createProject(app, token);
    const phase = await createPhase(app, token, project.id);
    const budget = await createBudget(app, token, project.id);
    await addBudgetItem(app, token, budget.id, {
      unitPrice: 100,
      quantity: 10,
      phaseId: phase.id,
    });
    await activateBudget(app, token, budget.id);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const proveedor = await createContact(app, token, { kind: 'proveedor' });

    await authed(app, token)
      .post('/delivery-notes')
      .send({
        contactId: proveedor.id,
        projectId: project.id,
        noteNumber: `ALB-${unico()}`,
        noteDate: '2026-09-14',
        amount: 250,
      })
      .expect(201);

    await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: proveedor.id,
        invoiceNumber: `FC-${unico()}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'Material',
            baseAmount: 400,
            vatPct: 21,
            projectId: project.id,
            phaseId: phase.id,
          },
        ],
      })
      .expect(201);

    const venta = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-${unico()}`,
        issueDate: '2026-09-15',
        dueDate: '2026-10-15',
        retentionPct: 5,
        lines: [
          {
            description: 'Certificación',
            baseAmount: 20.1,
            vatPct: 21,
            projectId: project.id,
          },
        ],
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${venta.body.id}/aprobar`)
      .expect(201);

    await authed(app, token)
      .post('/certifications')
      .send({
        projectId: project.id,
        certDate: '2026-09-14',
        cumulativePct: 10,
      })
      .expect(201);
    await authed(app, token)
      .post('/partes-diarios/personal')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        workerName: '=CMD()',
        workDate: '2026-09-14',
        ordinaryHours: 8,
        overtimeHours: 0,
        ordinaryRate: 20,
        overtimeRate: 0,
      })
      .expect(201);
    await authed(app, token)
      .post('/partes-diarios/maquinaria')
      .send({
        projectId: project.id,
        phaseId: phase.id,
        machineName: 'Grúa',
        workDate: '2026-09-14',
        hoursUsed: 4,
        hourlyRate: 50,
      })
      .expect(201);
    return { project, phase };
  }

  /** Query mínima válida para cada recurso (algunos exigen filtros). */
  function url(recurso: string, projectId: string, extra = ''): string {
    const base = `/exports/${recurso}?`;
    if (
      recurso === 'presupuesto-partidas' ||
      recurso === 'economia-desviaciones'
    )
      return `${base}projectId=${projectId}${extra}`;
    if (recurso === 'economia-iva')
      return `${base}from=2026-01-01&to=2026-12-31${extra}`;
    return `${base}${extra.replace(/^&/, '')}`;
  }

  describe('un test por recurso (admin)', () => {
    for (const recurso of EXPORT_RECURSOS) {
      it(`${recurso}: CSV con BOM, cabecera y Content-Disposition; JSON como array`, async () => {
        const admin = await registerUser(app);
        const { project } = await sembrar(admin.accessToken);

        const csv = await authed(app, admin.accessToken)
          .get(url(recurso, project.id))
          .buffer(true)
          .parse((res, cb) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c: string) => (data += c));
            res.on('end', () => cb(null, data));
          })
          .expect(200);
        expect(csv.headers['content-type']).toMatch(/text\/csv; charset=utf-8/);
        expect(csv.headers['content-disposition']).toMatch(
          new RegExp(`attachment; filename="${recurso}-\\d{8}\\.csv"`),
        );
        const texto = csv.body as unknown as string;
        expect(texto.startsWith('﻿')).toBe(true);
        const lineas = texto.slice(1).split('\r\n');
        expect(lineas[0]).toContain(';');
        expect(lineas.length).toBeGreaterThan(2); // cabecera + >=1 fila + salto final

        const json = await authed(app, admin.accessToken)
          .get(url(recurso, project.id, '&format=json'))
          .expect(200);
        expect(Array.isArray(json.body)).toBe(true);
        expect(json.body.length).toBe(lineas.length - 2);
      });
    }
  });

  it('facturas: importes con 2 decimales exactos, rectificativas con signo y filtros', async () => {
    const admin = await registerUser(app);
    const { project } = await sembrar(admin.accessToken);
    const res = await authed(app, admin.accessToken)
      .get(`/exports/facturas?format=json&kind=venta&projectId=${project.id}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    const f = res.body[0];
    expect(f.baseAmount).toBe(20.1);
    expect(f.retentionAmount).toBe(1.01);
    expect(f.status).toBe('aprobada');
    expect(f.payableAmount).toBe(applyCents(20.1 + 4.22, 1.01));

    const vacio = await authed(app, admin.accessToken)
      .get('/exports/facturas?format=json&status=pagada')
      .expect(200);
    expect(vacio.body).toEqual([]);
    await authed(app, admin.accessToken)
      .get('/exports/facturas?status=inventado')
      .expect(400);
  });

  it('neutraliza fórmulas en texto del CSV y respeta sep/decimal', async () => {
    const admin = await registerUser(app);
    await sembrar(admin.accessToken);
    const res = await authed(app, admin.accessToken)
      .get('/exports/partes-personal?sep=,&decimal=coma')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      })
      .expect(200);
    const texto = res.body as unknown as string;
    expect(texto).toContain("'=CMD()");
    expect(texto).toContain('"160,00"'); // 8 h x 20 €, coma decimal y separador coma
  });

  it('economia-iva por obra reparte la cuota de una factura compartida y suma 42,03', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const obraA = await createProject(app, token);
    const obraB = await createProject(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-${Date.now()}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        lines: [obraA.id, obraB.id].map((projectId) => ({
          description: 'Certificación',
          baseAmount: 100.07,
          vatPct: 21,
          projectId,
        })),
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${res.body.id}/aprobar`)
      .expect(201);

    const cuota = async (projectId: string) => {
      const r = await authed(app, token)
        .get(
          `/exports/economia-iva?format=json&from=2026-01-01&to=2026-12-31&projectId=${projectId}`,
        )
        .expect(200);
      const fila = r.body.find(
        (f: { lado: string }) => f.lado === 'repercutido',
      );
      expect(fila.baseAmount).toBe(100.07);
      return Math.round(fila.vatAmount * 100);
    };
    const [menor, mayor] = [obraA.id, obraB.id].sort();
    expect(await cuota(menor)).toBe(2102);
    expect(await cuota(mayor)).toBe(2101);
    expect((await cuota(menor)) + (await cuota(mayor))).toBe(4203);
  });

  it('economia-iva con periodo trimestral equivale a su from/to; inválido o incoherente da 400', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-T-${Date.now()}`,
        issueDate: '2026-02-10',
        dueDate: '2026-03-10',
        lines: [{ description: 'Obra', baseAmount: 200, vatPct: 21 }],
      })
      .expect(201);
    await authed(app, token)
      .post(`/invoices/${res.body.id}/aprobar`)
      .expect(201);

    const porPeriodo = await authed(app, token)
      .get('/exports/economia-iva?format=json&periodo=2026-T1')
      .expect(200);
    const porRango = await authed(app, token)
      .get('/exports/economia-iva?format=json&from=2026-01-01&to=2026-03-31')
      .expect(200);
    expect(porPeriodo.body).toEqual(porRango.body);
    const rep = porPeriodo.body.find(
      (f: { lado: string }) => f.lado === 'repercutido',
    );
    expect(rep.periodo).toBe('2026-T1');
    expect(rep.baseAmount).toBe(200);

    await authed(app, token)
      .get('/exports/economia-iva?periodo=2026-T5')
      .expect(400);
    await authed(app, token)
      .get('/exports/economia-iva?periodo=2026T1')
      .expect(400);
    await authed(app, token)
      .get('/exports/economia-iva?periodo=2026-T1&from=2026-02-01')
      .expect(400);
    await authed(app, token)
      .get(
        '/exports/economia-iva?periodo=2026-T1&from=2026-01-01&to=2026-03-31',
      )
      .expect(200);
  });

  it('parámetros obligatorios y recurso desconocido', async () => {
    const admin = await registerUser(app);
    await authed(app, admin.accessToken)
      .get('/exports/presupuesto-partidas')
      .expect(400);
    await authed(app, admin.accessToken)
      .get('/exports/economia-iva')
      .expect(400);
    await authed(app, admin.accessToken).get('/exports/nada').expect(404);
    await authed(app, admin.accessToken)
      .get('/exports/obras?format=xml')
      .expect(400);
  });

  it('deja traza en auditoría con acción export', async () => {
    const admin = await registerUser(app);
    await sembrar(admin.accessToken);
    await authed(app, admin.accessToken).get('/exports/obras').expect(200);
    await new Promise((r) => setTimeout(r, 300));
    const res = await authed(app, admin.accessToken)
      .get('/audit?action=export')
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].meta.recurso).toBe('obras');
  });

  describe('RBAC', () => {
    it('sin token: 401', async () => {
      await request(app.getHttpServer()).get('/exports/obras').expect(401);
    });

    it('lector: 200 en todos los recursos, incluidos los resúmenes de empresa', async () => {
      const admin = await registerUser(app);
      const { project } = await sembrar(admin.accessToken);
      const lector = await createUserWithRole(app, admin.accessToken, 'lector');
      for (const recurso of EXPORT_RECURSOS) {
        await authed(app, lector.accessToken)
          .get(url(recurso, project.id, '&format=json'))
          .expect(200);
      }
    });

    it('obra: ve solo sus obras, 404 con projectId ajeno y 403 en los resúmenes de empresa', async () => {
      const admin = await registerUser(app);
      const propia = await sembrar(admin.accessToken);
      const ajena = await sembrar(admin.accessToken);
      const obra = await createObraUser(app, admin.accessToken, [
        propia.project.id,
      ]);
      const t = obra.tokens.accessToken;

      const obras = await authed(app, t)
        .get('/exports/obras?format=json')
        .expect(200);
      expect(obras.body).toHaveLength(1);
      expect(obras.body[0].code).toBe(propia.project.code);

      for (const recurso of [
        'albaranes',
        'facturas',
        'facturas-lineas',
        'certificaciones',
        'partes-personal',
        'partes-maquinaria',
        'vencimientos',
      ]) {
        const res = await authed(app, t)
          .get(`/exports/${recurso}?format=json`)
          .expect(200);
        // Una sola obra visible: la mitad de lo sembrado (las compras no
        // tienen vencimientos, así que solo se exige no ver la obra ajena).
        const codigos = JSON.stringify(res.body);
        expect(codigos).not.toContain(ajena.project.code);
        if (recurso !== 'vencimientos') {
          expect(res.body.length).toBeGreaterThan(0);
        }
      }

      await authed(app, t)
        .get(`/exports/facturas?projectId=${ajena.project.id}`)
        .expect(404);
      await authed(app, t)
        .get(`/exports/economia-desviaciones?projectId=${ajena.project.id}`)
        .expect(404);
      await authed(app, t)
        .get(`/exports/economia-desviaciones?projectId=${propia.project.id}`)
        .expect(200);

      await authed(app, t).get('/exports/economia-resumen').expect(403);
      await authed(app, t)
        .get('/exports/economia-iva?from=2026-01-01&to=2026-12-31')
        .expect(403);
    });

    it('subcontrata y cliente de portal: 403', async () => {
      const admin = await registerUser(app);
      const cliente = await createUserWithRole(
        app,
        admin.accessToken,
        'cliente',
      );
      await authed(app, cliente.accessToken).get('/exports/obras').expect(403);
      await authed(app, cliente.accessToken)
        .get('/exports/economia-resumen')
        .expect(403);
    });
  });
});

/** total − retención en céntimos exactos (evita errores de coma flotante en el test). */
function applyCents(total: number, retention: number): number {
  return Math.round(total * 100 - retention * 100) / 100;
}
