/**
 * Utilidades compartidas por las specs de la cadena de auditoría
 * (`audit-*.e2e-spec.ts`). No es un spec (no termina en `.e2e-spec.ts`).
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { asc, eq, ne } from 'drizzle-orm';
import { auditLog, companies, getDb } from '@erp/db';
import type { AuditLogEntry } from '@erp/db';
import { AUDIT_GENESIS_HASH } from '@erp/shared';
import {
  calcularHashAuditoria,
  entradaDeFila,
} from '../../src/audit/audit-chain';
import { AuditService, EntradaAuditoria } from '../../src/audit/audit.service';
import { TEST_DATABASE_URL } from './test-db';

export { AUDIT_GENESIS_HASH };

/** Cliente `pg` suelto, para SQL directo (sin pasar por la aplicación). */
export async function conClientePg<T>(
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const c = new Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Error de `pg` como `{ code, message }` (o `null` si la sentencia no falló). */
export async function errorDe(
  c: Client,
  texto: string,
  valores: unknown[] = [],
): Promise<{ code?: string; message: string; constraint?: string } | null> {
  // Cada sentencia en su propia transacción que se revierte siempre: una
  // sentencia que (indebidamente) tuviera éxito no deja rastro.
  await c.query('BEGIN');
  try {
    await c.query(texto, valores);
    return null;
  } catch (e) {
    return e as { code?: string; message: string; constraint?: string };
  } finally {
    await c.query('ROLLBACK');
  }
}

/** Ejecuta `fn` con los triggers de usuario de la cadena desactivados (y los reactiva siempre). */
export async function conTriggersDesactivados<T>(
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return conClientePg(async (c) => {
    await c.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
    await c.query('ALTER TABLE audit_chain_heads DISABLE TRIGGER USER');
    try {
      return await fn(c);
    } finally {
      await c.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
      await c.query('ALTER TABLE audit_chain_heads ENABLE TRIGGER USER');
    }
  });
}

/** `registrar()` en su propia transacción (como lo hace un servicio de negocio). */
export async function registrarEn(
  app: INestApplication,
  companyId: string,
  entradas: EntradaAuditoria | EntradaAuditoria[],
  actorId: string | null = null,
): Promise<void> {
  const audit = app.get(AuditService);
  await getDb().transaction((tx) =>
    audit.registrar(tx, entradas, { companyId, actorId }),
  );
}

export function entrada(
  extra: Partial<EntradaAuditoria> = {},
): EntradaAuditoria {
  return {
    entityType: 'project',
    entityId: randomUUID(),
    action: 'create',
    newData: { n: 1 },
    ...extra,
  };
}

/** Filas de una empresa en orden de cadena. */
export async function cadenaDe(companyId: string): Promise<AuditLogEntry[]> {
  return getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.companyId, companyId))
    .orderBy(asc(auditLog.sequenceNumber), asc(auditLog.id));
}

/** Hash recalculado desde la fila tal como está guardada. */
export function hashRecalculado(fila: AuditLogEntry): string {
  return calcularHashAuditoria(
    entradaDeFila(fila, fila.previousHash as string),
  );
}

/** Crea una empresa adicional (la limpia el siguiente `seedCompany`). */
export async function crearEmpresa(nombre: string): Promise<string> {
  const [c] = await getDb()
    .insert(companies)
    .values({ name: nombre, taxId: `B${Math.floor(Math.random() * 1e8)}` })
    .returning();
  return c.id;
}

/**
 * `resetTestDb()` conserva `companies`: las empresas extra de un test hay que
 * borrarlas aparte (si no, `getDefaultCompanyId()` podría elegir una de ellas).
 * Llamar justo después de `resetTestDb()`, cuando ya no cuelga ninguna auditoría.
 */
export async function limpiarEmpresasExtra(companyId: string): Promise<void> {
  await getDb().delete(companies).where(ne(companies.id, companyId));
}
