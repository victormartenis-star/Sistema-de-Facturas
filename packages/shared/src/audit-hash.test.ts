import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_GENESIS_HASH,
  AUDIT_HASH_VERSION,
  normalizarDatoAuditoria,
  normalizarPayloadAuditoria,
  preimagenAuditoria,
} from './audit-hash';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const ENTIDAD = '22222222-2222-4222-8222-222222222222';
const USUARIO = '33333333-3333-4333-8333-333333333333';

describe('audit-hash: vectores fijos (caso 51)', () => {
  it('constantes', () => {
    expect(AUDIT_GENESIS_HASH).toBe('0'.repeat(64));
    expect(AUDIT_HASH_VERSION).toBe(1);
  });

  it('vector 1: génesis, sin actor ni correlación', () => {
    const pre = preimagenAuditoria({
      companyId: EMPRESA,
      sequenceNumber: 1,
      previousHash: AUDIT_GENESIS_HASH,
      actorId: null,
      action: 'create',
      entityType: 'invoice',
      entityId: ENTIDAD,
      newData: { b: [1, 2], a: 1 },
      occurredAt: new Date('2026-11-15T09:30:00.123Z'),
    });
    expect(pre).toBe(
      '[1,"11111111-1111-4111-8111-111111111111",1,"' +
        '0'.repeat(64) +
        '",null,"create","invoice","22222222-2222-4222-8222-222222222222",' +
        '{"correlationId":null,"meta":null,"newData":{"a":1,"b":[1,2]},"oldData":null},' +
        '"2026-11-15T09:30:00.123Z"]',
    );
    expect(sha(pre)).toBe(
      '200f7e48096881312848ae60d918aa588be79b6f7c37293b1d47cea389fefab0',
    );
  });

  it('vector 2: actor, correlación, Unicode y decimales', () => {
    const pre = preimagenAuditoria({
      companyId: EMPRESA,
      sequenceNumber: 2,
      previousHash: 'ab'.repeat(32),
      actorId: USUARIO,
      action: 'update',
      entityType: 'project',
      entityId: ENTIDAD,
      oldData: { nombre: 'a' },
      newData: { x: 0.1, nombre: 'Ñandú 🚀' },
      meta: { ip: '1.2.3.4' },
      correlationId: 'abc12345',
      occurredAt: '2026-11-15T09:30:01.000Z',
    });
    expect(sha(pre)).toBe(
      '335615eb28f304f7f6f08ccee1d39e4f6b77029903e17d7c3fcb581b7e15c4e9',
    );
  });
});

describe('audit-hash: canónico (caso 52)', () => {
  const base = {
    companyId: EMPRESA,
    sequenceNumber: 5,
    previousHash: AUDIT_GENESIS_HASH,
    actorId: null,
    action: 'update',
    entityType: 'invoice',
    entityId: ENTIDAD,
    occurredAt: '2026-11-15T09:30:00.000Z',
  };

  it('el orden de las claves es indiferente (anidado)', () => {
    const a = preimagenAuditoria({
      ...base,
      newData: { z: { q: 1, p: 2 }, a: [{ y: 1, x: 2 }] },
    });
    const b = preimagenAuditoria({
      ...base,
      newData: { a: [{ x: 2, y: 1 }], z: { p: 2, q: 1 } },
    });
    expect(a).toBe(b);
  });

  it('el orden de los arrays es significativo', () => {
    const a = preimagenAuditoria({ ...base, newData: { l: [1, 2] } });
    const b = preimagenAuditoria({ ...base, newData: { l: [2, 1] } });
    expect(a).not.toBe(b);
  });

  it('cambiar cualquier campo cambia la preimagen', () => {
    const ref = preimagenAuditoria(base);
    for (const cambio of [
      { sequenceNumber: 6 },
      { action: 'delete' },
      { entityType: 'project' },
      { actorId: USUARIO },
      { correlationId: 'abcdefgh' },
      { occurredAt: '2026-11-15T09:30:00.001Z' },
      { previousHash: 'f'.repeat(64) },
    ]) {
      expect(preimagenAuditoria({ ...base, ...cambio })).not.toBe(ref);
    }
  });

  it('Date e ISO equivalente dan la misma preimagen', () => {
    expect(
      preimagenAuditoria({
        ...base,
        occurredAt: new Date('2026-11-15T09:30:00.000Z'),
      }),
    ).toBe(preimagenAuditoria(base));
  });

  it('fecha inválida lanza', () => {
    expect(() =>
      preimagenAuditoria({ ...base, occurredAt: 'no-es-fecha' }),
    ).toThrow();
  });
});

describe('audit-hash: nulos y casos límite (caso 53)', () => {
  it('undefined y null equivalen; las cuatro claves siempre presentes', () => {
    expect(normalizarPayloadAuditoria({})).toEqual({
      correlationId: null,
      meta: null,
      newData: null,
      oldData: null,
    });
    expect(
      normalizarPayloadAuditoria({ oldData: undefined, newData: null }),
    ).toEqual(
      normalizarPayloadAuditoria({ oldData: null, newData: undefined }),
    );
  });

  it('propiedad undefined se omite; undefined en array es null', () => {
    expect(normalizarDatoAuditoria({ a: undefined, b: 1 })).toEqual({ b: 1 });
    expect(normalizarDatoAuditoria([undefined, 1])).toEqual([null, 1]);
  });

  it('-0 se serializa como 0; exponentes como ECMAScript', () => {
    expect(JSON.stringify(normalizarDatoAuditoria({ n: -0 }))).toBe('{"n":0}');
    expect(JSON.stringify(normalizarDatoAuditoria({ n: 1e21, m: 1e-7 }))).toBe(
      '{"n":1e+21,"m":1e-7}',
    );
  });

  it('las fechas dentro de los datos pasan a ISO', () => {
    expect(
      normalizarDatoAuditoria({ f: new Date('2026-01-02T03:04:05.006Z') }),
    ).toEqual({ f: '2026-01-02T03:04:05.006Z' });
  });

  it('\u0000 se rechaza (valor, clave y anidado)', () => {
    expect(() => normalizarDatoAuditoria({ a: 'x\u0000y' })).toThrow();
    expect(() => normalizarDatoAuditoria({ 'k\u0000': 1 })).toThrow();
    expect(() => normalizarDatoAuditoria([{ a: ['\u0000'] }])).toThrow();
  });

  it('una barra invertida seguida de u0000 literal NO es un NUL', () => {
    const barra = String.fromCharCode(92);
    expect(() => normalizarDatoAuditoria({ a: `${barra}u0000` })).not.toThrow();
  });
});
