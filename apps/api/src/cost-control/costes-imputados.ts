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

/**
 * Excluye la regularización, el cierre y la apertura del ejercicio (y sus
 * contra-asientos): saldan los grupos 6 y 7 por obra al 31-12, pero el coste
 * de la obra no desaparece por cerrar el ejercicio.
 */
function sinAsientosDeCierre(): SQL {
  return sql`${journalEntries.source} NOT IN ('regularizacion_ejercicio', 'cierre_ejercicio', 'apertura_ejercicio')
    AND (${journalEntries.reversesId} IS NULL OR ${journalEntries.reversesId} NOT IN (select je.id from journal_entries je where je.source IN ('regularizacion_ejercicio', 'cierre_ejercicio', 'apertura_ejercicio')))`;
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
        sinAsientosDeCierre(),
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

/**
 * Coste de avales por obra, en céntimos: saldo deudor de las cuentas de gasto
 * (grupo 6: comisiones 6260 y ejecuciones 6780) de los asientos de origen
 * `aval` imputados a la obra, contra-asientos de anulación incluidos. El
 * ingreso de un aval recibido ejecutado (7780) no es coste y no entra.
 */
export async function costeAvales(
  ex: DbOrTx,
  ids: string[],
  opciones: { rango?: RangoFechas } = {},
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (ids.length === 0) return out;
  const filas = await ex
    .select({
      projectId: journalEntryLines.projectId,
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
        sql`${ledgerAccounts.code} LIKE '6%'`,
        sql`(${journalEntries.source} = 'aval' OR ${journalEntries.reversesId} IN (select je.id from journal_entries je where je.source = 'aval'))`,
        ...rango(journalEntries.entryDate, opciones.rango ?? {}),
      ),
    )
    .groupBy(journalEntryLines.projectId);
  for (const f of filas) {
    if (f.projectId) out.set(f.projectId, toCents(f.total));
  }
  return out;
}
