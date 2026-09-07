/**
 * Copias de seguridad de la base de datos.
 *
 *   npm run copia:crear                 → copias/erp-AAAA-MM-DD-HHMM.dump
 *   npm run copia:restaurar -- <fichero>
 *
 * Lo primero que hay que tener resuelto antes de meter datos de verdad. Un
 * ERP de obra acumula meses de albaranes, certificaciones y expedientes que
 * nadie va a volver a teclear: el día que se pierdan, se pierden.
 *
 * Se apoya en pg_dump y pg_restore, que vienen con PostgreSQL. Se usa el
 * formato comprimido de Postgres (-Fc) en lugar de SQL plano porque permite
 * restaurar sin recrear la base a mano y ocupa mucho menos.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARPETA = process.env.ERP_BACKUP_DIR ?? resolve(RAIZ, 'copias');

function leerEnv() {
  const ruta = resolve(RAIZ, '.env');
  if (!existsSync(ruta)) return {};
  const env = {};
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Descompone la URL de conexión en lo que necesitan pg_dump y pg_restore. */
function conexion() {
  const env = leerEnv();
  const url = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!url) {
    console.error(
      'No hay DATABASE_URL: revisa el .env de la raíz del proyecto.',
    );
    process.exit(1);
  }
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/** Ejecuta una herramienta de PostgreSQL pasándole la contraseña por entorno. */
function ejecutar(orden, args, password) {
  return new Promise((resolveP) => {
    const hijo = spawn(orden, args, {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: password },
      shell: process.platform === 'win32',
    });
    hijo.on('error', (e) => {
      if (e.code === 'ENOENT') {
        console.error(
          `\nNo se encuentra «${orden}». Viene con PostgreSQL: añade su carpeta bin al Path de la sesión.`,
        );
        console.error('En este PC: C:\\Users\\Victor\\Tools\\pgsql\\bin\n');
      } else {
        console.error(e);
      }
      process.exit(1);
    });
    hijo.on('close', (code) => resolveP(code ?? 1));
  });
}

const marcaDeTiempo = () =>
  new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

async function crear() {
  const c = conexion();
  mkdirSync(CARPETA, { recursive: true });
  const fichero = join(CARPETA, `erp-${marcaDeTiempo()}.dump`);

  console.log(`Copiando ${c.database} → ${fichero}`);
  const code = await ejecutar(
    'pg_dump',
    [
      '-h',
      c.host,
      '-p',
      c.port,
      '-U',
      c.user,
      '-d',
      c.database,
      '-Fc',
      '-f',
      fichero,
    ],
    c.password,
  );
  if (code !== 0) {
    console.error('\nLa copia ha fallado. No borres la anterior.');
    process.exit(code);
  }
  const tam = (statSync(fichero).size / 1024 / 1024).toFixed(1);
  console.log(`\nCopia creada: ${fichero} (${tam} MB)`);
  console.log(
    'Guárdala fuera de este ordenador. Una copia que vive en el mismo disco que el original no es una copia de seguridad.',
  );
}

async function restaurar(fichero) {
  if (!fichero) {
    console.error(
      'Falta el fichero. Uso: npm run copia:restaurar -- <fichero>',
    );
    listar();
    process.exit(1);
  }
  const ruta = resolve(fichero);
  if (!existsSync(ruta)) {
    console.error(`No existe el fichero ${ruta}`);
    process.exit(1);
  }

  const c = conexion();
  console.log(
    `\nATENCIÓN: esto reemplaza el contenido actual de «${c.database}» por el de la copia.`,
  );
  console.log('Lo que haya ahora y no esté en la copia se pierde.\n');

  // Confirmación explícita: restaurar encima de datos buenos es la forma más
  // rápida de convertir un susto en una pérdida.
  if (process.env.ERP_CONFIRMAR_RESTAURACION !== 'si') {
    console.error(
      'Para confirmar, vuelve a lanzarlo con la variable ERP_CONFIRMAR_RESTAURACION=si',
    );
    console.error(
      'PowerShell:  $env:ERP_CONFIRMAR_RESTAURACION="si"; npm run copia:restaurar -- ' +
        fichero,
    );
    process.exit(1);
  }

  console.log(`Restaurando ${ruta} → ${c.database}`);
  const code = await ejecutar(
    'pg_restore',
    [
      '-h',
      c.host,
      '-p',
      c.port,
      '-U',
      c.user,
      '-d',
      c.database,
      '--clean',
      '--if-exists',
      '--no-owner',
      ruta,
    ],
    c.password,
  );
  if (code !== 0) {
    console.error(
      '\nLa restauración ha terminado con errores. Revísalos antes de dar la base por buena.',
    );
    process.exit(code);
  }
  console.log('\nRestauración terminada. Comprueba con: npm run doctor');
}

function listar() {
  if (!existsSync(CARPETA)) {
    console.log(`\nNo hay copias en ${CARPETA}.`);
    return;
  }
  const copias = readdirSync(CARPETA)
    .filter((f) => f.endsWith('.dump'))
    .sort()
    .reverse();
  if (copias.length === 0) {
    console.log(`\nNo hay copias en ${CARPETA}.`);
    return;
  }
  console.log(`\nCopias disponibles en ${CARPETA}:`);
  for (const f of copias.slice(0, 10)) {
    const tam = (statSync(join(CARPETA, f)).size / 1024 / 1024).toFixed(1);
    console.log(`  ${f}  (${tam} MB)`);
  }
}

const [accion, argumento] = process.argv.slice(2);
if (accion === 'crear') await crear();
else if (accion === 'restaurar') await restaurar(argumento);
else if (accion === 'listar') listar();
else {
  console.log('Uso:');
  console.log('  npm run copia:crear');
  console.log('  npm run copia:restaurar -- <fichero>');
  console.log('  node scripts/copia.mjs listar');
}
