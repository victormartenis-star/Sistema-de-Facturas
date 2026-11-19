import { HttpException, INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { auditChainHeads, auditLog, getDb, projects } from '@erp/db';
import { AuditService } from '../../src/audit/audit.service';
import {
  authed,
  createProject,
  createTestApp,
  ifMatch,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import {
  AUDIT_GENESIS_HASH,
  cadenaDe,
  conClientePg,
  crearEmpresa,
  limpiarEmpresasExtra,
  entrada,
  hashRecalculado,
  registrarEn,
} from './audit-test-utils';

describe('Auditoría (integración) — cadena hash por empresa', () => {
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
    await limpiarEmpresasExtra(companyId);
  });

  async function verificar(token: string) {
    const res = await authed(app, token)
      .get('/audit/verify-integrity')
      .expect(200);
    return res.body as {
      integra: boolean;
      entradasVerificadas: number;
      primerPuntoRoto: unknown;
    };
  }

  it('1. la primera entrada de una empresa es la 1, con previous_hash génesis y hash_version 1', async () => {
    await registrarEn(app, companyId, entrada());
    const [fila] = await cadenaDe(companyId);
    expect(fila.sequenceNumber).toBe(1);
    expect(fila.previousHash).toBe(AUDIT_GENESIS_HASH);
    expect(fila.hashVersion).toBe(1);
    expect(fila.entryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. N entradas consecutivas: secuencia 1..N sin huecos y previous_hash[n] = entry_hash[n-1]', async () => {
    for (let i = 0; i < 6; i++) await registrarEn(app, companyId, entrada());
    const filas = await cadenaDe(companyId);
    expect(filas.map((f) => f.sequenceNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < filas.length; i++) {
      expect(filas[i].previousHash).toBe(filas[i - 1].entryHash);
    }
  });

  it('3. dos empresas: cadenas independientes, ambas empiezan en 1', async () => {
    const otra = await crearEmpresa('Otra SL');
    await registrarEn(app, companyId, [entrada(), entrada()]);
    await registrarEn(app, otra, entrada());
    expect((await cadenaDe(companyId)).map((f) => f.sequenceNumber)).toEqual([
      1, 2,
    ]);
    const [primeraOtra] = await cadenaDe(otra);
    expect(primeraOtra.sequenceNumber).toBe(1);
    expect(primeraOtra.previousHash).toBe(AUDIT_GENESIS_HASH);
  });

  it('4. el hash almacenado coincide con el recalculado desde la fila leída (round-trip jsonb)', async () => {
    await registrarEn(app, companyId, [
      entrada({ newData: { a: 1, b: [1, 2, { c: null }] }, meta: { ip: 'x' } }),
      entrada({ action: 'update', oldData: { a: 1 }, newData: { a: 2 } }),
    ]);
    for (const fila of await cadenaDe(companyId)) {
      expect(hashRecalculado(fila)).toBe(fila.entryHash);
    }
  });

  it('5. payloads con claves en otro orden, anidados, arrays, null, fechas, decimales, exponentes, Unicode y emoji hacen round-trip correcto', async () => {
    const raro = {
      z: { y: [3, 2, 1], x: null },
      a: 'Ñandú — 日本語 🚀',
      fecha: new Date('2026-01-02T03:04:05.006Z'),
      decimal: 0.1 + 0.2,
      grande: 1e21,
      pequeno: 1e-7,
      negativo: -1.5e-10,
      vacio: {},
      lista: [],
      anidado: [{ b: 1, a: 2 }, [1, [2, [3]]]],
      texto: 'comillas " y barra \\ y salto\nlinea',
    };
    await registrarEn(app, companyId, entrada({ newData: raro }));
    const [fila] = await cadenaDe(companyId);
    expect(hashRecalculado(fila)).toBe(fila.entryHash);
    const guardado = fila.newData as Record<string, unknown>;
    expect(guardado.grande).toBe(1e21);
    expect(guardado.pequeno).toBe(1e-7);
    expect(guardado.a).toBe('Ñandú — 日本語 🚀');
    expect(guardado.fecha).toBe('2026-01-02T03:04:05.006Z');
  });

  it('6. oldData/newData/meta ausentes se guardan como null y el hash sigue siendo reproducible', async () => {
    await registrarEn(app, companyId, {
      entityType: 'project',
      entityId: '11111111-1111-4111-8111-111111111111',
      action: 'delete',
    });
    const [fila] = await cadenaDe(companyId);
    expect(fila.oldData).toBeNull();
    expect(fila.newData).toBeNull();
    expect(fila.meta).toBeNull();
    expect(hashRecalculado(fila)).toBe(fila.entryHash);
  });

  it('7. occurred_at se guarda con milisegundos exactos y el ISO del hash coincide', async () => {
    await registrarEn(app, companyId, entrada());
    const [fila] = await cadenaDe(companyId);
    expect(fila.occurredAt.getTime() % 1).toBe(0);
    const { rows } = await conClientePg((c) =>
      c.query<{ ok: boolean }>(
        `select occurred_at = date_trunc('milliseconds', occurred_at) as ok
           from audit_log where company_id = $1`,
        [companyId],
      ),
    );
    expect(rows[0].ok).toBe(true);
    expect(hashRecalculado(fila)).toBe(fila.entryHash);
  });

  it('8. concurrencia: 20 operaciones simultáneas de la misma empresa dan 20 filas contiguas y verify-integrity íntegra', async () => {
    const admin = await registerUser(app);
    await Promise.all(
      Array.from({ length: 20 }, () => registrarEn(app, companyId, entrada())),
    );
    const filas = await cadenaDe(companyId);
    expect(filas).toHaveLength(20);
    expect(filas.map((f) => f.sequenceNumber)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const informe = await verificar(admin.accessToken);
    expect(informe.integra).toBe(true);
    expect(informe.entradasVerificadas).toBe(20);
  });

  it('8b. concurrencia a través de la API: 10 altas de obra simultáneas encadenan 10 entradas', async () => {
    const admin = await registerUser(app);
    await Promise.all(
      Array.from({ length: 10 }, () => createProject(app, admin.accessToken)),
    );
    const filas = await cadenaDe(companyId);
    expect(filas).toHaveLength(10);
    expect(filas.every((f) => f.entityType === 'project')).toBe(true);
    expect((await verificar(admin.accessToken)).integra).toBe(true);
    const listado = await authed(app, admin.accessToken)
      .get('/audit?entityType=project')
      .expect(200);
    expect(listado.body[0].sequenceNumber).toBe(10);
    expect(listado.body[0].entryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('9. concurrencia entre empresas: dos transacciones abiertas a la vez, una por empresa, ambas avanzan', async () => {
    const otra = await crearEmpresa('Otra SL');
    const audit = app.get(AuditService);
    let liberarA!: () => void;
    const puerta = new Promise<void>((r) => (liberarA = r));
    let aRegistrada!: () => void;
    const aListo = new Promise<void>((r) => (aRegistrada = r));

    const txA = getDb().transaction(async (tx) => {
      await audit.registrar(tx, entrada(), { companyId, actorId: null });
      aRegistrada();
      await puerta; // mantiene el bloqueo de la cabecera de A
    });
    await aListo;
    // B no debe esperar a A: si lo hiciera, este await no terminaría.
    // El timer se cancela al resolver: un setTimeout huérfano de 4 s deja
    // un open handle que Jest reporta al cerrar la suite.
    let plazo: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        registrarEn(app, otra, entrada()),
        new Promise((_, rej) => {
          plazo = setTimeout(
            () => rej(new Error('B quedó bloqueada por A')),
            4000,
          );
        }),
      ]);
    } finally {
      clearTimeout(plazo);
      liberarA();
    }
    await txA;
    expect(await cadenaDe(companyId)).toHaveLength(1);
    expect(await cadenaDe(otra)).toHaveLength(1);
  });

  it('10. rollback: ni fila de auditoría ni avance de cabecera; la siguiente entrada reutiliza el número', async () => {
    const audit = app.get(AuditService);
    await registrarEn(app, companyId, entrada());
    await expect(
      getDb().transaction(async (tx) => {
        await audit.registrar(tx, entrada(), { companyId, actorId: null });
        throw new Error('falla la operación de negocio');
      }),
    ).rejects.toThrow('falla la operación de negocio');
    expect(await cadenaDe(companyId)).toHaveLength(1);
    const [cabecera] = await getDb()
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.companyId, companyId));
    expect(cabecera.lastSequenceNumber).toBe(1);
    await registrarEn(app, companyId, entrada());
    expect((await cadenaDe(companyId)).map((f) => f.sequenceNumber)).toEqual([
      1, 2,
    ]);
  });

  it('11. fail-closed: si registrar() falla, la operación de negocio no queda confirmada', async () => {
    const audit = app.get(AuditService);
    const code = `FC-${Date.now()}`;
    await expect(
      getDb().transaction(async (tx) => {
        await tx.insert(projects).values({ companyId, code, name: 'Obra' });
        await audit.registrar(
          tx,
          { ...entrada(), entityId: 'no-es-un-uuid' },
          { companyId, actorId: null },
        );
      }),
    ).rejects.toBeDefined();
    const filas = await getDb()
      .select()
      .from(projects)
      .where(eq(projects.code, code));
    expect(filas).toHaveLength(0);
    expect(await cadenaDe(companyId)).toHaveLength(0);
  });

  it('11b. un dato inválido (\\u0000) falla antes de tocar la cadena', async () => {
    await expect(
      registrarEn(app, companyId, entrada({ newData: { x: 'a\u0000b' } })),
    ).rejects.toThrow();
    expect(await cadenaDe(companyId)).toHaveLength(0);
  });

  it('12. varias entradas en una sola llamada quedan contiguas y en orden', async () => {
    const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    await registrarEn(
      app,
      companyId,
      ids.map((entityId) => entrada({ entityId })),
    );
    const filas = await cadenaDe(companyId);
    expect(filas.map((f) => f.entityId)).toEqual(ids);
    expect(filas.map((f) => f.sequenceNumber)).toEqual([1, 2, 3]);
    expect(filas[2].previousHash).toBe(filas[1].entryHash);
  });

  it('13. sin contexto HTTP escribe con opciones.companyId explícito; sin él lanza (ya no se traga el error)', async () => {
    const audit = app.get(AuditService);
    await registrarEn(app, companyId, entrada());
    expect(await cadenaDe(companyId)).toHaveLength(1);
    await expect(
      getDb().transaction((tx) => audit.registrar(tx, entrada())),
    ).rejects.toBeInstanceOf(HttpException);
    expect(await cadenaDe(companyId)).toHaveLength(1);
  });

  it('14. lock_timeout: con la cabecera bloqueada más de 5 s responde 503 AUDIT_CHAIN_BUSY', async () => {
    await registrarEn(app, companyId, entrada());
    const bloqueador = await conClientePg(async (c) => {
      await c.query('BEGIN');
      await c.query(
        'select 1 from audit_chain_heads where company_id = $1 for update',
        [companyId],
      );
      const inicio = Date.now();
      let error: unknown;
      try {
        await registrarEn(app, companyId, entrada());
      } catch (e) {
        error = e;
      }
      const espera = Date.now() - inicio;
      await c.query('ROLLBACK');
      return { error, espera };
    });
    expect(bloqueador.error).toBeInstanceOf(HttpException);
    const http = bloqueador.error as HttpException;
    expect(http.getStatus()).toBe(503);
    expect(http.getResponse()).toMatchObject({ code: 'AUDIT_CHAIN_BUSY' });
    expect(bloqueador.espera).toBeGreaterThanOrEqual(4500);
    expect(await cadenaDe(companyId)).toHaveLength(1);
  }, 20_000);

  it('15. las altas y modificaciones de negocio por la API quedan en la cadena de la empresa', async () => {
    const admin = await registerUser(app);
    const obra = await createProject(app, admin.accessToken);
    await authed(app, admin.accessToken)
      .delete(`/projects/${obra.id}`)
      .set('If-Match', ifMatch(obra.version))
      .expect(204);
    const filas = await cadenaDe(companyId);
    expect(filas.map((f) => f.action)).toEqual(['create', 'delete']);
    expect(filas.every((f) => f.userId !== null)).toBe(true);
    const total = await getDb().select().from(auditLog);
    expect(total).toHaveLength(2);
  });
});
