import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getDb } from '@erp/db';
import { sql } from 'drizzle-orm';
import { AuditPartitionService } from '../../src/audit/audit-partition.service';
import { createTestApp, createUserWithRole, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import {
  cadenaDe,
  conClientePg,
  crearEmpresa,
  limpiarEmpresasExtra,
  entrada,
  errorDe,
  registrarEn,
} from './audit-test-utils';

describe('Auditoría (integración) — inmutabilidad en PostgreSQL', () => {
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
    await registrarEn(app, companyId, [entrada(), entrada(), entrada()]);
  });

  const INSERT = `insert into audit_log
    (occurred_at, company_id, entity_type, entity_id, action,
     sequence_number, previous_hash, entry_hash, hash_version)
    values ($1, $2, 'x', gen_random_uuid(), 'create', $3, $4, $5, $6)`;

  it('15. UPDATE de new_data -> AUD01', async () => {
    await conClientePg(async (c) => {
      const e = await errorDe(c, `update audit_log set new_data = '{}'`);
      expect(e?.code).toBe('AUD01');
    });
  });

  it('16. UPDATE del entry_hash de una fila ya sellada -> AUD01', async () => {
    await conClientePg(async (c) => {
      const e = await errorDe(c, `update audit_log set entry_hash = $1`, [
        'f'.repeat(64),
      ]);
      expect(e?.code).toBe('AUD01');
    });
  });

  it('17. DELETE FROM audit_log -> AUD01', async () => {
    await conClientePg(async (c) => {
      expect((await errorDe(c, 'delete from audit_log'))?.code).toBe('AUD01');
    });
    expect(await cadenaDe(companyId)).toHaveLength(3);
  });

  it('18. TRUNCATE audit_log sin purga -> AUD01', async () => {
    await conClientePg(async (c) => {
      expect((await errorDe(c, 'truncate audit_log'))?.code).toBe('AUD01');
    });
  });

  it('19. TRUNCATE de una partición concreta sin purga -> AUD01', async () => {
    await conClientePg(async (c) => {
      const { rows } = await c.query<{ p: string }>(
        `select tableoid::regclass::text as p from audit_log limit 1`,
      );
      expect((await errorDe(c, `truncate ${rows[0].p}`))?.code).toBe('AUD01');
    });
  });

  it('20. UPDATE/DELETE directamente sobre una partición hija -> AUD01 (trigger clonado)', async () => {
    await conClientePg(async (c) => {
      const { rows } = await c.query<{ p: string }>(
        `select tableoid::regclass::text as p from audit_log limit 1`,
      );
      const p = rows[0].p;
      expect((await errorDe(c, `update ${p} set action = 'x'`))?.code).toBe(
        'AUD01',
      );
      expect((await errorDe(c, `delete from ${p}`))?.code).toBe('AUD01');
    });
  });

  it('21. INSERT directo con secuencia repetida, salto, previous_hash incorrecto, sin hash o con hash mal formado -> AUD02', async () => {
    await conClientePg(async (c) => {
      const { rows } = await c.query<{ h: string }>(
        `select entry_hash as h from audit_log
          where company_id = $1 and sequence_number = 3`,
        [companyId],
      );
      const ultimo = rows[0].h;
      const ahora = new Date().toISOString();
      const casos: Array<
        [number, string | null, string | null, number | null]
      > = [
        [3, ultimo, 'a'.repeat(64), 1], // secuencia repetida
        [5, ultimo, 'a'.repeat(64), 1], // salto
        [4, 'b'.repeat(64), 'a'.repeat(64), 1], // previous_hash incorrecto
        [4, ultimo, null, 1], // sin hash
        [4, ultimo, 'XYZ', 1], // hash mal formado
        [4, ultimo, 'a'.repeat(64), 2], // versión desconocida
      ];
      for (const [seq, prev, hash, ver] of casos) {
        const e = await errorDe(c, INSERT, [
          ahora,
          companyId,
          seq,
          prev,
          hash,
          ver,
        ]);
        expect(e?.code).toBe('AUD02');
      }
    });
    expect(await cadenaDe(companyId)).toHaveLength(3);
  });

  it('22. INSERT directo con occurred_at con microsegundos -> AUD02', async () => {
    await conClientePg(async (c) => {
      const { rows } = await c.query<{ h: string }>(
        `select entry_hash as h from audit_log
          where company_id = $1 and sequence_number = 3`,
        [companyId],
      );
      const e = await errorDe(c, INSERT, [
        new Date().toISOString().replace('Z', '123Z'),
        companyId,
        4,
        rows[0].h,
        'a'.repeat(64),
        1,
      ]);
      expect(e?.code).toBe('AUD02');
    });
  });

  it('23. UPDATE/DELETE/TRUNCATE directos sobre audit_chain_heads y alta no génesis -> AUD01', async () => {
    const otra = await crearEmpresa('Otra SL');
    await conClientePg(async (c) => {
      expect(
        (
          await errorDe(
            c,
            'update audit_chain_heads set last_sequence_number = 99',
          )
        )?.code,
      ).toBe('AUD01');
      expect((await errorDe(c, 'delete from audit_chain_heads'))?.code).toBe(
        'AUD01',
      );
      expect((await errorDe(c, 'truncate audit_chain_heads'))?.code).toBe(
        'AUD01',
      );
      expect(
        (
          await errorDe(
            c,
            `insert into audit_chain_heads (company_id, last_sequence_number, last_entry_hash)
             values ($1, 5, $2)`,
            [otra, 'a'.repeat(64)],
          )
        )?.code,
      ).toBe('AUD01');
    });
  });

  it('24. con erp.audit_purge = on en erp_test el TRUNCATE de cadena completa está permitido', async () => {
    await conClientePg(async (c) => {
      await c.query('BEGIN');
      await c.query(`set local erp.audit_purge = 'on'`);
      await c.query('truncate audit_log, audit_chain_heads');
      await c.query('COMMIT');
    });
    expect(await cadenaDe(companyId)).toHaveLength(0);
  });

  it('25. audit_purga_permitida() es false sin la variable y la condición del nombre de base distingue _test', async () => {
    await conClientePg(async (c) => {
      const sin = await c.query<{ r: boolean }>(
        'select audit_purga_permitida() as r',
      );
      expect(sin.rows[0].r).toBe(false);
      await c.query('BEGIN');
      await c.query(`set local erp.audit_purge = 'on'`);
      const con = await c.query<{ r: boolean }>(
        'select audit_purga_permitida() as r',
      );
      expect(con.rows[0].r).toBe(true); // esta base es erp_test
      await c.query('ROLLBACK');
      const nombres = await c.query<{ dev: boolean; test: boolean }>(
        String.raw`select 'erp_dev' like '%\_test' as dev, 'erp_test' like '%\_test' as test`,
      );
      expect(nombres.rows[0]).toEqual({ dev: false, test: true });
    });
  });

  it('26. borrar un usuario con entradas de auditoría no toca audit_log (FK eliminada)', async () => {
    const admin = await registerUser(app);
    const usuario = await createUserWithRole(app, admin.accessToken, 'lector');
    const payload = JSON.parse(
      Buffer.from(usuario.accessToken.split('.')[1], 'base64url').toString(),
    ) as { sub: string };
    await registrarEn(app, companyId, entrada(), payload.sub);
    await conClientePg(async (c) => {
      await c.query('delete from refresh_tokens where user_id = $1', [
        payload.sub,
      ]);
      await c.query('delete from users where id = $1', [payload.sub]);
      const { rows } = await c.query(
        'select user_id from audit_log where user_id = $1',
        [payload.sub],
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('27. borrar una empresa con auditoría falla (FK NO ACTION)', async () => {
    const otra = await crearEmpresa('Con auditoría SL');
    await registrarEn(app, otra, entrada());
    await conClientePg(async (c) => {
      const e = await errorDe(c, 'delete from companies where id = $1', [otra]);
      expect(e?.code).toBe('23503');
      expect(e?.constraint).toMatch(/^audit_/);
    });
  });

  it('28. una partición creada por ensurePartitions() tiene el trigger de TRUNCATE y hereda los de fila', async () => {
    const ahora = new Date();
    const futuro = new Date(
      Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 2, 1),
    );
    const nombre = `audit_log_${futuro.getUTCFullYear()}_${String(
      futuro.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    await getDb().execute(sql.raw(`drop table if exists "${nombre}"`));
    const creadas = await app.get(AuditPartitionService).ensurePartitions();
    expect(creadas).toContain(nombre);
    const { rows } = await getDb().execute(
      sql`select tgname from pg_trigger
           where tgrelid = ${`public.${nombre}`}::regclass and not tgisinternal
           order by tgname`,
    );
    expect(rows.map((r) => (r as { tgname: string }).tgname)).toEqual([
      'audit_log_bi_encadenar',
      'audit_log_bt_truncate',
      'audit_log_bud_inmutable',
    ]);
    await conClientePg(async (c) => {
      expect((await errorDe(c, `truncate "${nombre}"`))?.code).toBe('AUD01');
    });
  });

  it('29. un id de entidad cualquiera no cambia nada: la inmutabilidad no depende de los datos', async () => {
    await conClientePg(async (c) => {
      const e = await errorDe(
        c,
        `update audit_log set entity_id = $1 where company_id = $2`,
        [randomUUID(), companyId],
      );
      expect(e?.code).toBe('AUD01');
    });
  });
});
