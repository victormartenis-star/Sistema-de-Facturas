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
  /**
   * Borrar lo CAMPO- previo antes de sembrar. Sin `--confirmar` solo lista lo
   * que borraría; con `--confirmar` borra (en transacción) y luego siembra.
   */
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
  | { ok: true; modo: 'simular'; bd: string; limpiar: boolean }
  | { ok: true; modo: 'escribir'; bd: string; api: string; limpiar: boolean }
  | { ok: false; error: string };

const HOSTS_LOCALES = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Decide si el seed simula o escribe, o aborta. Siempre exige `--bd erp_dev` y
 * que coincida con la base de la conexión (`DATABASE_URL`); escribir exige
 * además `--confirmar` y `--api` (local salvo `--permitir-remoto`). Con
 * `--limpiar` rige lo mismo: sin `--confirmar` solo simula (lista lo que se
 * borraría) y con `--confirmar` exige `--api`, porque tras limpiar se siembra
 * en la misma invocación (así nunca se borra sin poder volver a sembrar).
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
  if (!args.confirmar) {
    return { ok: true, modo: 'simular', bd: args.bd, limpiar: args.limpiar };
  }

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
  return {
    ok: true,
    modo: 'escribir',
    bd: args.bd,
    api: args.api,
    limpiar: args.limpiar,
  };
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
  return `Ya existen datos de campo (obra ${a}). El seed no se reejecuta sobre ellos: usa --limpiar (primero sin --confirmar para ver qué se borraría; después con --confirmar).`;
}

// ─── Limpieza (--limpiar) ───────────────────────────────────────────────────

/** Cómo se reconoce una fila como "de campo". */
export type CriterioFilaCampo =
  /** Alguna de las columnas de texto empieza por `CAMPO-`. */
  | { tipo: 'prefijo'; columnas: readonly string[] }
  /** El email cumple `esEmailCampo`. */
  | { tipo: 'email'; columna: string }
  /** Fila sin identificador propio: pertenece a una fila de campo ya seleccionada del padre. */
  | { tipo: 'hijo-de'; tabla: string; columna: string };

export interface TablaLimpiezaCampo {
  tabla: string;
  criterio: CriterioFilaCampo;
  /** Por qué ocupa esta posición en el orden de borrado. */
  motivo: string;
}

/**
 * Orden de borrado: HIJOS ANTES QUE PADRES, derivado de las claves foráneas de
 * `packages/db/src/schema.ts` (`DEPENDENCIAS_FK_CAMPO` lo recoge y un test lo
 * comprueba). Las auto-referencias (invoices.rectifies_invoice_id,
 * certifications.rectifies_certification_id) no obligan a subdividir: se borran
 * en una sola sentencia y Postgres comprueba la FK al final de la sentencia.
 */
export const ORDEN_BORRADO_CAMPO: readonly TablaLimpiezaCampo[] = [
  {
    tabla: 'refresh_tokens',
    criterio: { tipo: 'hijo-de', tabla: 'users', columna: 'user_id' },
    motivo: 'cuelga de users (sesiones de los usuarios de prueba)',
  },
  {
    tabla: 'user_project_access',
    criterio: { tipo: 'hijo-de', tabla: 'users', columna: 'user_id' },
    motivo: 'cuelga de users y projects (acceso a obras)',
  },
  {
    tabla: 'partes_personal',
    criterio: { tipo: 'prefijo', columnas: ['notes'] },
    motivo: 'referencia projects, project_phases y users (approved_by)',
  },
  {
    tabla: 'partes_maquinaria',
    criterio: { tipo: 'prefijo', columnas: ['notes'] },
    motivo: 'referencia projects, project_phases y users (approved_by)',
  },
  {
    tabla: 'delivery_notes',
    criterio: { tipo: 'prefijo', columnas: ['note_number'] },
    motivo:
      'referencia invoices, purchase_orders, projects, project_phases y contacts',
  },
  {
    tabla: 'certification_lines',
    criterio: {
      tipo: 'hijo-de',
      tabla: 'certifications',
      columna: 'certification_id',
    },
    motivo: 'cuelga de certifications y budget_items',
  },
  {
    tabla: 'certifications',
    criterio: { tipo: 'prefijo', columnas: ['notes'] },
    motivo: 'referencia invoices (invoice_id) y projects',
  },
  {
    tabla: 'payment_milestones',
    criterio: { tipo: 'hijo-de', tabla: 'invoices', columna: 'invoice_id' },
    motivo: 'cuelga de invoices',
  },
  {
    tabla: 'invoice_lines',
    criterio: { tipo: 'hijo-de', tabla: 'invoices', columna: 'invoice_id' },
    motivo: 'cuelga de invoices y referencia projects/project_phases',
  },
  {
    tabla: 'invoices',
    // Las rectificativas las numera la API (sin prefijo): se reconocen por su motivo CAMPO-.
    criterio: {
      tipo: 'prefijo',
      columnas: ['invoice_number', 'rectification_reason'],
    },
    motivo: 'referencia contacts; ya sin certifications ni delivery_notes',
  },
  {
    tabla: 'purchase_orders',
    criterio: { tipo: 'prefijo', columnas: ['description'] },
    motivo: 'referencia projects/contacts; ya sin delivery_notes',
  },
  {
    tabla: 'budget_items',
    criterio: { tipo: 'prefijo', columnas: ['code'] },
    motivo:
      'cuelga de budgets y referencia project_phases; ya sin certification_lines',
  },
  {
    tabla: 'budgets',
    criterio: { tipo: 'prefijo', columnas: ['name'] },
    motivo: 'cuelga de projects',
  },
  {
    tabla: 'project_phases',
    criterio: { tipo: 'prefijo', columnas: ['code'] },
    motivo:
      'cuelga de projects; ya sin partes, albaranes, pedidos ni budget_items',
  },
  {
    tabla: 'projects',
    criterio: { tipo: 'prefijo', columnas: ['code', 'name'] },
    motivo: 'raíz: todo lo anterior la referencia',
  },
  {
    tabla: 'users',
    criterio: { tipo: 'email', columna: 'email' },
    motivo:
      'referenciada por partes (approved_by) y accesos; referencia contacts',
  },
  {
    tabla: 'contact_compliance_docs',
    criterio: { tipo: 'hijo-de', tabla: 'contacts', columna: 'contact_id' },
    motivo: 'cuelga de contacts',
  },
  {
    tabla: 'compliance_waivers',
    criterio: { tipo: 'hijo-de', tabla: 'contacts', columna: 'contact_id' },
    motivo: 'cuelga de contacts',
  },
  {
    tabla: 'contacts',
    criterio: { tipo: 'prefijo', columnas: ['legal_name'] },
    motivo: 'raíz: facturas, albaranes, pedidos y users la referencian',
  },
];

/** Pares (hijo, padre) de claves foráneas del schema entre las tablas anteriores. */
export const DEPENDENCIAS_FK_CAMPO: readonly (readonly [string, string])[] = [
  ['refresh_tokens', 'users'],
  ['user_project_access', 'users'],
  ['user_project_access', 'projects'],
  ['partes_personal', 'projects'],
  ['partes_personal', 'project_phases'],
  ['partes_personal', 'users'],
  ['partes_maquinaria', 'projects'],
  ['partes_maquinaria', 'project_phases'],
  ['partes_maquinaria', 'users'],
  ['delivery_notes', 'invoices'],
  ['delivery_notes', 'purchase_orders'],
  ['delivery_notes', 'projects'],
  ['delivery_notes', 'project_phases'],
  ['delivery_notes', 'contacts'],
  ['certification_lines', 'certifications'],
  ['certification_lines', 'budget_items'],
  ['certifications', 'invoices'],
  ['certifications', 'projects'],
  ['payment_milestones', 'invoices'],
  ['invoice_lines', 'invoices'],
  ['invoice_lines', 'projects'],
  ['invoice_lines', 'project_phases'],
  ['invoices', 'contacts'],
  ['purchase_orders', 'projects'],
  ['purchase_orders', 'project_phases'],
  ['purchase_orders', 'contacts'],
  ['budget_items', 'budgets'],
  ['budget_items', 'project_phases'],
  ['budgets', 'projects'],
  ['project_phases', 'projects'],
  ['users', 'contacts'],
  ['contact_compliance_docs', 'contacts'],
  ['compliance_waivers', 'contacts'],
];

/** Errores si el orden deja algún padre antes que su hijo o hay tablas repetidas (vacío = válido). */
export function validarOrdenBorrado(
  orden: readonly TablaLimpiezaCampo[] = ORDEN_BORRADO_CAMPO,
  dependencias: readonly (readonly [string, string])[] = DEPENDENCIAS_FK_CAMPO,
): string[] {
  const errores: string[] = [];
  const pos = new Map(orden.map((t, i) => [t.tabla, i] as const));
  if (pos.size !== orden.length) errores.push('tabla repetida en el orden');
  for (const [hijo, padre] of dependencias) {
    const ih = pos.get(hijo);
    const ip = pos.get(padre);
    if (ih === undefined || ip === undefined) {
      errores.push(`${hijo} -> ${padre}: tabla ausente del orden`);
    } else if (ih >= ip) {
      errores.push(`${hijo} debe borrarse antes que ${padre}`);
    }
  }
  return errores;
}

/** ¿La fila (columna -> valor) es de campo según el criterio de su tabla? */
export function esFilaCampo(
  criterio: CriterioFilaCampo,
  fila: Readonly<Record<string, unknown>>,
): boolean {
  if (criterio.tipo === 'prefijo') {
    return criterio.columnas.some((c) => {
      const v = fila[c];
      return typeof v === 'string' && tienePrefijoCampo(v);
    });
  }
  if (criterio.tipo === 'email') {
    const v = fila[criterio.columna];
    return typeof v === 'string' && esEmailCampo(v);
  }
  // 'hijo-de': su pertenencia la decide la fila padre (condición SQL).
  return true;
}

/** Separa filas de campo y ajenas; las ajenas nunca deben borrarse. */
export function filtrarFilasCampo<T extends Record<string, unknown>>(
  criterio: CriterioFilaCampo,
  filas: readonly T[],
): { campo: T[]; ajenas: T[] } {
  const campo: T[] = [];
  const ajenas: T[] = [];
  for (const f of filas) (esFilaCampo(criterio, f) ? campo : ajenas).push(f);
  return { campo, ajenas };
}

/** Lanza si alguna fila a borrar no es de campo (defensa en profundidad). */
export function exigirSoloFilasCampo(
  tabla: TablaLimpiezaCampo,
  filas: readonly Record<string, unknown>[],
): void {
  const { ajenas } = filtrarFilasCampo(tabla.criterio, filas);
  if (ajenas.length > 0) {
    throw new Error(
      `${tabla.tabla}: ${ajenas.length} fila(s) sin identificador ${PREFIJO_CAMPO}; no se borra nada.`,
    );
  }
}

/** Columnas de identificador de negocio que el script debe leer para verificar. */
export function columnasIdentificador(tabla: TablaLimpiezaCampo): string[] {
  const c = tabla.criterio;
  if (c.tipo === 'prefijo') return [...c.columnas];
  if (c.tipo === 'email') return [c.columna];
  return [];
}

/**
 * Condición SQL (sin parámetros; solo constantes del código) que selecciona
 * las filas de campo de una tabla. Los hijos sin identificador propio se
 * seleccionan por su padre de campo, recursivamente.
 */
export function condicionSqlCampo(
  tabla: string,
  orden: readonly TablaLimpiezaCampo[] = ORDEN_BORRADO_CAMPO,
): string {
  const spec = orden.find((t) => t.tabla === tabla);
  if (!spec) throw new Error(`Tabla fuera de la limpieza: ${tabla}`);
  const c = spec.criterio;
  if (c.tipo === 'prefijo') {
    return `(${c.columnas
      .map((col) => `starts_with(${col}, '${PREFIJO_CAMPO}')`)
      .join(' OR ')})`;
  }
  if (c.tipo === 'email') {
    return `(${c.columna} ~ '^campo-[a-z0-9-]+@erp\\.test$')`;
  }
  return `(${c.columna} IN (SELECT id FROM ${c.tabla} WHERE ${condicionSqlCampo(c.tabla, orden)}))`;
}

/** Fila no-CAMPO que depende de una fila CAMPO- a borrar. */
export interface BloqueoLimpiezaCampo {
  tablaDependiente: string;
  columna: string;
  tablaReferenciada: string;
  filas: number;
}

/** Motivo de aborto si hay filas ajenas que dependen de filas CAMPO-, o null. */
export function motivoAbortoPorDependientes(
  bloqueos: readonly BloqueoLimpiezaCampo[],
): string | null {
  const reales = bloqueos.filter((b) => b.filas > 0);
  if (reales.length === 0) return null;
  const detalle = reales
    .map(
      (b) =>
        `${b.tablaDependiente}.${b.columna} -> ${b.tablaReferenciada} (${b.filas} fila(s))`,
    )
    .join('; ');
  return `No se borra nada: hay filas que no son de campo y dependen de datos ${PREFIJO_CAMPO}: ${detalle}. Resuélvelo a mano y reintenta.`;
}

/** Tabla de auditoría: sus filas se borran antes que las entidades que registran. */
export const TABLA_AUDITORIA_CAMPO = 'audit_log';

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ids (únicos) de las filas CAMPO- ya leídas, para localizar su auditoría.
 * Ignora las tablas sin ids leídos (`null`). Lanza si algún id no es un uuid,
 * para no pasar jamás basura a la consulta.
 */
export function idsAuditoriaCampo(
  idsPorTabla: Readonly<Record<string, readonly string[] | null>>,
): string[] {
  const unicos = new Set<string>();
  for (const [tabla, ids] of Object.entries(idsPorTabla)) {
    for (const id of ids ?? []) {
      if (!RE_UUID.test(id)) {
        throw new Error(`${tabla}: id no válido para auditoría (${id}).`);
      }
      unicos.add(id.toLowerCase());
    }
  }
  return [...unicos];
}

/** Fila de `audit_log` reducida a lo que decide si se borra. */
export interface FilaAuditoriaCampo {
  entity_id: string;
  company_id: string;
}

/**
 * Una fila de auditoría es de campo solo si su `entity_id` es el de una fila
 * CAMPO- a borrar Y su `company_id` es el de una empresa de esas filas.
 * Una fila con `entity_id` de campo pero otra empresa NO se toca.
 */
export function filtrarAuditoriaCampo<T extends FilaAuditoriaCampo>(
  filas: readonly T[],
  idsEntidad: readonly string[],
  idsEmpresa: readonly string[],
): { campo: T[]; ajenas: T[] } {
  const ent = new Set(idsEntidad.map((x) => x.toLowerCase()));
  const emp = new Set(idsEmpresa.map((x) => x.toLowerCase()));
  const campo: T[] = [];
  const ajenas: T[] = [];
  for (const f of filas) {
    const ok =
      ent.has(f.entity_id.toLowerCase()) && emp.has(f.company_id.toLowerCase());
    (ok ? campo : ajenas).push(f);
  }
  return { campo, ajenas };
}

/** Lanza si alguna fila de auditoría a borrar no cumple el filtro de campo. */
export function exigirSoloAuditoriaCampo(
  filas: readonly FilaAuditoriaCampo[],
  idsEntidad: readonly string[],
  idsEmpresa: readonly string[],
): void {
  const { ajenas } = filtrarAuditoriaCampo(filas, idsEntidad, idsEmpresa);
  if (ajenas.length > 0) {
    throw new Error(
      `${TABLA_AUDITORIA_CAMPO}: ${ajenas.length} fila(s) no corresponden a entidades de campo; no se borra nada.`,
    );
  }
}

/**
 * Líneas legibles `tabla: n` en orden de borrado (solo tablas con filas).
 * `audit_log` va primero: se borra antes que las entidades.
 */
export function resumenLimpieza(
  conteos: Readonly<Record<string, number>>,
): string[] {
  return [{ tabla: TABLA_AUDITORIA_CAMPO }, ...ORDEN_BORRADO_CAMPO]
    .filter((t) => (conteos[t.tabla] ?? 0) > 0)
    .map((t) => `${t.tabla}: ${conteos[t.tabla]}`);
}
