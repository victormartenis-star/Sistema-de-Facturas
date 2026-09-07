/**
 * Diagnóstico de la instalación.
 *
 *   npm run doctor
 *
 * Está pensado para el momento en que algo no arranca y no se sabe por qué.
 * Comprueba una cosa cada vez y, cuando falla, dice qué hacer, no solo qué
 * pasa: un «no se puede conectar» sin la orden para arrancar la base de datos
 * obliga a buscarla en un manual, que es justo lo que no se hace con prisa.
 *
 * No modifica nada. Se puede ejecutar tantas veces como haga falta.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const esWindows = process.platform === 'win32';

const ok = (m, detalle) => ({ estado: 'ok', m, detalle });
const aviso = (m, detalle, arreglo) => ({
  estado: 'aviso',
  m,
  detalle,
  arreglo,
});
const error = (m, detalle, arreglo) => ({
  estado: 'error',
  m,
  detalle,
  arreglo,
});

/** Lee el .env de la raíz sin depender de que alguien lo haya cargado. */
function leerEnv() {
  const ruta = resolve(RAIZ, '.env');
  if (!existsSync(ruta)) return null;
  const env = {};
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const comprobaciones = [];

/* ─────────────────────────── entorno ─────────────────────────── */

comprobaciones.push(() => {
  const mayor = Number(process.versions.node.split('.')[0]);
  if (mayor >= 20) return ok('Node.js', `v${process.versions.node}`);
  return error(
    'Node.js',
    `v${process.versions.node}: demasiado antiguo`,
    esWindows
      ? 'Añade la carpeta de Node portable al Path de la sesión antes de ejecutar nada.'
      : 'Instala Node 20 o superior.',
  );
});

comprobaciones.push(() => {
  if (existsSync(resolve(RAIZ, 'node_modules', '.package-lock.json'))) {
    return ok('Dependencias instaladas', 'node_modules al día');
  }
  if (existsSync(resolve(RAIZ, 'node_modules'))) {
    return aviso(
      'Dependencias instaladas',
      'node_modules existe pero no parece completo',
      'Ejecuta: npm install',
    );
  }
  return error(
    'Dependencias instaladas',
    'falta node_modules',
    'Ejecuta: npm install',
  );
});

comprobaciones.push(() => {
  const dist = resolve(RAIZ, 'packages/shared/dist/index.js');
  return existsSync(dist)
    ? ok('Paquetes compartidos compilados', 'packages/shared/dist')
    : error(
        'Paquetes compartidos compilados',
        'falta packages/shared/dist',
        'Ejecuta: npm run build:packages',
      );
});

/* ───────────────────────── configuración ───────────────────────── */

comprobaciones.push(() => {
  const env = leerEnv();
  if (!env) {
    return error(
      'Fichero .env',
      'no existe en la raíz del proyecto',
      'Copia .env.example a .env y ajusta DATABASE_URL y JWT_SECRET.',
    );
  }
  if (!env.DATABASE_URL) {
    return error('Fichero .env', 'falta DATABASE_URL', 'Añádelo al .env.');
  }
  return ok('Fichero .env', 'presente, con DATABASE_URL');
});

comprobaciones.push(() => {
  const env = leerEnv() ?? {};
  const secreto = process.env.JWT_SECRET ?? env.JWT_SECRET ?? '';
  if (secreto.length >= 32) {
    return ok('JWT_SECRET', `${secreto.length} caracteres`);
  }
  if (secreto.length === 0) {
    return aviso(
      'JWT_SECRET',
      'sin definir: en desarrollo se genera una temporal y las sesiones se pierden en cada reinicio',
      "Genera una: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\" y ponla en el .env.",
    );
  }
  return error(
    'JWT_SECRET',
    `solo ${secreto.length} caracteres: hacen falta 32`,
    'Genera una más larga y sustitúyela en el .env.',
  );
});

/* ────────────────────────── base de datos ────────────────────────── */

comprobaciones.push(async () => {
  const env = leerEnv() ?? {};
  const url = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!url) return null; // ya lo ha dicho la comprobación del .env

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    return aviso(
      'Conexión con PostgreSQL',
      'no se ha podido cargar el cliente de base de datos',
      'Ejecuta: npm install',
    );
  }

  const cliente = new Client({
    connectionString: url,
    connectionTimeoutMillis: 4000,
  });
  try {
    await cliente.connect();
  } catch (e) {
    const motivo = String(e.message ?? e);
    const noArranca =
      motivo.includes('ECONNREFUSED') || motivo.includes('timeout');
    return error(
      'Conexión con PostgreSQL',
      motivo.split('\n')[0],
      noArranca
        ? esWindows
          ? 'Arranca la base de datos: scripts\\windows\\arrancar-bd.ps1'
          : 'Arranca PostgreSQL y vuelve a intentarlo.'
        : 'Revisa usuario, contraseña y nombre de base de datos en DATABASE_URL.',
    );
  }

  try {
    const version = await cliente.query('show server_version');
    const migraciones = await cliente
      .query('select count(*)::int as n from drizzle.__drizzle_migrations')
      .catch(() => null);

    const carpeta = resolve(RAIZ, 'packages/db/drizzle');
    const enDisco = existsSync(carpeta)
      ? readdirSync(carpeta).filter((f) => f.endsWith('.sql')).length
      : 0;

    if (migraciones === null) {
      return error(
        'Migraciones aplicadas',
        'la base de datos está vacía',
        'Ejecuta: npm run db:migrate && npm run db:seed',
      );
    }
    const aplicadas = migraciones.rows[0].n;
    if (aplicadas < enDisco) {
      return error(
        'Migraciones aplicadas',
        `${aplicadas} de ${enDisco}`,
        'Ejecuta: npm run db:migrate',
      );
    }
    return ok(
      'Base de datos',
      `PostgreSQL ${version.rows[0].server_version} · ${aplicadas} migraciones aplicadas`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
});

comprobaciones.push(async () => {
  const env = leerEnv() ?? {};
  const url = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!url) return null;
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    return null;
  }
  const cliente = new Client({
    connectionString: url,
    connectionTimeoutMillis: 4000,
  });
  try {
    await cliente.connect();
  } catch {
    return null; // ya se ha avisado arriba
  }
  try {
    const usuarios = await cliente
      .query('select count(*)::int as n from users')
      .catch(() => null);
    if (usuarios === null) return null;
    if (usuarios.rows[0].n === 0) {
      return error(
        'Usuarios dados de alta',
        'ninguno: no se puede entrar al sistema',
        'Ejecuta: npm run db:seed',
      );
    }
    const obras = await cliente.query(
      'select count(*)::int as n from projects',
    );
    return ok(
      'Datos',
      `${usuarios.rows[0].n} usuario(s) · ${obras.rows[0].n} obra(s)`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
});

/* ─────────────────────────── ejecución ─────────────────────────── */

const ICONO = { ok: '  OK  ', aviso: ' AVISO', error: ' FALLO' };

console.log('\nDiagnóstico del ERP\n');

let fallos = 0;
let avisos = 0;

for (const comprobacion of comprobaciones) {
  const r = await comprobacion();
  if (!r) continue;
  console.log(`[${ICONO[r.estado]}] ${r.m}: ${r.detalle}`);
  if (r.arreglo) console.log(`          → ${r.arreglo}`);
  if (r.estado === 'error') fallos++;
  if (r.estado === 'aviso') avisos++;
}

console.log('');
if (fallos > 0) {
  console.log(
    `${fallos} problema(s) que impiden usar el sistema. Resuélvelos en el orden en que aparecen: el primero suele ser la causa de los demás.`,
  );
  process.exitCode = 1;
} else if (avisos > 0) {
  console.log(`Todo funciona, con ${avisos} aviso(s) que conviene mirar.`);
} else {
  console.log('Todo en orden.');
}
console.log('');
