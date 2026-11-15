import { INestApplication } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { auditAnchors, getDb } from '@erp/db';
import { AuditIntegrityReportDto } from '@erp/shared';
import {
  AuditAnchorService,
  cronAnclajeActivo,
} from '../../src/audit/audit-anchor.service';
import {
  calcularHashAuditoria,
  entradaDeFila,
} from '../../src/audit/audit-chain';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import {
  cadenaDe,
  conClientePg,
  conTriggersDesactivados,
  entrada,
  errorDe,
  limpiarEmpresasExtra,
  registrarEn,
} from './audit-test-utils';

describe('Auditoría (integración) — anclas diarias de la cadena', () => {
  let app: INestApplication;
  let companyId: string;
  let token: string;
  let anclaje: AuditAnchorService;

  beforeAll(async () => {
    app = await createTestApp();
    companyId = await seedCompany();
    anclaje = app.get(AuditAnchorService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    await limpiarEmpresasExtra(companyId);
    token = (await registerUser(app)).accessToken;
  });

  async function sembrar(n: number): Promise<void> {
    await registrarEn(
      app,
      companyId,
      Array.from({ length: n }, (_, i) => entrada({ newData: { i } })),
    );
  }

  async function anclas() {
    return getDb()
      .select()
      .from(auditAnchors)
      .where(eq(auditAnchors.companyId, companyId))
      .orderBy(asc(auditAnchors.anchorDate));
  }

  async function verificar(): Promise<AuditIntegrityReportDto> {
    const res = await authed(app, token)
      .get('/audit/verify-integrity')
      .expect(200);
    return res.body as AuditIntegrityReportDto;
  }

  it('crea un ancla con el último seq y su entry_hash', async () => {
    await sembrar(4);
    const filas = await cadenaDe(companyId);
    const r = await anclaje.anclarAhora();
    expect(r.creadas).toBeGreaterThanOrEqual(1);
    const [a] = await anclas();
    expect(a.sequenceNumber).toBe(filas[filas.length - 1].sequenceNumber);
    expect(a.entryHash).toBe(filas[filas.length - 1].entryHash);
    expect(a.anchorDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('segunda ejecución el mismo día no duplica ni reescribe', async () => {
    await sembrar(2);
    await anclaje.anclarAhora();
    const [antes] = await anclas();
    await sembrar(2);
    const r = await anclaje.anclarAhora();
    expect(r.creadas).toBe(0);
    const despues = await anclas();
    expect(despues).toHaveLength(1);
    expect(despues[0]).toEqual(antes);
  });

  it('las anclas son inmutables: UPDATE, DELETE y TRUNCATE fallan', async () => {
    await sembrar(1);
    await anclaje.anclarAhora();
    await conClientePg(async (c) => {
      const upd = await errorDe(
        c,
        `update audit_anchors set sequence_number = 99`,
      );
      expect(upd?.code).toBe('AUD01');
      const del = await errorDe(c, `delete from audit_anchors`);
      expect(del?.code).toBe('AUD01');
      const tr = await errorDe(c, `truncate audit_anchors`);
      expect(tr?.code).toBe('AUD01');
    });
    expect(await anclas()).toHaveLength(1);
  });

  it('cadena sana con anclas -> integra y cuenta las anclas', async () => {
    await sembrar(3);
    await anclaje.anclarAhora();
    const r = await verificar();
    expect(r.integra).toBe(true);
    expect(r.anclas).toBe(1);
  });

  it('sin anclas el informe sigue siendo íntegro con anclas: 0', async () => {
    await sembrar(2);
    const r = await verificar();
    expect(r.integra).toBe(true);
    expect(r.anclas).toBe(0);
  });

  it('reescritura coherente de la cadena tras el ancla -> ANCLA_NO_COINCIDE', async () => {
    await sembrar(3);
    await anclaje.anclarAhora();
    const filas = await cadenaDe(companyId);
    const ultima = { ...filas[2], newData: { reescrito: true } };
    const nuevoHash = calcularHashAuditoria(
      entradaDeFila(ultima, ultima.previousHash as string),
    );
    await conTriggersDesactivados(async (c) => {
      await c.query(
        `update audit_log set new_data = $2, entry_hash = $3 where id = $1`,
        [ultima.id, JSON.stringify({ reescrito: true }), nuevoHash],
      );
      await c.query(
        `update audit_chain_heads set last_entry_hash = $2 where company_id = $1`,
        [companyId, nuevoHash],
      );
    });
    const r = await verificar();
    expect(r.integra).toBe(false);
    expect(r.primerPuntoRoto).toMatchObject({
      sequenceNumber: 3,
      motivo: 'ANCLA_NO_COINCIDE',
      encontrado: nuevoHash,
    });
  });

  it('el cron se omite con NODE_ENV=test o DESACTIVAR_CRON=true', () => {
    const env = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DESACTIVAR_CRON;
      expect(cronAnclajeActivo()).toBe(true);
      process.env.DESACTIVAR_CRON = 'true';
      expect(cronAnclajeActivo()).toBe(false);
      process.env.DESACTIVAR_CRON = 'false';
      process.env.NODE_ENV = 'test';
      expect(cronAnclajeActivo()).toBe(false);
    } finally {
      process.env.NODE_ENV = env.NODE_ENV;
      if (env.DESACTIVAR_CRON === undefined) delete process.env.DESACTIVAR_CRON;
      else process.env.DESACTIVAR_CRON = env.DESACTIVAR_CRON;
    }
  });
});
