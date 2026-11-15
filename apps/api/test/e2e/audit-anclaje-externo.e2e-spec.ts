import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditAnchors, getDb } from '@erp/db';
import {
  AUDIT_HASH_VERSION,
  AuditAnclaFirmable,
  AuditIntegrityReportDto,
} from '@erp/shared';
import { AuditAnchorService } from '../../src/audit/audit-anchor.service';
import { verificarFirmaAncla } from '../../src/audit/audit-firma-ancla';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import {
  conTriggersDesactivados,
  entrada,
  limpiarEmpresasExtra,
  registrarEn,
} from './audit-test-utils';

const CLAVE = 'k'.repeat(40);
const OTRA_CLAVE = 'z'.repeat(40);

type LineaExportada = AuditAnclaFirmable & { firma: string | null };

describe('Auditoría (integración) — anclaje externo firmado', () => {
  let app: INestApplication;
  let companyId: string;
  let token: string;
  let anclaje: AuditAnchorService;
  let dir: string;
  const envOriginal = { ...process.env };

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
    dir = mkdtempSync(join(tmpdir(), 'anclas-'));
    process.env.AUDIT_ANCHOR_KEY = CLAVE;
    process.env.AUDIT_ANCHOR_EXPORT_DIR = dir;
    await registrarEn(app, companyId, [entrada({ newData: { a: 1 } })]);
  });

  afterEach(() => {
    process.env.AUDIT_ANCHOR_KEY = envOriginal.AUDIT_ANCHOR_KEY;
    process.env.AUDIT_ANCHOR_EXPORT_DIR = envOriginal.AUDIT_ANCHOR_EXPORT_DIR;
    if (envOriginal.AUDIT_ANCHOR_KEY === undefined)
      delete process.env.AUDIT_ANCHOR_KEY;
    if (envOriginal.AUDIT_ANCHOR_EXPORT_DIR === undefined)
      delete process.env.AUDIT_ANCHOR_EXPORT_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function anclaDeBd() {
    const [a] = await getDb()
      .select()
      .from(auditAnchors)
      .where(eq(auditAnchors.companyId, companyId));
    return a;
  }

  function fichero(): string {
    return join(dir, `audit-anclas-${companyId}.jsonl`);
  }

  function lineas(): LineaExportada[] {
    return readFileSync(fichero(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LineaExportada);
  }

  async function verificar(): Promise<AuditIntegrityReportDto> {
    const res = await authed(app, token)
      .get('/audit/verify-integrity')
      .expect(200);
    return res.body as AuditIntegrityReportDto;
  }

  it('(a) la firma verifica con la clave y no con otra', async () => {
    await anclaje.anclarAhora();
    const a = await anclaDeBd();
    expect(a.firma).toMatch(/^[0-9a-f]{64}$/);
    const firmable = {
      companyId: a.companyId,
      anchorDate: a.anchorDate,
      sequenceNumber: a.sequenceNumber,
      entryHash: a.entryHash,
      hashVersion: AUDIT_HASH_VERSION,
      firma: a.firma,
    };
    expect(verificarFirmaAncla(firmable, CLAVE)).toBe(true);
    expect(verificarFirmaAncla(firmable, OTRA_CLAVE)).toBe(false);
    expect(verificarFirmaAncla({ ...firmable, firma: null }, CLAVE)).toBe(
      false,
    );
  });

  it('(b) el fichero exportado contiene el ancla y verifica sin BD', async () => {
    await anclaje.anclarAhora();
    const a = await anclaDeBd();
    const [l] = lineas();
    expect(l).toMatchObject({
      companyId,
      anchorDate: a.anchorDate,
      sequenceNumber: a.sequenceNumber,
      entryHash: a.entryHash,
      hashVersion: AUDIT_HASH_VERSION,
      firma: a.firma,
    });
    expect(verificarFirmaAncla(l, CLAVE)).toBe(true);
  });

  it('(c) alterar una línea del fichero hace fallar la verificación', async () => {
    await anclaje.anclarAhora();
    const [l] = lineas();
    writeFileSync(
      fichero(),
      `${JSON.stringify({ ...l, sequenceNumber: l.sequenceNumber + 1 })}\n`,
    );
    const [alterada] = lineas();
    expect(verificarFirmaAncla(alterada, CLAVE)).toBe(false);
  });

  it('(d) sin AUDIT_ANCHOR_KEY el ancla queda con firma null y estado sin_clave', async () => {
    delete process.env.AUDIT_ANCHOR_KEY;
    await anclaje.anclarAhora();
    expect((await anclaDeBd()).firma).toBeNull();
    const r = await verificar();
    expect(r.anclas).toHaveLength(1);
    expect(r.anclas[0].firma).toBe('sin_clave');
    expect(r.ultimaAnclaValidada).toBeNull();
    expect(r.estadoSincronizacion).toBe('atrasada');
  });

  it('informe: firma valida, última ancla validada y sincronizada', async () => {
    await anclaje.anclarAhora();
    const r = await verificar();
    const a = await anclaDeBd();
    expect(r.integra).toBe(true);
    expect(r.anclas).toEqual([
      {
        fecha: a.anchorDate,
        sequenceNumber: a.sequenceNumber,
        entryHash: a.entryHash,
        firma: 'valida',
      },
    ]);
    expect(r.ultimaAnclaValidada).toEqual({
      fecha: a.anchorDate,
      entryHash: a.entryHash,
    });
    expect(r.estadoSincronizacion).toBe('sincronizada');
  });

  it('informe: con otra clave la firma es invalida', async () => {
    await anclaje.anclarAhora();
    process.env.AUDIT_ANCHOR_KEY = OTRA_CLAVE;
    const r = await verificar();
    expect(r.anclas[0].firma).toBe('invalida');
    expect(r.ultimaAnclaValidada).toBeNull();
    expect(r.estadoSincronizacion).toBe('atrasada');
  });

  it('un directorio de exportación inexistente no impide anclar', async () => {
    process.env.AUDIT_ANCHOR_EXPORT_DIR = join(dir, 'no-existe');
    const r = await anclaje.anclarAhora();
    expect(r.creadas).toBeGreaterThanOrEqual(1);
    expect((await anclaDeBd()).firma).toMatch(/^[0-9a-f]{64}$/);
  });

  it('(e) audit_chain_heads no interviene en la verificación de la firma', async () => {
    await anclaje.anclarAhora();
    await conTriggersDesactivados(async (c) => {
      await c.query(`delete from audit_chain_heads where company_id = $1`, [
        companyId,
      ]);
    });
    // La cadena local ya no es verificable (cabecera borrada)...
    expect((await verificar()).integra).toBe(false);
    // ...pero el ancla leída del fichero sigue verificando sin BD.
    const [l] = lineas();
    expect(verificarFirmaAncla(l, CLAVE)).toBe(true);
  });
});
