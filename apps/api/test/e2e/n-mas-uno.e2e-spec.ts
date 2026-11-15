import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, setQueryObserver, users } from '@erp/db';
import { CostControlService } from '../../src/cost-control/cost-control.service';
import { PurchaseOrdersService } from '../../src/purchase-orders/purchase-orders.service';
import { runWithRequestContext } from '../../src/common/request-context';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createContact,
  createPhase,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * Bloque 2 de la Fase 2: los listados y exportaciones no hacen una consulta
 * por fila. Se cuenta el número de consultas (`setQueryObserver` cuenta cada
 * `pool.query`) con pocas filas y con muchas: lo que se afirma es que la
 * DIFERENCIA es cero (el valor absoluto incluye guards y comprobaciones de
 * acceso, que no son lo que se mide).
 *
 * Solo se ven las consultas del pool; las de una transacción de Drizzle van
 * por el cliente de la transacción y no pasan por el observador. Por eso el
 * caso de `bloquearPedidos` se mide con el `Db` normal.
 */
describe('N+1 (integración) — las consultas no crecen con el número de filas', () => {
  let app: INestApplication;
  let consultas = 0;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    setQueryObserver(undefined);
    await app.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  async function contar(accion: () => Promise<unknown>): Promise<number> {
    consultas = 0;
    setQueryObserver(() => {
      consultas += 1;
    });
    try {
      await accion();
    } finally {
      setQueryObserver(undefined);
    }
    return consultas;
  }

  it('GET /change-orders: mismas consultas con 2 que con 20 contradictorios', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const client = authed(app, token);
    const project = await createProject(app, token);
    const phase = await createPhase(app, token, project.id);
    const df = await createContact(app, token, { kind: 'cliente' });

    const crear = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await client
          .post('/change-orders')
          .send({
            projectId: project.id,
            phaseId: phase.id,
            direccionFacultativaContactId: df.id,
            titulo: `Contradictorio ${i}`,
            descripcion: 'Descripción',
            lineas: [
              {
                descripcion: 'Línea',
                unidad: 'ud',
                cantidad: 2,
                precioUnitario: 10,
              },
            ],
          })
          .expect(201);
      }
    };

    await crear(2);
    const pocas = await contar(async () => {
      const res = await client.get('/change-orders').expect(200);
      expect(res.body).toHaveLength(2);
    });
    await crear(18);
    const muchas = await contar(async () => {
      const res = await client.get('/change-orders').expect(200);
      expect(res.body).toHaveLength(20);
      // Mismo contenido hidratado en todas las filas.
      for (const co of res.body as {
        phaseCode: unknown;
        direccionFacultativaNombre: unknown;
        lineas: unknown[];
      }[]) {
        expect(co.lineas).toHaveLength(1);
        expect(co.phaseCode).toBeTruthy();
        expect(co.direccionFacultativaNombre).toBeTruthy();
      }
    });
    expect({ pocas, muchas, diferencia: muchas - pocas }).toEqual({
      pocas,
      muchas: pocas,
      diferencia: 0,
    });
  });

  it('GET /exports/economia-resumen: mismas consultas con 2 que con 20 obras', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const client = authed(app, token);

    const crearObras = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const project = await createProject(app, token);
        const phase = await createPhase(app, token, project.id);
        const budget = await createBudget(app, token, project.id);
        await addBudgetItem(app, token, budget.id, {
          phaseId: phase.id,
          unitPrice: 100,
          quantity: 10,
        });
        await activateBudget(app, token, budget.id);
      }
    };

    await crearObras(2);
    const pocas = await contar(async () => {
      const res = await client
        .get('/exports/economia-resumen?format=json')
        .expect(200);
      expect(JSON.stringify(res.body).length).toBeGreaterThan(0);
    });
    await crearObras(18);
    let filas = 0;
    const muchas = await contar(async () => {
      const res = await client
        .get('/exports/economia-resumen?format=json')
        .expect(200);
      filas = (res.body as unknown[]).length;
    });
    expect(filas).toBe(20);
    expect({ pocas, muchas, diferencia: muchas - pocas }).toEqual({
      pocas,
      muchas: pocas,
      diferencia: 0,
    });
  });

  it('bloquearPedidos: una sola consulta con 2 que con 20 pedidos', async () => {
    const admin = await registerUser(app);
    expect(admin.accessToken).toBeTruthy();
    const servicio = app.get(PurchaseOrdersService);
    const db = getDb();
    const ids = (n: number) =>
      Array.from({ length: n }, () => crypto.randomUUID());
    const pocas = await contar(() => servicio.bloquearPedidos(db, ids(2)));
    const muchas = await contar(() => servicio.bloquearPedidos(db, ids(20)));
    expect({ pocas, muchas, diferencia: muchas - pocas }).toEqual({
      pocas,
      muchas: pocas,
      diferencia: 0,
    });
  });
});

/**
 * Los importes salen de la misma aritmética (`@erp/shared/calculo`); aquí se
 * comprueba que cargar los datos por lotes no mezcla obras: `getEconomics(id)`
 * y la entrada de `getEconomicsMany` con VARIAS obras (una factura repartida
 * entre dos de ellas) dan exactamente el mismo resultado.
 */
describe('getEconomicsMany (integración) — equivale a getEconomics obra a obra', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  const unico = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  it('el lote de varias obras (con factura compartida) coincide con cada obra por separado', async () => {
    const admin = await registerUser(app);
    const token = admin.accessToken;
    const client = authed(app, token);
    const cliente = await createContact(app, token, { kind: 'cliente' });
    const proveedor = await createContact(app, token, { kind: 'proveedor' });

    const obras: { id: string; phaseId: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const project = await createProject(app, token);
      const phase = await createPhase(app, token, project.id);
      const budget = await createBudget(app, token, project.id);
      await addBudgetItem(app, token, budget.id, {
        phaseId: phase.id,
        unitPrice: 1000 + i * 100,
        quantity: 10,
      });
      await activateBudget(app, token, budget.id);
      obras.push({ id: project.id, phaseId: phase.id });
    }
    const [a, b, c] = obras;

    // Compras con y sin partida; una de ellas repartida entre a y b.
    await client
      .post('/invoices')
      .send({
        kind: 'compra',
        contactId: proveedor.id,
        invoiceNumber: `FC-${unico()}`,
        issueDate: '2026-09-14',
        lines: [
          {
            description: 'Material A',
            baseAmount: 1500,
            vatPct: 21,
            projectId: a.id,
            phaseId: a.phaseId,
          },
          {
            description: 'Material B',
            baseAmount: 700,
            vatPct: 10,
            projectId: b.id,
          },
        ],
      })
      .expect(201);

    // Venta aprobada repartida entre a y c, con retención.
    const venta = await client
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId: cliente.id,
        invoiceNumber: `FV-${unico()}`,
        issueDate: '2026-09-14',
        dueDate: '2026-10-14',
        retentionPct: 5,
        lines: [
          {
            description: 'Certificación A',
            baseAmount: 3000,
            vatPct: 21,
            projectId: a.id,
          },
          {
            description: 'Certificación C',
            baseAmount: 1000,
            vatPct: 21,
            projectId: c.id,
          },
        ],
      })
      .expect(201);
    await client.post(`/invoices/${venta.body.id}/aprobar`).expect(201);

    await client
      .post('/certifications')
      .send({ projectId: a.id, certDate: '2026-09-14', cumulativePct: 20 })
      .expect(201);

    const db = getDb();
    const [usuario] = await db
      .select()
      .from(users)
      .where(eq(users.email, admin.user.email))
      .limit(1);
    const servicio = app.get(CostControlService);
    const comoAdmin = <T>(fn: () => Promise<T>) =>
      new Promise<T>((resolve, reject) =>
        runWithRequestContext(
          {
            userId: usuario.id,
            companyId: usuario.companyId,
            role: 'admin',
          },
          () => fn().then(resolve, reject),
        ),
      );

    const ids = obras.map((o) => o.id);
    const lote = await comoAdmin(() => servicio.getEconomicsMany(ids));
    expect([...lote.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const suelta = await comoAdmin(() => servicio.getEconomics(id));
      const [porLote] = await comoAdmin(() =>
        servicio.getEconomicsMany([id]).then((m) => [m.get(id)]),
      );
      // `generadoEn` es la hora de generación: lo único que puede variar.
      const sinHora = <T extends { generadoEn: string }>(e: T | undefined) => ({
        ...e,
        generadoEn: undefined,
      });
      expect(sinHora(porLote)).toEqual(sinHora(suelta));
      expect(sinHora(lote.get(id))).toEqual(sinHora(suelta));
    }
    // Sanidad: los datos sembrados llegan a las cifras.
    expect(lote.get(a.id)!.margen.facturadoVenta).toBe(3000);
    expect(lote.get(c.id)!.margen.facturadoVenta).toBe(1000);
    expect(lote.get(b.id)!.margen.costeReal).toBe(700);
  });
});
