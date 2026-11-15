import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuditIntegrityReportDto } from '@erp/shared';
import {
  calcularHashAuditoria,
  entradaDeFila,
} from '../../src/audit/audit-chain';
import {
  authed,
  createTestApp,
  createUserWithRole,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import {
  cadenaDe,
  conTriggersDesactivados,
  crearEmpresa,
  limpiarEmpresasExtra,
  entrada,
  registrarEn,
} from './audit-test-utils';

describe('Auditoría (integración) — GET /audit/verify-integrity', () => {
  let app: INestApplication;
  let companyId: string;
  let token: string;

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
    token = (await registerUser(app)).accessToken;
  });

  async function verificar(t = token): Promise<AuditIntegrityReportDto> {
    const res = await authed(app, t).get('/audit/verify-integrity').expect(200);
    return res.body as AuditIntegrityReportDto;
  }

  async function sembrar(n: number): Promise<void> {
    await registrarEn(
      app,
      companyId,
      Array.from({ length: n }, (_, i) =>
        entrada({ newData: { i }, meta: { origen: 'test' } }),
      ),
    );
  }

  it('29. cadena vacía -> integra: true y 0 entradas', async () => {
    const r = await verificar();
    expect(r).toMatchObject({
      companyId,
      integra: true,
      entradasVerificadas: 0,
      ultimaSecuencia: 0,
      primerPuntoRoto: null,
    });
    expect(r.ultimoHash).toBe('0'.repeat(64));
  });

  it('30. cadena sana -> integra con ultimaSecuencia y ultimoHash correctos', async () => {
    await sembrar(7);
    const filas = await cadenaDe(companyId);
    const r = await verificar();
    expect(r.integra).toBe(true);
    expect(r.entradasVerificadas).toBe(7);
    expect(r.ultimaSecuencia).toBe(7);
    expect(r.ultimoHash).toBe(filas[6].entryHash);
    expect(r.primerPuntoRoto).toBeNull();
    expect(typeof r.duracionMs).toBe('number');
    expect(new Date(r.verificadoEn).toString()).not.toBe('Invalid Date');
  });

  it('31. manipular new_data -> ENTRY_HASH_MISMATCH con id y sequenceNumber de la fila', async () => {
    await sembrar(5);
    const filas = await cadenaDe(companyId);
    await conTriggersDesactivados((c) =>
      c.query(
        `update audit_log set new_data = '{"hackeado":true}' where id = $1`,
        [filas[2].id],
      ),
    );
    const r = await verificar();
    expect(r.integra).toBe(false);
    expect(r.entradasVerificadas).toBe(2);
    expect(r.ultimaSecuencia).toBe(2);
    expect(r.primerPuntoRoto).toMatchObject({
      id: filas[2].id,
      sequenceNumber: 3,
      motivo: 'ENTRY_HASH_MISMATCH',
    });
  });

  it.each([
    ['user_id', `user_id = gen_random_uuid()`],
    ['action', `action = 'delete'`],
    ['entity_id', `entity_id = gen_random_uuid()`],
    ['entity_type', `entity_type = 'invoice'`],
    ['occurred_at', `occurred_at = occurred_at + interval '1 second'`],
    ['correlation_id', `correlation_id = 'manipulado'`],
    ['meta', `meta = '{"otro":1}'`],
    ['old_data', `old_data = '{"otro":1}'`],
  ])('32. manipular %s -> ENTRY_HASH_MISMATCH', async (_campo, set) => {
    await sembrar(3);
    const filas = await cadenaDe(companyId);
    await conTriggersDesactivados(async (c) => {
      // user_id sin FK, así que un uuid aleatorio es válido
      await c.query(`update audit_log set ${set} where id = $1`, [filas[1].id]);
    });
    const r = await verificar();
    expect(r.integra).toBe(false);
    expect(r.primerPuntoRoto).toMatchObject({
      id: filas[1].id,
      sequenceNumber: 2,
      motivo: 'ENTRY_HASH_MISMATCH',
    });
  });

  it('33. manipular previous_hash -> PREVIOUS_HASH_MISMATCH', async () => {
    await sembrar(4);
    const filas = await cadenaDe(companyId);
    await conTriggersDesactivados((c) =>
      c.query(`update audit_log set previous_hash = $2 where id = $1`, [
        filas[2].id,
        'e'.repeat(64),
      ]),
    );
    const r = await verificar();
    expect(r.primerPuntoRoto).toMatchObject({
      sequenceNumber: 3,
      motivo: 'PREVIOUS_HASH_MISMATCH',
    });
  });

  it('34. fila intermedia borrada -> SEQUENCE_GAP en la siguiente', async () => {
    await sembrar(5);
    const filas = await cadenaDe(companyId);
    await conTriggersDesactivados((c) =>
      c.query('delete from audit_log where id = $1', [filas[2].id]),
    );
    const r = await verificar();
    expect(r.integra).toBe(false);
    expect(r.entradasVerificadas).toBe(2);
    expect(r.primerPuntoRoto).toMatchObject({
      id: filas[3].id,
      sequenceNumber: 4,
      motivo: 'SEQUENCE_GAP',
      esperado: '3',
      encontrado: '4',
    });
  });

  it('35. última fila borrada -> HEAD_MISMATCH', async () => {
    await sembrar(4);
    const filas = await cadenaDe(companyId);
    await conTriggersDesactivados((c) =>
      c.query('delete from audit_log where id = $1', [filas[3].id]),
    );
    const r = await verificar();
    expect(r.integra).toBe(false);
    expect(r.entradasVerificadas).toBe(3);
    expect(r.primerPuntoRoto).toMatchObject({
      id: null,
      occurredAt: null,
      sequenceNumber: 4,
      motivo: 'HEAD_MISMATCH',
    });
  });

  it('35b. cabecera borrada con filas -> HEAD_MISSING', async () => {
    await sembrar(2);
    await conTriggersDesactivados((c) =>
      c.query('delete from audit_chain_heads'),
    );
    const r = await verificar();
    expect(r.primerPuntoRoto).toMatchObject({ motivo: 'HEAD_MISSING' });
  });

  it('36. fila duplicada (mismo número, otro occurred_at) -> SEQUENCE_DUPLICATE', async () => {
    await sembrar(3);
    const filas = await cadenaDe(companyId);
    await conTriggersDesactivados((c) =>
      c.query(
        `insert into audit_log (occurred_at, company_id, entity_type, entity_id, action,
            sequence_number, previous_hash, entry_hash, hash_version)
         values (now() + interval '1 hour', $1, 'x', gen_random_uuid(), 'create', 2, $2, $3, 1)`,
        [companyId, filas[0].entryHash, 'a'.repeat(64)],
      ),
    );
    const r = await verificar();
    expect(r.integra).toBe(false);
    expect(r.primerPuntoRoto?.motivo).toBe('SEQUENCE_DUPLICATE');
    expect(r.primerPuntoRoto?.sequenceNumber).toBe(2);
  });

  it('37. fila recalculada "coherentemente" sin rehacer las siguientes -> PREVIOUS_HASH_MISMATCH en la siguiente', async () => {
    await sembrar(4);
    const filas = await cadenaDe(companyId);
    const objetivo = filas[1];
    const nuevoNewData = { reescrito: true };
    const nuevoHash = calcularHashAuditoria({
      ...entradaDeFila(objetivo, objetivo.previousHash as string),
      newData: nuevoNewData,
    });
    await conTriggersDesactivados((c) =>
      c.query(
        `update audit_log set new_data = $2, entry_hash = $3 where id = $1`,
        [objetivo.id, JSON.stringify(nuevoNewData), nuevoHash],
      ),
    );
    const r = await verificar();
    expect(r.integra).toBe(false);
    expect(r.entradasVerificadas).toBe(2);
    expect(r.primerPuntoRoto).toMatchObject({
      id: filas[2].id,
      sequenceNumber: 3,
      motivo: 'PREVIOUS_HASH_MISMATCH',
    });
  });

  it('38. con dos puntos rotos informa solo del primero', async () => {
    await sembrar(6);
    const filas = await cadenaDe(companyId);
    await conTriggersDesactivados(async (c) => {
      await c.query(`update audit_log set action = 'delete' where id = $1`, [
        filas[4].id,
      ]);
      await c.query(`update audit_log set action = 'delete' where id = $1`, [
        filas[1].id,
      ]);
    });
    const r = await verificar();
    expect(r.primerPuntoRoto?.sequenceNumber).toBe(2);
  });

  it('39. una empresa rota no afecta al veredicto de otra', async () => {
    const otra = await crearEmpresa('Otra SL');
    await sembrar(3);
    await registrarEn(app, otra, [entrada(), entrada()]);
    const filasOtra = await cadenaDe(otra);
    await conTriggersDesactivados((c) =>
      c.query(`update audit_log set action = 'delete' where id = $1`, [
        filasOtra[0].id,
      ]),
    );
    const r = await verificar(); // empresa del admin: sana
    expect(r.companyId).toBe(companyId);
    expect(r.integra).toBe(true);
    expect(r.entradasVerificadas).toBe(3);
  });

  it('40. roles: admin 200; gerente y resto 403; sin token 401', async () => {
    await authed(app, token).get('/audit/verify-integrity').expect(200);
    for (const rol of [
      'gerente',
      'administracion',
      'obra',
      'subcontrata',
      'cliente',
      'lector',
    ] as const) {
      const t = await createUserWithRole(app, token, rol, {});
      await authed(app, t.accessToken)
        .get('/audit/verify-integrity')
        .expect(403);
    }
    await request(app.getHttpServer())
      .get('/audit/verify-integrity')
      .expect(401);
  }, 60_000);

  it('41. más de 2000 entradas (cruza el límite de lote) -> íntegra', async () => {
    await sembrar(2105);
    const r = await verificar();
    expect(r.integra).toBe(true);
    expect(r.entradasVerificadas).toBe(2105);
  }, 120_000);
});
