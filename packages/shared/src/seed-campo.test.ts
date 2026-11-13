import { describe, expect, it } from 'vitest';
import {
  PREFIJO_CAMPO,
  conPrefijoCampo,
  decidirEjecucionSeedCampo,
  exigirEscritura,
  nombreBaseDeUrl,
  parsearArgsSeedCampo,
  tienePrefijoCampo,
  PERFILES_USUARIO_CAMPO,
  emailCampo,
  esEmailCampo,
  generarPasswordCampo,
  validarAsignacionesCampo,
  motivoAbortoPorExistentes,
} from './seed-campo';
import { userCreateSchema } from './auth';

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
      limpiar: false,
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

describe('--limpiar (no implementado)', () => {
  it('se parsea y la decisión aborta con mensaje claro', () => {
    const args = parsearArgsSeedCampo(['--bd', 'erp_dev', '--limpiar']);
    expect(args.limpiar).toBe(true);
    const r = decidirEjecucionSeedCampo({
      args,
      databaseUrl: URL_DEV,
      nodeEnv: 'development',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--limpiar.*no está implementado/);
  });
});

describe('motivoAbortoPorExistentes', () => {
  it('no aborta sin obras CAMPO- previas', () => {
    expect(motivoAbortoPorExistentes([])).toBeNull();
    expect(motivoAbortoPorExistentes(['OBRA-1', 'CAMPO-B'])).toBeNull();
  });

  it('aborta si ya existe CAMPO-A y explica --limpiar', () => {
    const m = motivoAbortoPorExistentes(['X', 'CAMPO-A']);
    expect(m).toMatch(/CAMPO-A/);
    expect(m).toMatch(/--limpiar/);
  });
});

describe('emails de campo', () => {
  it('construye y reconoce emails del dominio de prueba', () => {
    expect(emailCampo('lector')).toBe('campo-lector@erp.test');
    expect(esEmailCampo('campo-obra-a@erp.test')).toBe(true);
    expect(esEmailCampo('campo-x@empresa.es')).toBe(false);
    expect(esEmailCampo('admin@erp.test')).toBe(false);
  });
});

describe('generarPasswordCampo', () => {
  const bytes = (n: number, f: (i: number) => number) =>
    Uint8Array.from({ length: n }, (_, i) => f(i));

  it('cumple longitud y mezcla de clases, y la acepta el esquema de usuario', () => {
    const p = generarPasswordCampo(bytes(64, (i) => (i * 37 + 11) % 256));
    expect(p.length).toBeGreaterThanOrEqual(20);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[0-9]/);
    expect(p).not.toMatch(/\s/);
    expect(
      userCreateSchema.safeParse({
        email: 'campo-x@erp.test',
        password: p,
        fullName: 'x',
      }).success,
    ).toBe(true);
  });

  it('es determinista con los mismos bytes y distinta con otros', () => {
    const a = generarPasswordCampo(bytes(64, (i) => i * 3));
    expect(generarPasswordCampo(bytes(64, (i) => i * 3))).toBe(a);
    expect(generarPasswordCampo(bytes(64, (i) => i * 5 + 1))).not.toBe(a);
  });

  it('exige bytes suficientes', () => {
    expect(() => generarPasswordCampo(new Uint8Array(3))).toThrow();
  });
});

describe('validarAsignacionesCampo', () => {
  it('los perfiles por defecto son válidos: lector y una obra cada perfil obra', () => {
    expect(validarAsignacionesCampo(PERFILES_USUARIO_CAMPO)).toEqual([]);
    const lector = PERFILES_USUARIO_CAMPO.filter((p) => p.role === 'lector');
    const obra = PERFILES_USUARIO_CAMPO.filter((p) => p.role === 'obra');
    expect(lector).toHaveLength(1);
    expect(obra.flatMap((p) => p.obras).sort()).toEqual(['CAMPO-A', 'CAMPO-B']);
  });

  it('rechaza lector con obras, obra sin obras, email ajeno y duplicados', () => {
    const base = { email: 'campo-a@erp.test', fullName: 'a' };
    const errores = (p: Parameters<typeof validarAsignacionesCampo>[0]) =>
      validarAsignacionesCampo(p).join(' ');
    expect(errores([{ ...base, role: 'lector', obras: ['CAMPO-A'] }])).toMatch(
      /lector/,
    );
    expect(errores([{ ...base, role: 'obra', obras: [] }])).toMatch(/obra/);
    expect(
      errores([
        { ...base, email: 'a@otro.es', role: 'obra', obras: ['CAMPO-A'] },
      ]),
    ).toMatch(/email/);
    expect(errores([{ ...base, role: 'obra', obras: ['A'] }])).toMatch(
      /CAMPO-/,
    );
    expect(
      errores([
        { ...base, role: 'obra', obras: ['CAMPO-A'] },
        { ...base, role: 'obra', obras: ['CAMPO-B'] },
      ]),
    ).toMatch(/duplicado/);
  });

  it('rechaza roles que no sean lector u obra', () => {
    expect(
      validarAsignacionesCampo([
        { email: 'campo-g@erp.test', fullName: 'g', role: 'admin', obras: [] },
      ]).join(' '),
    ).toMatch(/rol/);
  });
});
