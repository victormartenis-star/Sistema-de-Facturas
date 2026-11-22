import { ConflictException, NotFoundException } from '@nestjs/common';
import { SQL, and, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@erp/db';
import {
  type EntidadConEstado,
  type EstadoPorEntidad,
  transicion,
} from '@erp/shared';
import { conflictoVersion } from './version';

/**
 * ÚNICO punto de escritura de `status` de la API.
 *
 * Cada cambio de estado valida la transición con la máquina de estados
 * (`transicion`, que lanza `TransicionInvalidaError` → 409) y escribe con
 * `WHERE status = <estado de origen>`: si otra petición concurrente movió el
 * documento entre la lectura y la escritura, el UPDATE no toca ninguna fila y
 * se responde 409 en vez de pisar el estado nuevo (carrera «pagar vs anular»).
 *
 * Un test de arquitectura (`estado-unico.e2e-spec.ts`) impide escribir
 * `status:` dentro de `.set({` en cualquier otro fichero de `src/`.
 */

/** Tabla con las tres columnas que toca el cambio de estado. */
export type TablaConEstado = PgTable & {
  id: PgColumn;
  status: PgColumn;
  updatedAt: PgColumn;
};

/**
 * `version = version + 1` si la tabla tiene columna `version` (concurrencia
 * optimista): toda transición de estado cuenta como mutación. Para tablas sin
 * esa columna no se añade nada.
 */
function incrementoVersion(tabla: object): Record<string, unknown> {
  const col = (tabla as { version?: PgColumn }).version;
  return col ? { version: sql`${col} + 1` } : {};
}

export const MENSAJE_ESTADO_CAMBIADO =
  'El documento ha cambiado de estado: recarga e inténtalo de nuevo';

/** Cambia el estado de UNA fila; 409 si ya no está en `de`. */
export async function cambiarEstado<
  E extends EntidadConEstado,
  T extends TablaConEstado,
>(
  tx: DbOrTx,
  tabla: T,
  entidad: E,
  id: string,
  de: EstadoPorEntidad[E],
  a: EstadoPorEntidad[E],
  extra: Record<string, unknown> = {},
  /** Versión esperada (If-Match); solo se valida si llega. */
  versionEsperada?: number,
): Promise<T['$inferSelect']> {
  transicion(entidad, de, a);
  const rows = (await tx
    .update(tabla)
    .set({
      ...extra,
      ...incrementoVersion(tabla),
      status: a,
      updatedAt: sql`now()`,
    } as never)
    .where(
      and(
        eq(tabla.id, id),
        eq(tabla.status, de),
        versionEsperada === undefined
          ? undefined
          : eq(
              (tabla as unknown as { version: PgColumn }).version,
              versionEsperada,
            ),
      ),
    )
    .returning()) as T['$inferSelect'][];
  if (rows.length === 0) {
    await fallarCambioEstado(tx, tabla, id, versionEsperada);
  }
  return rows[0];
}

/** 0 filas: 404 si no existe, VERSION_CONFLICT si la versión no coincide, 409 de estado si no. */
async function fallarCambioEstado(
  tx: DbOrTx,
  tabla: TablaConEstado,
  id: string,
  versionEsperada: number | undefined,
): Promise<never> {
  const col = (tabla as unknown as { version?: PgColumn }).version;
  if (versionEsperada !== undefined && col) {
    const [fila] = (await tx
      .select({ version: col })
      .from(tabla as PgTable)
      .where(eq(tabla.id, id))
      .limit(1)) as { version: number }[];
    if (!fila)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Recurso no encontrado',
      });
    if (Number(fila.version) !== versionEsperada) {
      throw conflictoVersion(Number(fila.version));
    }
  }
  throw new ConflictException(MENSAJE_ESTADO_CAMBIADO);
}

/**
 * Cambio de estado sobre un conjunto de filas (p. ej. los albaranes de una
 * factura). Mismo contrato que `cambiarEstado`, con el estado de origen en el
 * WHERE, pero cero filas NO es un error: el conjunto puede estar legítimamente
 * vacío o ya en otro estado. Devuelve las filas realmente cambiadas.
 */
export async function cambiarEstadoMasivo<
  E extends EntidadConEstado,
  T extends TablaConEstado,
>(
  tx: DbOrTx,
  tabla: T,
  entidad: E,
  donde: SQL,
  de: EstadoPorEntidad[E],
  a: EstadoPorEntidad[E],
  extra: Record<string, unknown> = {},
): Promise<T['$inferSelect'][]> {
  transicion(entidad, de, a);
  return (await tx
    .update(tabla)
    .set({
      ...extra,
      ...incrementoVersion(tabla),
      status: a,
      updatedAt: sql`now()`,
    } as never)
    .where(and(donde, eq(tabla.status, de)))
    .returning()) as T['$inferSelect'][];
}
