import { and, eq, gte, inArray, lte, sql, SQL } from 'drizzle-orm';
import {
  journalEntries,
  journalEntryLines,
  ledgerAccounts,
  stockMovements,
  type DbOrTx,
} from '@erp/db';
import { toCents } from '@erp/shared';

/**
 * Costes que la obra recibe de otros módulos y que comparten la economía de
 * obra (`economics`, BAC/AC/EV) y el cuadro de márgenes, para que las cifras
 * por obra no se contradigan:
 *  - Almacén: consumos − devoluciones ± regularizaciones de acopio (kárdex).
 *  - Amortización: saldo deudor 681x imputado a la obra en el mayor (los
 *    contra-asientos de anulación netean solos).
 * Sin partida: ninguno de los dos se imputa a una partida concreta.
 */

export interface RangoFechas {
  desde?: string;
  hasta?: string;
}

/** Clave de agrupación: la obra o la obra y el mes (`AAAA-MM`). */
export type ClaveCoste = string;

export function claveObraMes(projectId: string, mes: string): ClaveCoste {
  return `${projectId}|${mes}`;
}

function rango(col: Parameters<typeof gte>[0], r: RangoFechas): SQL[] {
  const out: SQL[] = [];
  if (r.desde) out.push(gte(col, r.desde));
  if (r.hasta) out.push(lte(col, r.hasta));
  return out;
}

/**
 * Consumo neto de almacén por obra (o por obra y mes con `porMes`), en
 * céntimos. Positivo = coste.
 */
export async function costeAlmacen(
  ex: DbOrTx,
  ids: string[],
  opciones: { rango?: RangoFechas; porMes?: boolean } = {},
): Promise<Map<ClaveCoste, bigint>> {
  const out = new Map<ClaveCoste, bigint>();
  if (ids.length === 0) return out;
  const mes = sql<string>`to_char(${stockMovements.movementDate}, 'YYYY-MM')`;
  const filas = await ex
    .select({
      projectId: stockMovements.projectId,
      mes: opciones.porMes ? mes : sql<string>`''`,
      total: sql<string>`coalesce(-sum(${stockMovements.totalValue}), 0)`,
    })
    .from(stockMovements)
    .where(
      and(
        inArray(stockMovements.projectId, ids),
        inArray(stockMovements.type, [
          'salida_obra',
          'devolucion',
          'regularizacion',
        ]),
        ...rango(stockMovements.movementDate, opciones.rango ?? {}),
      ),
    )
    .groupBy(stockMovements.projectId, ...(opciones.porMes ? [mes] : []));
  for (const f of filas) {
    if (!f.projectId) continue;
    const clave = opciones.porMes
      ? claveObraMes(f.projectId, f.mes)
      : f.projectId;
    out.set(clave, toCents(f.total));
  }
  return out;
}

/**
 * Amortización (681x) imputada por obra (o por obra y mes con `porMes`), en
 * céntimos: saldo deudor de las líneas del mayor con esa obra.
 */
export async function costeAmortizacion(
  ex: DbOrTx,
  ids: string[],
  opciones: { rango?: RangoFechas; porMes?: boolean } = {},
): Promise<Map<ClaveCoste, bigint>> {
  const out = new Map<ClaveCoste, bigint>();
  if (ids.length === 0) return out;
  const mes = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
  const filas = await ex
    .select({
      projectId: journalEntryLines.projectId,
      mes: opciones.porMes ? mes : sql<string>`''`,
      total: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(
      ledgerAccounts,
      eq(ledgerAccounts.id, journalEntryLines.accountId),
    )
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .where(
      and(
        inArray(journalEntryLines.projectId, ids),
        sql`${ledgerAccounts.code} LIKE '681%'`,
        ...rango(journalEntries.entryDate, opciones.rango ?? {}),
      ),
    )
    .groupBy(journalEntryLines.projectId, ...(opciones.porMes ? [mes] : []));
  for (const f of filas) {
    if (!f.projectId) continue;
    const clave = opciones.porMes
      ? claveObraMes(f.projectId, f.mes)
      : f.projectId;
    out.set(clave, toCents(f.total));
  }
  return out;
}
