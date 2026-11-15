#!/usr/bin/env node
/**
 * Sella las filas históricas de `audit_log` (las anteriores a la cadena hash,
 * migración 0039) de todas las empresas pendientes. Es la misma función que
 * ejecuta la API al arrancar (`sellarLegado`), idempotente y reanudable: sirve
 * para ejecutarlo a mano tras migrar un entorno con muchos datos.
 *
 * Uso (tras `npm run build:packages`):
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env scripts/sellar-auditoria.ts
 * Conexión: DATABASE_URL. Requiere Node >= 22.18 (ejecuta TypeScript directamente).
 */
import { closeDb, getDb } from '@erp/db';
import {
  empresasPendientesDeSellar,
  sellarLegado,
} from '../apps/api/src/audit/audit-chain.ts';

async function main(): Promise<void> {
  const db = getDb();
  const empresas = await empresasPendientesDeSellar(db);
  if (empresas.length === 0) {
    console.log('No hay empresas con auditoría histórica pendiente de sellar.');
    return;
  }
  for (const companyId of empresas) {
    const n = await db.transaction((tx) => sellarLegado(tx, companyId));
    console.log(`Empresa ${companyId}: ${n} entradas selladas.`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
