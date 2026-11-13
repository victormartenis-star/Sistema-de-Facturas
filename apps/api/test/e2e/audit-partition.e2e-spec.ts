import { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getDb } from '@erp/db';
import { AuditPartitionService } from '../../src/audit/audit-partition.service';
import { createTestApp } from './helpers';

/**
 * `audit_log` está particionada por mes desde la migración
 * `0027_audit_log_partition.sql` (Fase 16). No es un módulo de negocio con
 * RBAC ni `company_id` — es infraestructura de la propia tabla —, así que
 * este spec habla directo con `AuditPartitionService` y con SQL crudo en
 * vez de pasar por la API HTTP.
 */
describe('AuditPartitionService (integración) — particiones mensuales de audit_log', () => {
  let app: INestApplication;
  let service: AuditPartitionService;

  beforeAll(async () => {
    app = await createTestApp();
    service = app.get(AuditPartitionService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function partitionExists(name: string): Promise<boolean> {
    const db = getDb();
    const res = await db.execute(
      sql`select to_regclass(${`public.${name}`}) is not null as exists`,
    );
    return Boolean((res.rows[0] as { exists: boolean }).exists);
  }

  it('la migración ya deja creadas las particiones del mes actual y las 2 siguientes', async () => {
    const now = new Date();
    for (let i = 0; i <= 2; i++) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1),
      );
      const name = `audit_log_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      expect(await partitionExists(name)).toBe(true);
    }
  });

  it('ensurePartitions() es idempotente: sin particiones que falten, no crea nada', async () => {
    const created = await service.ensurePartitions();
    expect(created).toEqual([]);
  });

  it('crea la partición que falte y la deja consultable', async () => {
    const now = new Date();
    const future = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1),
    );
    const name = `audit_log_${future.getUTCFullYear()}_${String(future.getUTCMonth() + 1).padStart(2, '0')}`;

    const db = getDb();
    await db.execute(sql.raw(`drop table "${name}"`));
    expect(await partitionExists(name)).toBe(false);

    const created = await service.ensurePartitions();
    expect(created).toContain(name);
    expect(await partitionExists(name)).toBe(true);
  });
});
