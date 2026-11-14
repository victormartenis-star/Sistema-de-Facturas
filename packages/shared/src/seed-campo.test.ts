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
  ORDEN_BORRADO_CAMPO,
  DEPENDENCIAS_FK_CAMPO,
  validarOrdenBorrado,
  esFilaCampo,
  filtrarFilasCampo,
  exigirSoloFilasCampo,
  columnasIdentificador,
  condicionSqlCampo,
  motivoAbortoPorDependientes,
  resumenLimpieza,
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
    expect(r).toEqual({
      ok: true,
      modo: 'simular',
      bd: 'erp_dev',
      limpiar: false,
    });
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

describe('decisión con --limpiar', () => {
  const base = { databaseUrl: URL_DEV, nodeEnv: 'development' };

  it('se parsea y sin --confirmar solo simula (lista lo que borraría)', () => {
    const args = parsearArgsSeedCampo(['--bd', 'erp_dev', '--limpiar']);
    expect(args.limpiar).toBe(true);
    expect(decidirEjecucionSeedCampo({ ...base, args })).toEqual({
      ok: true,
      modo: 'simular',
      bd: 'erp_dev',
      limpiar: true,
    });
  });

  it('borrar exige --confirmar y --api (después se siembra)', () => {
    const sinApi = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo([
        '--bd',
        'erp_dev',
        '--limpiar',
        '--confirmar',
      ]),
    });
    expect(sinApi.ok).toBe(false);
    const ok = decidirEjecucionSeedCampo({
      ...base,
      args: parsearArgsSeedCampo([
        '--bd',
        'erp_dev',
        '--limpiar',
        '--api',
        'http://localhost:3001',
        '--confirmar',
      ]),
    });
    expect(ok).toMatchObject({ ok: true, modo: 'escribir', limpiar: true });
  });

  it('mantiene --bd erp_dev, coincidencia con DATABASE_URL y NODE_ENV', () => {
    const args = parsearArgsSeedCampo(['--limpiar', '--bd', 'otra']);
    expect(decidirEjecucionSeedCampo({ ...base, args }).ok).toBe(false);
    const dist = parsearArgsSeedCampo(['--limpiar', '--bd', 'erp_dev']);
    expect(
      decidirEjecucionSeedCampo({
        args: dist,
        databaseUrl: 'postgres://erp:erp@localhost:5432/erp_prod',
        nodeEnv: 'development',
      }).ok,
    ).toBe(false);
    expect(
      decidirEjecucionSeedCampo({
        args: dist,
        databaseUrl: URL_DEV,
        nodeEnv: 'production',
      }).ok,
    ).toBe(false);
  });
});

describe('orden de borrado de la limpieza', () => {
  it('borra hijos antes que padres según las FK del schema', () => {
    expect(validarOrdenBorrado()).toEqual([]);
  });

  it('detecta un orden con el padre antes que el hijo', () => {
    const invertido = [...ORDEN_BORRADO_CAMPO].reverse();
    expect(validarOrdenBorrado(invertido).length).toBeGreaterThan(0);
  });

  it('detecta tablas repetidas o ausentes', () => {
    const [primera, ...resto] = ORDEN_BORRADO_CAMPO;
    expect(validarOrdenBorrado([primera, primera, ...resto])).toContain(
      'tabla repetida en el orden',
    );
    expect(
      validarOrdenBorrado(
        ORDEN_BORRADO_CAMPO.filter((t) => t.tabla !== 'projects'),
      ).some((e) => e.includes('ausente')),
    ).toBe(true);
  });

  it('cada tabla de las dependencias está en la lista y tiene motivo', () => {
    const nombres = new Set(ORDEN_BORRADO_CAMPO.map((t) => t.tabla));
    for (const [h, p] of DEPENDENCIAS_FK_CAMPO) {
      expect(nombres.has(h)).toBe(true);
      expect(nombres.has(p)).toBe(true);
    }
    for (const t of ORDEN_BORRADO_CAMPO)
      expect(t.motivo.length).toBeGreaterThan(0);
  });

  it('las raíces (obras, contactos, usuarios) van después de sus hijos', () => {
    const pos = (t: string) =>
      ORDEN_BORRADO_CAMPO.findIndex((x) => x.tabla === t);
    expect(pos('invoices')).toBeLessThan(pos('contacts'));
    expect(pos('delivery_notes')).toBeLessThan(pos('invoices'));
    expect(pos('delivery_notes')).toBeLessThan(pos('purchase_orders'));
    expect(pos('certifications')).toBeLessThan(pos('invoices'));
    expect(pos('project_phases')).toBeLessThan(pos('projects'));
    expect(pos('partes_personal')).toBeLessThan(pos('users'));
  });
});

describe('filtrado por prefijo CAMPO-', () => {
  const proyectos = ORDEN_BORRADO_CAMPO.find((t) => t.tabla === 'projects')!;
  const facturas = ORDEN_BORRADO_CAMPO.find((t) => t.tabla === 'invoices')!;
  const usuarios = ORDEN_BORRADO_CAMPO.find((t) => t.tabla === 'users')!;

  it('separa filas de campo y ajenas', () => {
    const r = filtrarFilasCampo(proyectos.criterio, [
      { code: 'CAMPO-A', name: 'x' },
      { code: 'OBRA-1', name: 'Obra uno' },
      { code: 'A-CAMPO-', name: 'CAMPO' },
    ]);
    expect(r.campo.map((f) => f.code)).toEqual(['CAMPO-A']);
    expect(r.ajenas).toHaveLength(2);
  });

  it('una rectificativa sin prefijo en el número se reconoce por su motivo', () => {
    expect(
      esFilaCampo(facturas.criterio, {
        invoice_number: 'R-2026-0001',
        rectification_reason: 'CAMPO-Rectificación total de prueba',
      }),
    ).toBe(true);
    expect(
      esFilaCampo(facturas.criterio, {
        invoice_number: 'R-2026-0002',
        rectification_reason: 'error real',
      }),
    ).toBe(false);
    expect(
      esFilaCampo(facturas.criterio, {
        invoice_number: 'F-1',
        rectification_reason: null,
      }),
    ).toBe(false);
  });

  it('los usuarios se reconocen por el email de campo, no por el nombre', () => {
    expect(
      esFilaCampo(usuarios.criterio, { email: emailCampo('lector') }),
    ).toBe(true);
    expect(esFilaCampo(usuarios.criterio, { email: 'admin@erp.test' })).toBe(
      false,
    );
    expect(esFilaCampo(usuarios.criterio, { email: 'campo-x@otra.com' })).toBe(
      false,
    );
    expect(esFilaCampo(usuarios.criterio, { email: 'campo-@erp.test' })).toBe(
      false,
    );
  });

  it('exigirSoloFilasCampo rechaza cualquier fila no-CAMPO', () => {
    expect(() =>
      exigirSoloFilasCampo(proyectos, [
        { code: 'CAMPO-A', name: 'CAMPO-Obra A' },
      ]),
    ).not.toThrow();
    expect(() =>
      exigirSoloFilasCampo(proyectos, [
        { code: 'CAMPO-A', name: 'x' },
        { code: 'REAL-1', name: 'Obra real' },
      ]),
    ).toThrow(/projects.*sin identificador CAMPO-/);
    expect(() =>
      exigirSoloFilasCampo(usuarios, [{ email: 'admin@erp.test' }]),
    ).toThrow();
  });
});

describe('condiciones SQL de la limpieza', () => {
  it('cada tabla con identificador usa starts_with con el prefijo o la regex de email', () => {
    expect(condicionSqlCampo('projects')).toBe(
      "(starts_with(code, 'CAMPO-') OR starts_with(name, 'CAMPO-'))",
    );
    expect(condicionSqlCampo('users')).toContain('campo-[a-z0-9-]+@erp\\.test');
    expect(columnasIdentificador(ORDEN_BORRADO_CAMPO[0])).toEqual([]);
  });

  it('los hijos sin identificador cuelgan de su padre de campo', () => {
    expect(condicionSqlCampo('invoice_lines')).toContain(
      "invoice_id IN (SELECT id FROM invoices WHERE (starts_with(invoice_number, 'CAMPO-')",
    );
    expect(condicionSqlCampo('refresh_tokens')).toContain('FROM users WHERE');
  });

  it('ninguna condición puede ser vacía ni selecciona todo', () => {
    for (const t of ORDEN_BORRADO_CAMPO) {
      const c = condicionSqlCampo(t.tabla);
      expect(c).toMatch(/CAMPO-|campo-/);
      expect(c).not.toMatch(/1 ?= ?1|TRUE/i);
    }
    expect(() => condicionSqlCampo('categories')).toThrow();
  });
});

describe('dependientes no-CAMPO', () => {
  it('no aborta sin bloqueos o con bloqueos de 0 filas', () => {
    expect(motivoAbortoPorDependientes([])).toBeNull();
    expect(
      motivoAbortoPorDependientes([
        {
          tablaDependiente: 'x',
          columna: 'c',
          tablaReferenciada: 'projects',
          filas: 0,
        },
      ]),
    ).toBeNull();
  });

  it('aborta con mensaje claro indicando tabla, columna y filas', () => {
    const m = motivoAbortoPorDependientes([
      {
        tablaDependiente: 'fichajes',
        columna: 'project_id',
        tablaReferenciada: 'projects',
        filas: 3,
      },
    ]);
    expect(m).toMatch(/No se borra nada/);
    expect(m).toMatch(/fichajes\.project_id -> projects \(3 fila/);
  });

  it('resumenLimpieza lista en orden de borrado solo las tablas con filas', () => {
    expect(
      resumenLimpieza({
        contacts: 3,
        projects: 2,
        project_phases: 6,
        invoices: 0,
      }),
    ).toEqual(['project_phases: 6', 'projects: 2', 'contacts: 3']);
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
    expect(m).not.toMatch(/no está implementado/);
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
