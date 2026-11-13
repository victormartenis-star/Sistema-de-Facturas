/**
 * Lógica pura del script `scripts/seed-campo.ts` (datos de pruebas de campo).
 * Sin red, sin entorno y sin reloj: todo entra por parámetro, de modo que las
 * salvaguardas se prueban sin tocar ninguna base de datos.
 */

/** Todo lo que crea el seed de campo lleva este prefijo (identificable y borrable). */
export const PREFIJO_CAMPO = 'CAMPO-';

/** Única base de datos en la que el seed puede escribir. */
export const BD_PERMITIDA_SEED_CAMPO = 'erp_dev';

export function conPrefijoCampo(clave: string): string {
  return tienePrefijoCampo(clave) ? clave : `${PREFIJO_CAMPO}${clave}`;
}

export function tienePrefijoCampo(clave: string): boolean {
  return clave.startsWith(PREFIJO_CAMPO);
}

/** Nombre de la base de datos de una URL de conexión Postgres, o null. */
export function nombreBaseDeUrl(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const nombre = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  return nombre === '' ? null : nombre;
}

export interface ArgsSeedCampo {
  bd?: string;
  api?: string;
  confirmar: boolean;
  permitirRemoto: boolean;
  /** Reservado: borrar lo CAMPO- previo. Aún no implementado (el seed aborta). */
  limpiar: boolean;
}

export function parsearArgsSeedCampo(argv: readonly string[]): ArgsSeedCampo {
  const args: ArgsSeedCampo = {
    confirmar: false,
    permitirRemoto: false,
    limpiar: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirmar') args.confirmar = true;
    else if (a === '--permitir-remoto') args.permitirRemoto = true;
    else if (a === '--limpiar') args.limpiar = true;
    else if (a === '--bd') args.bd = argv[++i];
    else if (a.startsWith('--bd=')) args.bd = a.slice('--bd='.length);
    else if (a === '--api') args.api = argv[++i];
    else if (a.startsWith('--api=')) args.api = a.slice('--api='.length);
  }
  return args;
}

export type ModoSeedCampo = 'simular' | 'escribir';

export type DecisionSeedCampo =
  | { ok: true; modo: 'simular'; bd: string }
  | { ok: true; modo: 'escribir'; bd: string; api: string }
  | { ok: false; error: string };

const HOSTS_LOCALES = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Decide si el seed simula o escribe, o aborta. Siempre exige `--bd erp_dev` y
 * que coincida con la base de la conexión (`DATABASE_URL`); escribir exige
 * además `--confirmar` y `--api` (local salvo `--permitir-remoto`).
 */
export function decidirEjecucionSeedCampo(entrada: {
  args: ArgsSeedCampo;
  databaseUrl: string | undefined;
  nodeEnv: string | undefined;
}): DecisionSeedCampo {
  const { args, databaseUrl, nodeEnv } = entrada;
  if (nodeEnv === 'production') {
    return { ok: false, error: 'NODE_ENV=production: el seed no se ejecuta.' };
  }
  if (args.bd !== BD_PERMITIDA_SEED_CAMPO) {
    return {
      ok: false,
      error: `Indica --bd ${BD_PERMITIDA_SEED_CAMPO} (único destino permitido).`,
    };
  }
  if (args.limpiar) {
    return {
      ok: false,
      error: '--limpiar todavía no está implementado: el seed no borra datos.',
    };
  }
  const real = nombreBaseDeUrl(databaseUrl);
  if (real === null) {
    return {
      ok: false,
      error: 'DATABASE_URL no está definida o no tiene nombre de base.',
    };
  }
  if (real !== args.bd) {
    return {
      ok: false,
      error: `--bd ${args.bd} no coincide con la base de DATABASE_URL (${real}).`,
    };
  }
  if (!args.confirmar) return { ok: true, modo: 'simular', bd: args.bd };

  if (!args.api) {
    return { ok: false, error: 'Para escribir indica --api <url> explícito.' };
  }
  let host: string;
  try {
    host = new URL(args.api).hostname;
  } catch {
    return { ok: false, error: `--api no es una URL válida: ${args.api}` };
  }
  if (!args.permitirRemoto && !HOSTS_LOCALES.includes(host)) {
    return {
      ok: false,
      error: `La API (${host}) no es local; usa --permitir-remoto si es intencionado.`,
    };
  }
  return { ok: true, modo: 'escribir', bd: args.bd, api: args.api };
}

/** Toda escritura pasa por aquí: en simulación lanza. */
export function exigirEscritura(modo: ModoSeedCampo): void {
  if (modo !== 'escribir') {
    throw new Error('Simulación: no se permite escribir sin --confirmar.');
  }
}

// ─── Usuarios de prueba, existentes e idempotencia ──────────────────────────

/** Dominio reservado a las cuentas de prueba del seed. */
export const DOMINIO_EMAIL_CAMPO = 'erp.test';

export function emailCampo(clave: string): string {
  return `campo-${clave}@${DOMINIO_EMAIL_CAMPO}`;
}

export function esEmailCampo(email: string): boolean {
  return /^campo-[a-z0-9-]+@erp.test$/.test(email);
}

export interface PerfilUsuarioCampo {
  email: string;
  fullName: string;
  role: string;
  /** Códigos de obra (con prefijo) a los que se da acceso; solo rol `obra`. */
  obras: string[];
}

export const PERFILES_USUARIO_CAMPO: PerfilUsuarioCampo[] = [
  {
    email: emailCampo('lector'),
    fullName: 'CAMPO- Lector',
    role: 'lector',
    obras: [],
  },
  {
    email: emailCampo('obra-a'),
    fullName: 'CAMPO- Jefe de obra A',
    role: 'obra',
    obras: [conPrefijoCampo('A')],
  },
  {
    email: emailCampo('obra-b'),
    fullName: 'CAMPO- Jefe de obra B',
    role: 'obra',
    obras: [conPrefijoCampo('B')],
  },
];

/** Errores de coherencia de los perfiles (vacío si todo está bien). */
export function validarAsignacionesCampo(
  perfiles: readonly PerfilUsuarioCampo[],
): string[] {
  const errores: string[] = [];
  const vistos = new Set<string>();
  for (const p of perfiles) {
    if (!esEmailCampo(p.email)) {
      errores.push(
        `${p.email}: el email debe ser campo-*@${DOMINIO_EMAIL_CAMPO}`,
      );
    }
    if (vistos.has(p.email)) errores.push(`${p.email}: email duplicado`);
    vistos.add(p.email);
    if (p.role !== 'lector' && p.role !== 'obra') {
      errores.push(
        `${p.email}: rol ${p.role} no permitido (solo lector u obra)`,
      );
    } else if (p.role === 'lector' && p.obras.length > 0) {
      errores.push(`${p.email}: un lector no lleva obras asignadas`);
    } else if (p.role === 'obra' && p.obras.length === 0) {
      errores.push(`${p.email}: un perfil obra necesita al menos una obra`);
    }
    for (const o of p.obras) {
      if (!tienePrefijoCampo(o)) {
        errores.push(
          `${p.email}: la obra ${o} no lleva el prefijo ${PREFIJO_CAMPO}`,
        );
      }
    }
  }
  return errores;
}

const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITOS = '23456789';
const LONGITUD_PASSWORD_CAMPO = 24;

/**
 * Contraseña a partir de bytes aleatorios aportados por el llamador (puro:
 * no genera aleatoriedad). Garantiza minúscula, mayúscula y dígito.
 */
export function generarPasswordCampo(bytes: Uint8Array): string {
  if (bytes.length < LONGITUD_PASSWORD_CAMPO) {
    throw new Error(
      `Se necesitan ${LONGITUD_PASSWORD_CAMPO} bytes aleatorios.`,
    );
  }
  const todo = MINUSCULAS + MAYUSCULAS + DIGITOS;
  const clases = [MINUSCULAS, MAYUSCULAS, DIGITOS];
  let out = '';
  for (let i = 0; i < LONGITUD_PASSWORD_CAMPO; i++) {
    const alfabeto = i < clases.length ? clases[i] : todo;
    out += alfabeto[bytes[i] % alfabeto.length];
  }
  // Baraja determinista con los bytes sobrantes (o los mismos) para no fijar posiciones.
  const chars = out.split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[(i + LONGITUD_PASSWORD_CAMPO) % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Motivo de aborto si ya existe la obra CAMPO-A (idempotencia), o null. */
export function motivoAbortoPorExistentes(
  codigosObra: readonly string[],
): string | null {
  const a = conPrefijoCampo('A');
  if (!codigosObra.includes(a)) return null;
  return `Ya existen datos de campo (obra ${a}). El seed no se reejecuta; borrarlos con --limpiar aún no está implementado.`;
}
