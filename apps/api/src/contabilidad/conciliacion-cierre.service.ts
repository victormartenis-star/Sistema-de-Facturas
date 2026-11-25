import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import {
  closeReconciliations,
  type CloseReconciliation,
  type DbOrTx,
} from '@erp/db';
import {
  conciliar,
  todayIso,
  type ConciliacionCierreDto,
  type PartidaConciliacion,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { usuarioPersistible } from '../common/request-context';
import { DbService } from '../db/db.service';

function dto(r: CloseReconciliation): ConciliacionCierreDto {
  return {
    id: r.id,
    fecha: r.cutOffDate,
    partidas: r.items as PartidaConciliacion[],
    cuadra: r.balanced,
    descuadres: r.mismatches,
    ejecutadoEn: r.createdAt.toISOString(),
  };
}

/**
 * Conciliación de cierre auxiliar ↔ mayor (SAP Financial Close / Oracle
 * Close Manager). Compara, con el estado actual:
 *  - devengos de comisiones de aval pendientes de liquidar ↔ 4100 de origen aval;
 *  - amortización acumulada de los activos en uso ↔ 281x;
 *  - obra en curso vigente por obra (último cierre) ↔ 4309 − 4389;
 *  - provisión por pérdidas vigente por obra ↔ 4994.
 * Guardarla deja evidencia (`close_reconciliations`) y auditoría.
 */
@Injectable()
export class ConciliacionCierreService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  private async calcular(ex: DbOrTx, companyId: string, fecha: string) {
    const uno = async (q: ReturnType<typeof sql>) =>
      String(((await ex.execute(q)).rows[0] as { v: string | null }).v ?? '0');
    const [
      devengoAux,
      devengoMayor,
      amortAux,
      amortMayor,
      wipAux,
      wipMayor,
      provAux,
      provMayor,
    ] = await Promise.all([
      uno(sql`select coalesce(sum(accrued_commission - accrual_settled), 0)::text as v
        from bank_guarantees where company_id = ${companyId}`),
      // Saldo acreedor de 4100 en asientos de avales (y sus contra-asientos).
      uno(sql`select coalesce(sum(l.credit - l.debit), 0)::text as v
        from journal_entry_lines l
        join journal_entries je on je.id = l.entry_id
        join ledger_accounts la on la.id = l.account_id
        left join journal_entries r on r.id = je.reverses_id
        where l.company_id = ${companyId} and la.code like '4100%'
          and coalesce(r.source, je.source) = 'aval'`),
      uno(sql`select coalesce(sum(d.amount), 0)::text as v
        from fixed_asset_depreciations d
        join fixed_assets a on a.id = d.asset_id
        where d.company_id = ${companyId} and a.status = 'activo'`),
      uno(sql`select coalesce(sum(l.credit - l.debit), 0)::text as v
        from journal_entry_lines l
        join ledger_accounts la on la.id = l.account_id
        where l.company_id = ${companyId} and la.code like '281%'`),
      uno(sql`select coalesce(sum(w.wip_amount), 0)::text as v from (
          select distinct on (project_id) wip_amount from work_in_progress
          where company_id = ${companyId} and status = 'contabilizado'
          order by project_id, year desc, month desc) w`),
      uno(sql`select coalesce(sum(l.debit - l.credit), 0)::text as v
        from journal_entry_lines l
        join ledger_accounts la on la.id = l.account_id
        where l.company_id = ${companyId}
          and (la.code like '4309%' or la.code like '4389%')`),
      uno(sql`select coalesce(sum(p.required_provision), 0)::text as v from (
          select distinct on (project_id) required_provision from loss_provisions
          where company_id = ${companyId} and status = 'contabilizado'
          order by project_id, year desc, month desc) p`),
      uno(sql`select coalesce(sum(l.credit - l.debit), 0)::text as v
        from journal_entry_lines l
        join ledger_accounts la on la.id = l.account_id
        where l.company_id = ${companyId} and la.code like '4994%'`),
    ]);
    return {
      fecha,
      ...conciliar([
        {
          clave: 'devengo_avales',
          etiqueta: 'Comisiones de aval devengadas pendientes de liquidar',
          cuentas: '4100 (origen aval)',
          auxiliar: devengoAux,
          mayor: devengoMayor,
        },
        {
          clave: 'amortizacion_acumulada',
          etiqueta: 'Amortización acumulada de los activos en uso',
          cuentas: '281x',
          auxiliar: amortAux,
          mayor: amortMayor,
        },
        {
          clave: 'obra_en_curso',
          etiqueta: 'Obra en curso vigente (último cierre por obra)',
          cuentas: '4309 − 4389',
          auxiliar: wipAux,
          mayor: wipMayor,
        },
        {
          clave: 'provision_perdidas',
          etiqueta: 'Provisión por pérdidas vigente por obra',
          cuentas: '4994',
          auxiliar: provAux,
          mayor: provMayor,
        },
      ]),
    };
  }

  /** Conciliación en vivo (no se guarda). */
  async consultar(): Promise<ConciliacionCierreDto> {
    const r = await this.calcular(
      this.dbs.db,
      this.dbs.getCompanyId(),
      todayIso(),
    );
    return { id: null, ejecutadoEn: null, ...r };
  }

  /** Ejecuta y guarda la conciliación como evidencia del cierre. */
  async registrar(): Promise<ConciliacionCierreDto> {
    const companyId = this.dbs.getCompanyId();
    const fila = await this.dbs.db.transaction(async (tx) => {
      const r = await this.calcular(tx, companyId, todayIso());
      const [row] = await tx
        .insert(closeReconciliations)
        .values({
          companyId,
          cutOffDate: r.fecha,
          balanced: r.cuadra,
          mismatches: r.descuadres,
          items: r.partidas,
          createdBy: usuarioPersistible(),
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'close_reconciliation',
        entityId: row.id,
        action: 'create',
        newData: row,
      });
      return row;
    });
    return dto(fila);
  }

  async historial(): Promise<ConciliacionCierreDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(closeReconciliations)
      .where(eq(closeReconciliations.companyId, this.dbs.getCompanyId()))
      .orderBy(desc(closeReconciliations.createdAt))
      .limit(50);
    return filas.map(dto);
  }
}
