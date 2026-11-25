import { Injectable, UnprocessableEntityException } from '@nestjs/common';
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

/** Facturas de venta y compra que la interfaz contabiliza (igual criterio). */
const FACTURAS_CONTABLES = `('aprobada', 'pagada', 'rectificada')`;

/**
 * Conciliación de cierre auxiliar ↔ mayor **a una fecha de corte** (SAP
 * Financial Close, FBL1N / FBL5N / MB5L; Oracle Subledger Period Close). Cada
 * auxiliar se reconstruye a esa fecha y se compara con el mayor hasta esa
 * fecha:
 *  - devengos de aval (contabilizados hasta el mes de corte − liquidado contra
 *    devengo hasta la fecha) ↔ 4100 de origen aval;
 *  - amortización acumulada de los activos no dados de baja a la fecha ↔ 281x;
 *  - obra en curso vigente (último cierre hasta la fecha) ↔ 4309 − 4389;
 *  - provisión por pérdidas vigente ↔ 4994;
 *  - clientes: facturas de venta contabilizables − cobros vigentes ↔ 4300 + 4301;
 *  - proveedores: facturas de compra − pagos vigentes ↔ 4000 + 4001;
 *  - almacén: valor del kárdex (sin traspasos, que netean) ↔ grupo 3.
 * Las anulaciones fechan su contra-asiento como el original, así que lo
 * anulado se excluye del auxiliar en cualquier fecha. Guardarla deja
 * evidencia (`close_reconciliations`) y auditoría.
 */
@Injectable()
export class ConciliacionCierreService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  private fechaCorte(fecha: string | undefined): string {
    const hoy = todayIso();
    const f = fecha ?? hoy;
    if (f > hoy) {
      throw new UnprocessableEntityException({
        code: 'CLOSE_RECONCILIATION_DATE_INVALID',
        message: `La fecha de corte (${f}) no puede ser futura`,
      });
    }
    return f;
  }

  private async calcular(ex: DbOrTx, companyId: string, fecha: string) {
    const uno = async (q: ReturnType<typeof sql>) =>
      String(((await ex.execute(q)).rows[0] as { v: string | null }).v ?? '0');
    /** Saldo (debe − haber, o haber − debe) de cuentas del mayor hasta la fecha. */
    const mayor = (patron: SQLPatron, acreedor: boolean, origenAval = false) =>
      uno(sql`select coalesce(sum(${acreedor ? sql`l.credit - l.debit` : sql`l.debit - l.credit`}), 0)::text as v
        from journal_entry_lines l
        join journal_entries je on je.id = l.entry_id
        join ledger_accounts la on la.id = l.account_id
        left join journal_entries r on r.id = je.reverses_id
        where l.company_id = ${companyId} and je.entry_date <= ${fecha}
          and (${patron(sql`la.code`)})
          ${origenAval ? sql`and coalesce(r.source, je.source) = 'aval'` : sql``}`);
    const [
      devengoAux,
      devengoMayor,
      amortAux,
      amortMayor,
      wipAux,
      wipMayor,
      provAux,
      provMayor,
      clientesAux,
      clientesMayor,
      proveedoresAux,
      proveedoresMayor,
      almacenAux,
      almacenMayor,
    ] = await Promise.all([
      uno(sql`select (
          (select coalesce(sum(a.amount), 0) from bank_guarantee_accruals a
            where a.company_id = ${companyId} and a.status = 'contabilizado'
              and (make_date(a.year, a.month, 1) + interval '1 month - 1 day')::date <= ${fecha})
          - (select coalesce(sum(mv.accrual_settled_amount), 0) from bank_guarantee_movements mv
            where mv.company_id = ${companyId} and mv.type = 'comision'
              and mv.movement_date <= ${fecha}))::text as v`),
      mayor((c) => sql`${c} like '4100%'`, true, true),
      uno(sql`select coalesce(sum(d.amount), 0)::text as v
        from fixed_asset_depreciations d
        join fixed_assets a on a.id = d.asset_id
        where d.company_id = ${companyId}
          and (make_date(d.year, d.month, 1) + interval '1 month - 1 day')::date <= ${fecha}
          and (a.disposal_date is null or a.disposal_date > ${fecha})`),
      mayor((c) => sql`${c} like '281%'`, true),
      uno(sql`select coalesce(sum(w.wip_amount), 0)::text as v from (
          select distinct on (project_id) wip_amount from work_in_progress
          where company_id = ${companyId} and status = 'contabilizado'
            and closing_date <= ${fecha}
          order by project_id, year desc, month desc) w`),
      mayor((c) => sql`${c} like '4309%' or ${c} like '4389%'`, false),
      uno(sql`select coalesce(sum(p.required_provision), 0)::text as v from (
          select distinct on (project_id) required_provision from loss_provisions
          where company_id = ${companyId} and status = 'contabilizado'
            and closing_date <= ${fecha}
          order by project_id, year desc, month desc) p`),
      mayor((c) => sql`${c} like '4994%'`, true),
      this.terceros(ex, companyId, fecha, 'venta', 'cobro'),
      mayor((c) => sql`${c} like '4300%' or ${c} like '4301%'`, false),
      this.terceros(ex, companyId, fecha, 'compra', 'pago'),
      mayor((c) => sql`${c} like '4000%' or ${c} like '4001%'`, true),
      uno(sql`select coalesce(sum(total_value), 0)::text as v from stock_movements
        where company_id = ${companyId} and type <> 'traspaso'
          and movement_date <= ${fecha}`),
      mayor((c) => sql`${c} like '3%'`, false),
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
        {
          clave: 'clientes',
          etiqueta: 'Clientes: facturas emitidas pendientes de cobro',
          cuentas: '4300 + 4301',
          auxiliar: clientesAux,
          mayor: clientesMayor,
        },
        {
          clave: 'proveedores',
          etiqueta: 'Proveedores: facturas recibidas pendientes de pago',
          cuentas: '4000 + 4001',
          auxiliar: proveedoresAux,
          mayor: proveedoresMayor,
        },
        {
          clave: 'almacen',
          etiqueta: 'Almacén: valor del kárdex (PMP)',
          cuentas: 'grupo 3',
          auxiliar: almacenAux,
          mayor: almacenMayor,
        },
      ]),
    };
  }

  /**
   * Pendiente de un tercero a la fecha: total de las facturas contabilizables
   * emitidas hasta la fecha menos las liquidaciones vigentes hasta la fecha.
   */
  private async terceros(
    ex: DbOrTx,
    companyId: string,
    fecha: string,
    kind: 'venta' | 'compra',
    direccion: 'cobro' | 'pago',
  ): Promise<string> {
    const r = await ex.execute(sql`
      with fac as (
        select id, total_amount from invoices
        where company_id = ${companyId} and kind = ${kind}
          and status in ${sql.raw(FACTURAS_CONTABLES)}
          and deleted_at is null and issue_date <= ${fecha})
      select ((select coalesce(sum(total_amount), 0) from fac)
        - (select coalesce(sum(ps.amount), 0) from payment_settlements ps
            join payment_milestones pm on pm.id = ps.milestone_id
            where pm.invoice_id in (select id from fac)
              and pm.direction = ${direccion}
              and ps.status = 'vigente' and ps.settled_on <= ${fecha}))::text as v`);
    return String((r.rows[0] as { v: string | null }).v ?? '0');
  }

  /** Conciliación a una fecha (por defecto, hoy), sin guardar. */
  async consultar(fecha?: string): Promise<ConciliacionCierreDto> {
    const r = await this.calcular(
      this.dbs.db,
      this.dbs.getCompanyId(),
      this.fechaCorte(fecha),
    );
    return { id: null, ejecutadoEn: null, ...r };
  }

  /** Ejecuta y guarda la conciliación a una fecha como evidencia del cierre. */
  async registrar(fecha?: string): Promise<ConciliacionCierreDto> {
    const companyId = this.dbs.getCompanyId();
    const corte = this.fechaCorte(fecha);
    const fila = await this.dbs.db.transaction(async (tx) => {
      const r = await this.calcular(tx, companyId, corte);
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

type SQLPatron = (columna: ReturnType<typeof sql>) => ReturnType<typeof sql>;
