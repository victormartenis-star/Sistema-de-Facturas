import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  allocationRunLines,
  allocationRuns,
  costCenterAccounts,
  costCenters,
  fiscalPeriods,
  fiscalYearClosings,
  type DbOrTx,
} from '@erp/db';
import {
  centroPorCuenta,
  fromCents,
  mesesEntre,
  toCents,
  type PeriodoReparto,
  type SaldoCentroDto,
} from '@erp/shared';

/**
 * Consultas compartidas del control analítico. El mayor analítico es:
 *  - coste primario: apuntes del grupo 6 sin obra del mayor FI, del centro
 *    explícito o, sin él, del centro de la cuenta asignada (prefijo más
 *    largo), sin los asientos de regularización, cierre y apertura;
 *  - coste secundario: líneas de las ejecuciones de reparto vigentes cuyo
 *    `hasta` cae en el periodo (no generan asientos FI: no duplican coste).
 */

const SIN_CIERRE = sql`je.source NOT IN ('regularizacion_ejercicio', 'cierre_ejercicio', 'apertura_ejercicio')
  AND (je.reverses_id IS NULL OR je.reverses_id NOT IN (select x.id from journal_entries x where x.source IN ('regularizacion_ejercicio', 'cierre_ejercicio', 'apertura_ejercicio')))`;

const k = (centro: string, cuenta: string) => `${centro}|${cuenta}`;

/** Saldo analítico de los centros de la empresa en el periodo. */
export async function saldosCentros(
  ex: DbOrTx,
  companyId: string,
  p: PeriodoReparto,
  soloIds?: readonly string[],
): Promise<SaldoCentroDto[]> {
  const centros = await ex
    .select({
      id: costCenters.id,
      codigo: costCenters.code,
      nombre: costCenters.name,
    })
    .from(costCenters)
    .where(
      and(
        eq(costCenters.companyId, companyId),
        ...(soloIds ? [inArray(costCenters.id, [...soloIds])] : []),
      ),
    )
    .orderBy(costCenters.code);
  if (centros.length === 0) return [];
  const asignaciones = (
    await ex
      .select({
        prefijo: costCenterAccounts.accountPrefix,
        centroId: costCenterAccounts.costCenterId,
      })
      .from(costCenterAccounts)
      .where(eq(costCenterAccounts.companyId, companyId))
  ).map((a) => ({ prefijo: a.prefijo, centroId: a.centroId }));

  const primarias = await ex.execute(sql`
    select jl.cost_center_id as centro, la.code as cuenta,
      coalesce(sum(jl.debit - jl.credit), 0)::text as saldo
    from journal_entry_lines jl
    join ledger_accounts la on la.id = jl.account_id
    join journal_entries je on je.id = jl.entry_id
    where jl.company_id = ${companyId} and jl.project_id is null
      and la.code like '6%'
      and je.entry_date between ${p.desde} and ${p.hasta}
      and ${SIN_CIERRE}
    group by jl.cost_center_id, la.code`);
  const secundarias = await ex
    .select({
      emisor: allocationRunLines.senderCostCenterId,
      receptor: allocationRunLines.receiverCostCenterId,
      cuenta: allocationRunLines.accountCode,
      importe: sql<string>`coalesce(sum(${allocationRunLines.amount}), 0)::text`,
    })
    .from(allocationRunLines)
    .innerJoin(allocationRuns, eq(allocationRuns.id, allocationRunLines.runId))
    .where(
      and(
        eq(allocationRunLines.companyId, companyId),
        eq(allocationRuns.status, 'contabilizado'),
        sql`${allocationRuns.periodTo} between ${p.desde} and ${p.hasta}`,
      ),
    )
    .groupBy(
      allocationRunLines.senderCostCenterId,
      allocationRunLines.receiverCostCenterId,
      allocationRunLines.accountCode,
    );

  const primario = new Map<string, bigint>();
  const recibido = new Map<string, bigint>();
  const repartido = new Map<string, bigint>();
  const acumula = (m: Map<string, bigint>, clave: string, v: bigint) =>
    m.set(clave, (m.get(clave) ?? 0n) + v);
  for (const r of primarias.rows as {
    centro: string | null;
    cuenta: string;
    saldo: string;
  }[]) {
    const centro = r.centro ?? centroPorCuenta(r.cuenta, asignaciones);
    if (centro) acumula(primario, k(centro, r.cuenta), toCents(r.saldo));
  }
  for (const r of secundarias) {
    const v = toCents(r.importe);
    acumula(repartido, k(r.emisor, r.cuenta), v);
    if (r.receptor) acumula(recibido, k(r.receptor, r.cuenta), v);
  }
  return centros.map((c) => {
    const cuentas = new Set<string>();
    for (const m of [primario, recibido, repartido]) {
      for (const clave of m.keys()) {
        const [centro, cuenta] = clave.split('|');
        if (centro === c.id) cuentas.add(cuenta);
      }
    }
    let tp = 0n;
    let tr = 0n;
    let ts = 0n;
    const porCuenta = [...cuentas].sort().map((cuenta) => {
      const pr = primario.get(k(c.id, cuenta)) ?? 0n;
      const re = recibido.get(k(c.id, cuenta)) ?? 0n;
      const rp = repartido.get(k(c.id, cuenta)) ?? 0n;
      tp += pr;
      tr += re;
      ts += rp;
      return {
        cuenta,
        primario: fromCents(pr),
        recibido: fromCents(re),
        repartido: fromCents(rp),
        saldo: fromCents(pr + re - rp),
      };
    });
    return {
      centroId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      primario: fromCents(tp),
      recibido: fromCents(tr),
      repartido: fromCents(ts),
      saldo: fromCents(tp + tr - ts),
      porCuenta,
    };
  });
}

/** Indirectos recibidos por obra (repartos vigentes con `hasta` ≤ fecha). */
export async function indirectosPorObra(
  ex: DbOrTx,
  companyId: string,
  ids: readonly string[],
  hasta: string,
): Promise<Map<string, { total: bigint; porCentro: Map<string, bigint> }>> {
  const out = new Map<
    string,
    { total: bigint; porCentro: Map<string, bigint> }
  >();
  if (ids.length === 0) return out;
  const filas = await ex
    .select({
      obra: allocationRunLines.receiverProjectId,
      centro: allocationRunLines.senderCostCenterId,
      importe: sql<string>`coalesce(sum(${allocationRunLines.amount}), 0)::text`,
    })
    .from(allocationRunLines)
    .innerJoin(allocationRuns, eq(allocationRuns.id, allocationRunLines.runId))
    .where(
      and(
        eq(allocationRunLines.companyId, companyId),
        eq(allocationRuns.status, 'contabilizado'),
        inArray(allocationRunLines.receiverProjectId, [...ids]),
        sql`${allocationRuns.periodTo} <= ${hasta}`,
      ),
    )
    .groupBy(
      allocationRunLines.receiverProjectId,
      allocationRunLines.senderCostCenterId,
    );
  for (const f of filas) {
    if (!f.obra) continue;
    const o = out.get(f.obra) ?? { total: 0n, porCentro: new Map() };
    const v = toCents(f.importe);
    o.total += v;
    o.porCentro.set(f.centro, (o.porCentro.get(f.centro) ?? 0n) + v);
    out.set(f.obra, o);
  }
  return out;
}

/**
 * 409 `ALLOCATION_PERIOD_CLOSED` si algún mes del periodo está cerrado en
 * contabilidad o su ejercicio cerrado: el control analítico de un periodo
 * cerrado queda congelado como el mayor.
 */
export async function exigirPeriodoAbierto(
  ex: DbOrTx,
  companyId: string,
  p: PeriodoReparto,
): Promise<void> {
  const meses = mesesEntre(p.desde.slice(0, 7), p.hasta.slice(0, 7));
  const anios = [...new Set(meses.map((m) => Number(m.slice(0, 4))))];
  const [ejercicio] = await ex
    .select({ year: fiscalYearClosings.year })
    .from(fiscalYearClosings)
    .where(
      and(
        eq(fiscalYearClosings.companyId, companyId),
        inArray(fiscalYearClosings.year, anios),
        eq(fiscalYearClosings.status, 'cerrado'),
      ),
    )
    .limit(1);
  const cerrados = await ex
    .select({ year: fiscalPeriods.year, month: fiscalPeriods.month })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, companyId),
        inArray(fiscalPeriods.year, anios),
        eq(fiscalPeriods.status, 'cerrado'),
      ),
    );
  const mesCerrado = cerrados.find((c) =>
    meses.includes(`${c.year}-${String(c.month).padStart(2, '0')}`),
  );
  if (ejercicio || mesCerrado) {
    throw new ConflictException({
      code: 'ALLOCATION_PERIOD_CLOSED',
      message: ejercicio
        ? `El ejercicio ${ejercicio.year} está cerrado`
        : `El periodo ${mesCerrado!.month}/${mesCerrado!.year} está cerrado`,
    });
  }
}
