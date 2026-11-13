import { describe, expect, it } from 'vitest';
import {
  PREFIJO_CAMPO,
  conPrefijoCampo,
  decidirEjecucionSeedCampo,
  exigirEscritura,
  nombreBaseDeUrl,
  parsearArgsSeedCampo,
  tienePrefijoCampo,
} from './seed-campo';

const URL_DEV = 'postgres://erp:erp@localhost:5432/erp_dev';

describe('prefijo CAMPO-', () => {
  it('añade el prefijo una sola vez', () => {
    expect(PREFIJO_CAMPO).toBe('CAMPO-');
    expect(conPrefijoCampo('A')).toBe('CAMPO-A');
    expect(conPrefijoCampo('CAMPO-A')).toBe('CAMPO-A');
  });

  it('reconoce lo que lleva el prefijo', () => {
    expect(tienePrefijoCampo('CAMPO-F-001')).toBe(true);
    expect(tienePrefijoCampo('campo-f-001')).toBe(false);
    expect(tienePrefijoCampo('E2E-001')).toBe(false);
  });
});

describe('nombreBaseDeUrl', () => {
  it('extrae el nombre de la base', () => {
    expect(nombreBaseDeUrl(URL_DEV)).toBe('erp_dev');
    expect(nombreBaseDeUrl('postgresql://u:p@h:5432/erp_test?ssl=true')).toBe(
      'erp_test',
    );
  });

  it('devuelve null si no hay URL válida o nombre', () => {
    expect(nombreBaseDeUrl(undefined)).toBeNull();
    expect(nombreBaseDeUrl('')).toBeNull();
    expect(nombreBaseDeUrl('no es una url')).toBeNull();
    expect(nombreBaseDeUrl('postgres://u:p@h:5432')).toBeNull();
  });
});

describe('parsearArgsSeedCampo', () => {
  it('lee las opciones', () => {
    expect(
      parsearArgsSeedCampo([
        '--bd',
        'erp_dev',
        '--api',
        'http://localhost:3001',
        '--confirmar',
      ]),
    ).toEqual({
      bd: 'erp_dev',
      api: 'http://localhost:3001',
      confirmar: true,
      permitirRemoto: false,
    });
    expect(parsearArgsSeedCampo(['--bd=erp_dev']).bd).toBe('erp_dev');
  });

  it('sin opciones no confirma', () => {
    expect(parsearArgsSeedCampo([]).confirmar).toBe(false);
  });
});

describe('decidirEjecucionSeedCampo', () => {
  const base = { databaseUrl: URL_DEV, nodeEnv: 'development' };

  it('por defecto simula', () => {
    const r = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo(['--bd', 'erp_dev']),
    });
    expect(r).toEqual({ ok: true, modo: 'simular', bd: 'erp_dev' });
  });

  it('escribe solo con --confirmar y --api local', () => {
    const r = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo([
        '--bd',
        'erp_dev',
        '--api',
        'http://localhost:3001',
        '--confirmar',
      ]),
    });
    expect(r).toMatchObject({ ok: true, modo: 'escribir' });
  });

  it('aborta sin --bd', () => {
    const r = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo(['--confirmar']),
    });
    expect(r.ok).toBe(false);
  });

  it('aborta si --bd no es erp_dev', () => {
    const r = decidirEjecucionSeedCampo({
      databaseUrl: 'postgres://erp:erp@localhost:5432/erp_prod',
      nodeEnv: 'development',
      args: parsearArgsSeedCampo(['--bd', 'erp_prod']),
    });
    expect(r.ok).toBe(false);
  });

  it('aborta si --bd no coincide con la base de la conexión', () => {
    const r = decidirEjecucionSeedCampo({
      databaseUrl: 'postgres://erp:erp@localhost:5432/erp_test',
      nodeEnv: 'development',
      args: parsearArgsSeedCampo(['--bd', 'erp_dev']),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('erp_test');
  });

  it('aborta si no hay conexión legible', () => {
    const r = decidirEjecucionSeedCampo({
      databaseUrl: undefined,
      nodeEnv: 'development',
      args: parsearArgsSeedCampo(['--bd', 'erp_dev']),
    });
    expect(r.ok).toBe(false);
  });

  it('aborta en producción', () => {
    const r = decidirEjecucionSeedCampo({
      ...base,
      nodeEnv: 'production',
      args: parsearArgsSeedCampo(['--bd', 'erp_dev']),
    });
    expect(r.ok).toBe(false);
  });

  it('para escribir exige --api y que sea local salvo --permitir-remoto', () => {
    const sinApi = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo(['--bd', 'erp_dev', '--confirmar']),
    });
    expect(sinApi.ok).toBe(false);
    const remota = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo([
        '--bd',
        'erp_dev',
        '--api',
        'https://erp.ejemplo.es',
        '--confirmar',
      ]),
    });
    expect(remota.ok).toBe(false);
    const permitida = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo([
        '--bd',
        'erp_dev',
        '--api',
        'https://erp.ejemplo.es',
        '--confirmar',
        '--permitir-remoto',
      ]),
    });
    expect(permitida.ok).toBe(true);
  });
});

describe('exigirEscritura', () => {
  it('lanza en simulación y no en escritura', () => {
    expect(() => exigirEscritura('simular')).toThrow();
    expect(() => exigirEscritura('escribir')).not.toThrow();
  });
});
