import { ConflictException } from '@nestjs/common';
import { SQL, and, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@erp/db';
import {
  type EntidadConEstado,
  type EstadoPorEntidad,
  transicion,
} from '@erp/shared';

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
): Promise<T['$inferSelect']> {
  transicion(entidad, de, a);
  const rows = (await tx
    .update(tabla)
    .set({ ...extra, status: a, updatedAt: sql`now()` } as never)
    .where(and(eq(tabla.id, id), eq(tabla.status, de)))
    .returning()) as T['$inferSelect'][];
  if (rows.length === 0) throw new ConflictException(MENSAJE_ESTADO_CAMBIADO);
  return rows[0];
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
    .set({ ...extra, status: a, updatedAt: sql`now()` } as never)
    .where(and(donde, eq(tabla.status, de)))
    .returning()) as T['$inferSelect'][];
}
