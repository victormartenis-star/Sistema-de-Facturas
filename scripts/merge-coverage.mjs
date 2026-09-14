#!/usr/bin/env node
/**
 * Reporte de cobertura unificado (Fase 9): junta la cobertura de
 * `packages/shared` (vitest + @vitest/coverage-v8) y de las pruebas de
 * integración de `apps/api` (jest, ts-jest instrumenta con Istanbul) en
 * un único informe, con `nyc` (la CLI de Istanbul) — ambas herramientas
 * escriben `coverage-final.json` en el mismo esquema de Istanbul, así que
 * fusionarlas es correcto, no un apaño: es el mismo formato, dos orígenes
 * distintos.
 *
 * Deliberadamente NO incluye la suite de Playwright (`apps/e2e`): esa es
 * E2E de caja negra sobre el navegador, no ejecuta el código fuente de
 * `apps/api` instrumentado — medir su "cobertura" exigiría inyectar
 * `__coverage__` en el bundle servido (herramientas tipo
 * `monocart-coverage-reports`), un trabajo bastante mayor y aparte que no
 * entraba en esta fase. `npm run e2e` verifica esos flujos por su cuenta,
 * sin aportar un número de cobertura al informe de aquí.
 *
 * Uso: `npm run test:coverage` (raíz) — encadena vitest + jest y termina
 * llamando a este script.
 */
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const MERGE_INPUT = resolve(ROOT, '.coverage-merge-input');
const OUT_DIR = resolve(ROOT, 'coverage');

const SOURCES = [
  {
    name: 'shared',
    file: resolve(ROOT, 'packages/shared/coverage/coverage-final.json'),
  },
  {
    name: 'api-integration',
    file: resolve(ROOT, 'apps/api/coverage/coverage-final.json'),
  },
];

function fail(message) {
  console.error(`\nmerge-coverage: ${message}`);
  process.exit(1);
}

rmSync(MERGE_INPUT, { recursive: true, force: true });
mkdirSync(MERGE_INPUT, { recursive: true });

for (const source of SOURCES) {
  if (!existsSync(source.file)) {
    fail(
      `falta ${source.file} — ejecuta antes \`npm run test:coverage -w @erp/shared\` ` +
        `y \`npm run test:integration:coverage -w @erp/api\` (o usa \`npm run test:coverage\` ` +
        `en la raíz, que ya los encadena).`,
    );
  }
  copyFileSync(source.file, resolve(MERGE_INPUT, `${source.name}.json`));
}

rmSync(OUT_DIR, { recursive: true, force: true });

// `shell: true` hace falta en Windows para resolver `npx.cmd`, pero con
// `shell: true` Node no cita automáticamente los argumentos del array al
// construir la línea de comandos — con espacios en la ruta (nombres de
// carpeta de este repo los llevan) cmd.exe los trocea en argumentos de
// más. Se citan a mano aquí, no por estilo.
const quote = (arg) => (/\s/.test(arg) ? `"${arg}"` : arg);
const args = [
  'nyc',
  'report',
  '--temp-dir',
  MERGE_INPUT,
  '--report-dir',
  OUT_DIR,
  '--reporter',
  'text',
  '--reporter',
  'html',
  '--reporter',
  'lcov',
].map(quote);

const result = spawnSync('npx', args, {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  fail('`nyc report` terminó con error — ver la salida de arriba.');
}

console.log(
  `\nInforme de cobertura unificado (packages/shared + apps/api integración) en ${resolve(
    OUT_DIR,
    'index.html',
  )}\n`,
);
