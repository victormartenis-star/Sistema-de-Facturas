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
}

export function parsearArgsSeedCampo(argv: readonly string[]): ArgsSeedCampo {
  const args: ArgsSeedCampo = { confirmar: false, permitirRemoto: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirmar') args.confirmar = true;
    else if (a === '--permitir-remoto') args.permitirRemoto = true;
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
