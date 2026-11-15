import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { auditChainHeads, auditLog, getDb } from '@erp/db';
import { AuditIntegrityReportDto } from '@erp/shared';
import { AuditPartitionService } from '../../src/audit/audit-partition.service';
import {
  calcularHashAuditoria,
  entradaDeFila,
  sellarLegado,
} from '../../src/audit/audit-chain';
import { AuditChainBackfillService } from '../../src/audit/audit-chain-backfill.service';
import { AuditIntegrityService } from '../../src/audit/audit-integrity.service';
import { createTestApp } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import {
  cadenaDe,
  conClientePg,
  conTriggersDesactivados,
  crearEmpresa,
  limpiarEmpresasExtra,
  entrada,
  errorDe,
  registrarEn,
} from './audit-test-utils';

/** El mismo UPDATE de numeración que ejecuta la migración 0039. */
const NUMERAR = `
  UPDATE "audit_log" a
     SET "sequence_number" = n.rn
    FROM (SELECT "id", "occurred_at",
                 row_number() OVER (PARTITION BY "company_id" ORDER BY "occurred_at", "id") AS rn
            FROM "audit_log") n
   WHERE a."id" = n."id" AND a."occurred_at" = n."occurred_at"`;

interface Legada {
  id: string;
  occurredAt: string; // ISO con microsegundos
  action?: string;
  newData?: unknown;
}

describe('Auditoría (integración) — backfill y sellado de filas históricas', () => {
  let app: INestApplication;
  let companyId: string;

  beforeAll(async () => {
    app = await createTestApp();
    companyId = await seedCompany();
    await app.get(AuditPartitionService).ensurePartitions();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    await limpiarEmpresasExtra(companyId);
  });

  /** Inserta filas "de antes de la migración": sin hash, numeradas como la migración. */
  async function sembrarLegado(empresa: string, filas: Legada[]) {
    await conTriggersDesactivados(async (c) => {
      let marcador = 0;
      for (const f of filas) {
        marcador -= 1; // evita el UNIQUE hasta que NUMERAR asigne la secuencia real
        await c.query(
          `insert into audit_log (id, occurred_at, company_id, entity_type, entity_id,
              action, new_data, sequence_number)
           values ($1, $2, $3, 'project', $4, $5, $6, $7)`,
          [
            f.id,
            f.occurredAt,
            empresa,
            f.id,
            f.action ?? 'create',
            JSON.stringify(f.newData ?? { id: f.id }),
            marcador,
          ],
        );
      }
      await c.query(NUMERAR);
      await c.query(
        `insert into audit_chain_heads (company_id, last_sequence_number, last_entry_hash)
         select company_id, max(sequence_number), null from audit_log
          where company_id = $1 group by company_id
         on conflict (company_id) do update
            set last_sequence_number = excluded.last_sequence_number,
                last_entry_hash = null`,
        [empresa],
      );
    });
  }

  const sellar = (empresa: string) =>
    getDb().transaction((tx) => sellarLegado(tx, empresa));

  const verificar = (empresa: string): Promise<AuditIntegrityReportDto> =>
    app.get(AuditIntegrityService).verificar(empresa);

  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  function diaDeEsteMes(dia: number, micros: string): string {
    const n = new Date();
    const mm = String(n.getUTCMonth() + 1).padStart(2, '0');
    return `${n.getUTCFullYear()}-${mm}-${String(dia).padStart(2, '0')}T10:00:00.${micros}Z`;
  }

  const LEGADO: Legada[] = [
    { id: uuid(5), occurredAt: diaDeEsteMes(3, '123456') },
    { id: uuid(2), occurredAt: diaDeEsteMes(1, '000001') },
    { id: uuid(4), occurredAt: diaDeEsteMes(3, '123456') }, // mismo occurred_at que uuid(5)
    { id: uuid(1), occurredAt: diaDeEsteMes(1, '000001') }, // mismo occurred_at que uuid(2)
    { id: uuid(3), occurredAt: diaDeEsteMes(2, '999999') },
  ];

  it('42. numeración de la migración: orden (occurred_at, id), por empresa, con empates y microsegundos', async () => {
    const otra = await crearEmpresa('Otra SL');
    await sembrarLegado(companyId, LEGADO);
    await sembrarLegado(otra, [
      { id: uuid(9), occurredAt: diaDeEsteMes(7, '500000') },
      { id: uuid(8), occurredAt: diaDeEsteMes(6, '500000') },
    ]);
    const filas = await cadenaDe(companyId);
    // (occurred_at, id): 1/1 -> uuid1, uuid2; 2/1 -> uuid3; 3/1 -> uuid4, uuid5
    expect(filas.map((f) => f.id)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
      uuid(4),
      uuid(5),
    ]);
    expect(filas.map((f) => f.sequenceNumber)).toEqual([1, 2, 3, 4, 5]);
    expect((await cadenaDe(otra)).map((f) => [f.id, f.sequenceNumber])).toEqual(
      [
        [uuid(8), 1],
        [uuid(9), 2],
      ],
    );
    expect(filas.every((f) => f.entryHash === null)).toBe(true);
    const [cabecera] = await getDb()
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.companyId, companyId));
    expect(cabecera.lastSequenceNumber).toBe(5);
    expect(cabecera.lastEntryHash).toBeNull();
  });

  it('43. sellarLegado produce una cadena íntegra y verify-integrity devuelve integra: true', async () => {
    await sembrarLegado(companyId, LEGADO);
    expect((await verificar(companyId)).primerPuntoRoto?.motivo).toBe(
      'UNSEALED',
    );
    const sellados = await getDb().transaction((tx) =>
      sellarLegado(tx, companyId),
    );
    expect(sellados).toBe(5);
    const r = await verificar(companyId);
    expect(r.integra).toBe(true);
    expect(r.entradasVerificadas).toBe(5);
    const filas = await cadenaDe(companyId);
    expect(filas[0].previousHash).toBe('0'.repeat(64));
    for (let i = 1; i < filas.length; i++) {
      expect(filas[i].previousHash).toBe(filas[i - 1].entryHash);
    }
    const [cabecera] = await getDb()
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.companyId, companyId));
    expect(cabecera.lastEntryHash).toBe(filas[4].entryHash);
  });

  it('44. determinismo: sellar dos copias idénticas de los datos produce exactamente los mismos hashes', async () => {
    await sembrarLegado(companyId, LEGADO);
    await sellar(companyId);
    const primera = (await cadenaDe(companyId)).map((f) => f.entryHash);
    await resetTestDb();
    await sembrarLegado(companyId, LEGADO);
    await sellar(companyId);
    const segunda = (await cadenaDe(companyId)).map((f) => f.entryHash);
    expect(segunda).toEqual(primera);
  });

  it('45. idempotencia: sellar dos veces no cambia nada', async () => {
    await sembrarLegado(companyId, LEGADO);
    expect(await sellar(companyId)).toBe(5);
    const antes = (await cadenaDe(companyId)).map((f) => f.entryHash);
    expect(await sellar(companyId)).toBe(0);
    expect((await cadenaDe(companyId)).map((f) => f.entryHash)).toEqual(antes);
    expect(await app.get(AuditChainBackfillService).sellarPendientes()).toBe(0);
  });

  it('46. reanudación: un sellado interrumpido (rollback) no deja nada y uno parcial continúa desde la última fila sellada', async () => {
    await sembrarLegado(companyId, LEGADO);
    // Interrumpido: se sella y la transacción se revierte.
    await expect(
      getDb().transaction(async (tx) => {
        await sellarLegado(tx, companyId);
        throw new Error('corte');
      }),
    ).rejects.toThrow('corte');
    expect((await cadenaDe(companyId)).every((f) => f.entryHash === null)).toBe(
      true,
    );

    // Parcial: las 2 primeras ya selladas por un proceso anterior.
    await getDb().transaction(async (tx) => {
      let previo = '0'.repeat(64);
      const filas = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.companyId, companyId));
      filas.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      for (const fila of filas.slice(0, 2)) {
        const h = calcularHashAuditoria(entradaDeFila(fila, previo));
        await tx
          .update(auditLog)
          .set({ previousHash: previo, entryHash: h, hashVersion: 1 })
          .where(eq(auditLog.id, fila.id));
        previo = h;
      }
    });
    expect(await sellar(companyId)).toBe(3);
    expect((await verificar(companyId)).integra).toBe(true);
  });

  it('47. con la cabecera pendiente, un INSERT directo falla con AUD03; registrar() sella en línea y después escribe', async () => {
    await sembrarLegado(companyId, LEGADO);
    await conClientePg(async (c) => {
      const e = await errorDe(
        c,
        `insert into audit_log (occurred_at, company_id, entity_type, entity_id, action,
            sequence_number, previous_hash, entry_hash, hash_version)
         values (date_trunc('milliseconds', now()), $1, 'x', gen_random_uuid(), 'create', 6, $2, $3, 1)`,
        [companyId, 'a'.repeat(64), 'b'.repeat(64)],
      );
      expect(e?.code).toBe('AUD03');
    });
    await registrarEn(app, companyId, entrada());
    const filas = await cadenaDe(companyId);
    expect(filas).toHaveLength(6);
    expect(filas.every((f) => f.entryHash !== null)).toBe(true);
    expect(filas[5].sequenceNumber).toBe(6);
    expect((await verificar(companyId)).integra).toBe(true);
  });

  it('48. sellado fuera de orden (fila N antes que N-1) -> AUD02', async () => {
    await sembrarLegado(companyId, LEGADO);
    const filas = await cadenaDe(companyId);
    await conClientePg(async (c) => {
      const e = await errorDe(
        c,
        `update audit_log set previous_hash = $2, entry_hash = $3, hash_version = 1 where id = $1`,
        [filas[1].id, 'c'.repeat(64), 'd'.repeat(64)],
      );
      expect(e?.code).toBe('AUD02');
    });
  });

  it('49. tras el sellado, una entrada nueva enlaza con el último hash histórico', async () => {
    await sembrarLegado(companyId, LEGADO);
    await sellar(companyId);
    const ultimaHistorica = (await cadenaDe(companyId))[4];
    await registrarEn(app, companyId, entrada());
    const nueva = (await cadenaDe(companyId))[5];
    expect(nueva.sequenceNumber).toBe(6);
    expect(nueva.previousHash).toBe(ultimaHistorica.entryHash);
    expect((await verificar(companyId)).integra).toBe(true);
  });

  it('50. filas históricas repartidas en varias particiones mensuales: la cadena cruza particiones', async () => {
    const ahora = new Date();
    const mes = (delta: number, dia: number) => {
      const d = new Date(
        Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + delta, dia, 9),
      );
      return d.toISOString().replace('.000Z', '.250000Z');
    };
    await sembrarLegado(companyId, [
      { id: uuid(1), occurredAt: mes(0, 2) },
      { id: uuid(2), occurredAt: mes(1, 5) },
      { id: uuid(3), occurredAt: mes(2, 9) },
      { id: uuid(4), occurredAt: mes(2, 20) },
    ]);
    const { rows } = await conClientePg((c) =>
      c.query<{ p: string }>(
        `select distinct tableoid::regclass::text as p from audit_log where company_id = $1`,
        [companyId],
      ),
    );
    expect(rows.length).toBe(3);
    await sellar(companyId);
    const r = await verificar(companyId);
    expect(r.integra).toBe(true);
    expect(r.entradasVerificadas).toBe(4);
  });

  it('el backfill de arranque sella todas las empresas pendientes', async () => {
    const otra = await crearEmpresa('Otra SL');
    await sembrarLegado(companyId, LEGADO);
    await sembrarLegado(otra, [
      { id: uuid(7), occurredAt: diaDeEsteMes(4, '100000') },
    ]);
    expect(await app.get(AuditChainBackfillService).sellarPendientes()).toBe(6);
    expect((await verificar(companyId)).integra).toBe(true);
    expect((await verificar(otra)).integra).toBe(true);
  });
});
