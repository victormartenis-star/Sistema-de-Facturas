import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extraerMutacionesApi,
  mutacionesSinPermiso,
  tieneControlDePermisos,
} from './barrido-permisos-ui';

const API_FAKE = `
export const fooApi = {
  list: () => request<X[]>('/foo'),
  create: (i: I) =>
    request<X>('/foo', {
      method: 'POST',
      body: JSON.stringify(i),
    }),
  remove: (id: string) => request<void>('/foo/' + id, { method: 'DELETE' }),
  subir: (form: FormData) => request<X>('/foo/up', { method: 'POST', body: form }),
};
export const barApi = {
  get: (id: string) => request<X>('/bar/' + id),
};
`;

describe('extraerMutacionesApi', () => {
  it('detecta solo los métodos de escritura', () => {
    expect(extraerMutacionesApi(API_FAKE)).toEqual([
      'fooApi.create',
      'fooApi.remove',
      'fooApi.subir',
    ]);
  });
});

describe('mutacionesSinPermiso', () => {
  const muts = ['fooApi.create', 'fooApi.remove'];

  it('marca una llamada de mutación sin control de permisos', () => {
    const src = `const m = useMutation({ mutationFn: (v) => fooApi.create(v) });`;
    expect(mutacionesSinPermiso(src, muts)).toEqual(['fooApi.create']);
  });

  it('acepta <Autorizado> o can( en el mismo fichero', () => {
    const base = `mutationFn: () => fooApi.remove(id)`;
    const conAutorizado = `${base}\n<Autorizado accion="borrar">x</Autorizado>`;
    expect(mutacionesSinPermiso(conAutorizado, muts)).toEqual([]);
    expect(
      mutacionesSinPermiso(`${base}\nif (can('borrar')) {}`, muts),
    ).toEqual([]);
    expect(
      mutacionesSinPermiso(`${base}\nif (puede('borrar')) {}`, muts),
    ).toEqual([]);
  });

  it('ignora llamadas solo de lectura y las que están en comentarios', () => {
    expect(mutacionesSinPermiso(`fooApi.list()`, muts)).toEqual([]);
    expect(mutacionesSinPermiso(`// fooApi.create(x)`, muts)).toEqual([]);
  });

  it('detecta una escritura HTTP directa', () => {
    const src = `fetch(u, { method: 'POST' })`;
    expect(mutacionesSinPermiso(src, muts)).toEqual([
      '<escritura HTTP directa>',
    ]);
  });

  it('tieneControlDePermisos no se deja engañar por palabras parecidas', () => {
    expect(tieneControlDePermisos('const canvas = 1; scan(x)')).toBe(false);
  });
});

// ── Barrido real sobre apps/web ─────────────────────────────────────────────

const WEB_SRC = resolve(__dirname, '../../../apps/web/src');

/**
 * Excepciones EXPLÍCITAS y motivadas (ruta relativa a apps/web/src → motivo).
 * Un fichero aquí llama a una mutación sin control de permisos propio.
 */
const EXCEPCIONES: Record<string, string> = {
  'components/order-form-modal.tsx':
    'Modal de pedido: solo se abre desde app/pedidos/page.tsx, que oculta el disparador con <Autorizado accion="crear">.',
};

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return ruta.endsWith('.tsx') ? [ruta] : [];
  });
}

describe('barrido de permisos de UI en apps/web', () => {
  const apiSource = readFileSync(join(WEB_SRC, 'lib/api.ts'), 'utf8');
  // authApi (login/registro/refresh/logout) es de sesión y vive en lib/auth.tsx,
  // fuera de app/ y components/: el lector también inicia y cierra sesión.
  const mutaciones = extraerMutacionesApi(apiSource).filter(
    (m) => !m.startsWith('authApi.'),
  );

  it('encuentra las mutaciones de api.ts (el barrido no está vacío)', () => {
    expect(mutaciones.length).toBeGreaterThan(100);
    expect(mutaciones).toContain('projectsApi.create');
    expect(mutaciones).toContain('comparativosApi.adjudicar');
  });

  const candidatos = [
    ...ficheros(join(WEB_SRC, 'app')),
    ...ficheros(join(WEB_SRC, 'components')),
  ].map((f) => relative(WEB_SRC, f).split(sep).join('/'));

  it('ninguna pantalla ni componente llama a una mutación sin permisos', () => {
    expect(candidatos.length).toBeGreaterThan(40);
    const infractores: string[] = [];
    for (const rel of candidatos) {
      if (rel in EXCEPCIONES) continue;
      const faltan = mutacionesSinPermiso(
        readFileSync(join(WEB_SRC, rel), 'utf8'),
        mutaciones,
      );
      if (faltan.length > 0) infractores.push(`${rel}: ${faltan.join(', ')}`);
    }
    expect(infractores).toEqual([]);
  });

  it('cada excepción existe y sigue llamando a una mutación', () => {
    for (const rel of Object.keys(EXCEPCIONES)) {
      const fuente = readFileSync(join(WEB_SRC, rel), 'utf8');
      expect(fuente.length, rel).toBeGreaterThan(0);
      const llamadas = mutaciones.filter((m) => fuente.includes(`${m}(`));
      expect(
        llamadas.length,
        `${rel} ya no necesita excepción`,
      ).toBeGreaterThan(0);
    }
  });
});
