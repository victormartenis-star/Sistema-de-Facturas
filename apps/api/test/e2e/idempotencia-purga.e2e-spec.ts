import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, idempotencyKeys } from '@erp/db';
import { IdempotenciaPurgaService } from '../../src/common/idempotencia/idempotencia-purga.service';
import { createTestApp } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/** Purga periódica de `idempotency_keys` caducadas (cron + lotes SKIP LOCKED). */
describe('Idempotencia (integración) — purga de claves caducadas', () => {
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
  });

  async function insertar(expiresAt: Date): Promise<string> {
    const key = randomUUID();
    await getDb()
      .insert(idempotencyKeys)
      .values({
        companyId,
        key,
        method: 'POST',
        path: '/invoices',
        requestHash: 'c'.repeat(64),
        status: 'completada',
        responseStatus: 201,
        responseBody: {},
        expiresAt,
      });
    return key;
  }

  async function existe(key: string): Promise<boolean> {
    const filas = await getDb()
      .select({ id: idempotencyKeys.id })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key));
    return filas.length > 0;
  }

  it('borra las caducadas y conserva las vigentes', async () => {
    const caducada = await insertar(new Date(Date.now() - 60_000));
    const vigente = await insertar(new Date(Date.now() + 3_600_000));

    const purgadas = await app.get(IdempotenciaPurgaService).purgarCaducadas();

    expect(purgadas).toBe(1);
    expect(await existe(caducada)).toBe(false);
    expect(await existe(vigente)).toBe(true);
  });

  it('sin claves caducadas no borra nada y devuelve 0', async () => {
    await insertar(new Date(Date.now() + 3_600_000));
    expect(await app.get(IdempotenciaPurgaService).purgarCaducadas()).toBe(0);
  });
});
