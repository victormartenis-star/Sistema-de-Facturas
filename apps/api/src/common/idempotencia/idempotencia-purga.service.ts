import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { getDb } from '@erp/db';

/** Filas por lote: lotes pequeños mantienen cortas las transacciones de borrado. */
export const PURGA_LOTE = 500;
/** Tope de lotes por ejecución; el resto se recoge en la siguiente hora. */
export const PURGA_MAX_LOTES = 20;

/**
 * Purga periódica de `idempotency_keys` caducadas (`expires_at < now()`).
 *
 * Corrección: una clave vencida ya se trata como inexistente en el
 * interceptor, así que esta limpieza solo controla el tamaño de la tabla.
 * Por eso no está en el camino de cada petición (antes lo estaba).
 *
 * Diseño de bloqueo: cada lote selecciona con `FOR UPDATE SKIP LOCKED`, de
 * modo que nunca espera a una fila que otra transacción está usando y no
 * bloquea la tabla. Desactivable con `IDEMPOTENCY_PURGE_ENABLED=false` y
 * siempre desactivado con `NODE_ENV=test`.
 */
@Injectable()
export class IdempotenciaPurgaService {
  private readonly logger = new Logger(IdempotenciaPurgaService.name);

  /** Cada hora, en el minuto 30 (fuera de la hora en punto, donde suelen caer otros crons). */
  @Cron('30 * * * *', { name: 'idempotencia-purga' })
  async handleCron(): Promise<void> {
    if (!purgaHabilitada()) return;
    const eliminadas = await this.purgarCaducadas();
    if (eliminadas > 0) {
      this.logger.log(
        `Purgadas ${eliminadas} claves de idempotencia caducadas`,
      );
    }
  }

  /** Borra por lotes las claves caducadas. Devuelve el total eliminado. */
  async purgarCaducadas(): Promise<number> {
    let total = 0;
    for (let lote = 0; lote < PURGA_MAX_LOTES; lote++) {
      const res = await getDb().execute(sql`
        DELETE FROM idempotency_keys WHERE id IN (
          SELECT id FROM idempotency_keys
          WHERE expires_at < now()
          LIMIT ${PURGA_LOTE}
          FOR UPDATE SKIP LOCKED
        )`);
      const borradas = res.rowCount ?? 0;
      total += borradas;
      if (borradas < PURGA_LOTE) break;
    }
    return total;
  }
}

/** Activa salvo en tests o si se desactiva explícitamente por entorno. */
export function purgaHabilitada(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return process.env.IDEMPOTENCY_PURGE_ENABLED !== 'false';
}
