import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, sql, SQL } from 'drizzle-orm';
import {
  bankGuaranteeAccruals,
  bankGuarantees,
  type BankGuarantee,
  type BankGuaranteeAccrual,
  type Tx,
} from '@erp/db';
import {
  ESTADOS_AVAL_VIVOS,
  asientoDevengoComision,
  centsToNumeric,
  devengoAnularSchema,
  devengoAvalesSchema,
  devengoComisionAval,
  diferenciasAuditoria,
  fromCents,
  sumCents,
  toCents,
  tramoDevengoMes,
  type DevengoAnularInput,
  type DevengoAvalDto,
  type DevengoAvalesInput,
  type DevengoAvalesQuery,
  type ResultadoDevengoAvalesDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';

const clavePeriodo = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}`;

function dto(a: BankGuaranteeAccrual, referencia: string): DevengoAvalDto {
  return {
    id: a.id,
    avalId: a.guaranteeId,
    referencia,
    periodo: clavePeriodo(a.year, a.month),
    desde: a.periodFrom,
    hasta: a.periodTo,
    dias: a.days,
    saldoBase: fromCents(toCents(a.baseAmount)),
    tasaAnualPct: Number(a.ratePct),
    importe: fromCents(toCents(a.amount)),
    estado: a.status as 'contabilizado' | 'anulado',
    asientoId: a.journalEntryId,
    contraAsientoId: a.reversalEntryId,
    motivoAnulacion: a.cancelReason,
    version: a.version,
  };
}

/**
 * Devengo mensual de comisiones de avales emitidos (SAP Accruals / Oracle
 * Subledger Accounting): por aval y mes, saldo vivo × tasa anual × días
 * vigentes / 365 (`devengoComisionAval`), contabilizado 6260 (obra) a 4100
 * por `ContabilidadService.contabilizarEnTx` al último día del mes (período o
 * ejercicio cerrado: FISCAL_PERIOD_CLOSED / FISCAL_YEAR_CLOSED). Un devengo
 * vigente por aval y mes (índice único): no se duplica. La liquidación del
 * banco salda después el 4100 (ver `AvalesService.comision`).
 */
@Injectable()
export class DevengoAvalesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
  ) {}

  /** Filtro de obras accesibles (los avales sin obra, solo con acceso total). */
  private async acceso(): Promise<SQL | undefined | null> {
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles === null) return undefined;
    if (accesibles.length === 0) return null;
    return inArray(bankGuarantees.projectId, accesibles);
  }

  async listar(q: DevengoAvalesQuery): Promise<DevengoAvalDto[]> {
    const acceso = await this.acceso();
    if (acceso === null) return [];
    const f: SQL[] = [
      eq(bankGuaranteeAccruals.companyId, this.dbs.getCompanyId()),
    ];
    if (acceso) f.push(acceso);
    if (q.avalId) f.push(eq(bankGuaranteeAccruals.guaranteeId, q.avalId));
    if (q.periodo) {
      const [y, m] = q.periodo.split('-').map(Number);
      f.push(
        eq(bankGuaranteeAccruals.year, y),
        eq(bankGuaranteeAccruals.month, m),
      );
    }
    const filas = await this.dbs.db
      .select({
        a: bankGuaranteeAccruals,
        referencia: bankGuarantees.reference,
      })
      .from(bankGuaranteeAccruals)
      .innerJoin(
        bankGuarantees,
        eq(bankGuarantees.id, bankGuaranteeAccruals.guaranteeId),
      )
      .where(and(...f))
      .orderBy(
        desc(bankGuaranteeAccruals.year),
        desc(bankGuaranteeAccruals.month),
        bankGuarantees.reference,
      );
    return filas.map((x) => dto(x.a, x.referencia));
  }

  private async porId(id: string): Promise<DevengoAvalDto> {
    const [x] = await this.dbs.db
      .select({
        a: bankGuaranteeAccruals,
        referencia: bankGuarantees.reference,
      })
      .from(bankGuaranteeAccruals)
      .innerJoin(
        bankGuarantees,
        eq(bankGuarantees.id, bankGuaranteeAccruals.guaranteeId),
      )
      .where(
        and(
          eq(bankGuaranteeAccruals.id, id),
          eq(bankGuaranteeAccruals.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!x) {
      throw new NotFoundException({
        code: 'BANK_GUARANTEE_ACCRUAL_NOT_FOUND',
        message: 'Devengo del aval no encontrado',
      });
    }
    return dto(x.a, x.referencia);
  }

  /** Devengo de un aval y mes en su transacción; devuelve el id del devengo. */
  private async devengarEnTx(
    tx: Tx,
    avalId: string,
    periodo: string,
  ): Promise<string> {
    const companyId = this.dbs.getCompanyId();
    const [g] = (await tx
      .select()
      .from(bankGuarantees)
      .where(
        and(
          eq(bankGuarantees.id, avalId),
          eq(bankGuarantees.companyId, companyId),
        ),
      )
      .for('update')) as BankGuarantee[];
    if (!g) {
      throw new NotFoundException({
        code: 'BANK_GUARANTEE_NOT_FOUND',
        message: 'Aval no encontrado',
      });
    }
    const accesibles = await this.dbs.getObrasAccesibles();
    if (
      accesibles !== null &&
      (!g.projectId || !accesibles.includes(g.projectId))
    ) {
      throw new NotFoundException({
        code: 'BANK_GUARANTEE_NOT_FOUND',
        message: 'Aval no encontrado',
      });
    }
    const noAplica = (message: string) =>
      new UnprocessableEntityException({
        code: 'BANK_GUARANTEE_ACCRUAL_NOT_APPLICABLE',
        message,
      });
    if (g.direction !== 'emitido')
      throw noAplica(
        'Solo los avales emitidos devengan comisión a nuestro cargo',
      );
    if (!(ESTADOS_AVAL_VIVOS as readonly string[]).includes(g.status)) {
      throw noAplica(
        `El aval ${g.reference} no está vivo (estado «${g.status}»)`,
      );
    }
    if (g.commissionRatePct === null)
      throw noAplica(`El aval ${g.reference} no tiene tasa de comisión`);
    const tramo = tramoDevengoMes({
      periodo,
      emision: g.issueDate,
      vencimiento: g.expiryDate,
    });
    if (!tramo)
      throw noAplica(`El aval ${g.reference} no estuvo vigente en ${periodo}`);
    const [y, m] = periodo.split('-').map(Number);
    const [ya] = await tx
      .select({ id: bankGuaranteeAccruals.id })
      .from(bankGuaranteeAccruals)
      .where(
        and(
          eq(bankGuaranteeAccruals.guaranteeId, g.id),
          eq(bankGuaranteeAccruals.year, y),
          eq(bankGuaranteeAccruals.month, m),
          eq(bankGuaranteeAccruals.status, 'contabilizado'),
        ),
      );
    if (ya) {
      throw new ConflictException({
        code: 'BANK_GUARANTEE_ACCRUAL_ALREADY_POSTED',
        message: `El aval ${g.reference} ya tiene devengada la comisión de ${periodo}`,
      });
    }
    const importe = devengoComisionAval({
      saldoVivo: g.outstandingAmount,
      tasaAnualPct: g.commissionRatePct,
      dias: tramo.dias,
    });
    if (toCents(importe) <= 0n)
      throw noAplica(`El devengo de ${g.reference} en ${periodo} es cero`);
    const id = randomUUID();
    const fechaAsiento = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const concepto = `Devengo comisión aval ${g.reference} ${periodo}`;
    const asiento = await this.contabilidad.contabilizarEnTx(tx, {
      companyId,
      fecha: fechaAsiento,
      concepto,
      origen: 'aval',
      origenId: id,
      lineas: asientoDevengoComision(importe).map((l) => ({
        cuenta: l.cuenta,
        debe: l.debe,
        haber: l.haber,
        projectId: l.imputaObra ? g.projectId : null,
        concepto,
      })),
    });
    const [row] = await tx
      .insert(bankGuaranteeAccruals)
      .values({
        id,
        companyId,
        guaranteeId: g.id,
        year: y,
        month: m,
        periodFrom: tramo.desde,
        periodTo: tramo.hasta,
        days: tramo.dias,
        baseAmount: g.outstandingAmount,
        ratePct: g.commissionRatePct,
        amount: centsToNumeric(toCents(importe)),
        journalEntryId: asiento.id,
        createdBy: getRequestContext()?.userId ?? null,
      })
      .returning();
    const devengado = toCents(g.accruedCommission) + toCents(importe);
    await tx
      .update(bankGuarantees)
      .set({
        accruedCommission: centsToNumeric(devengado),
        version: g.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(bankGuarantees.id, g.id));
    const antes = { accruedCommission: g.accruedCommission };
    const despues = { accruedCommission: centsToNumeric(devengado) };
    await this.audit.registrar(tx, {
      entityType: 'bank_guarantee_accrual',
      entityId: row.id,
      action: 'create',
      oldData: antes,
      newData: { ...row, cambios: diferenciasAuditoria(antes, despues) },
    });
    return row.id;
  }

  /**
   * Devenga un mes: un aval (errores tal cual) o todos los emitidos vivos con
   * tasa, cada uno en su transacción; los rechazados (ya devengado, período
   * cerrado, no vigente) se informan sin bloquear al resto.
   */
  async devengar(
    input: DevengoAvalesInput,
  ): Promise<ResultadoDevengoAvalesDto | DevengoAvalDto> {
    const d = devengoAvalesSchema.parse(input);
    if (d.avalId) {
      const id = await this.dbs.db.transaction((tx) =>
        this.devengarEnTx(tx, d.avalId!, d.periodo),
      );
      return this.porId(id);
    }
    const acceso = await this.acceso();
    const res: ResultadoDevengoAvalesDto = {
      periodo: d.periodo,
      contabilizados: 0,
      importe: 0,
      omitidos: [],
    };
    if (acceso === null) return res;
    const f: SQL[] = [
      eq(bankGuarantees.companyId, this.dbs.getCompanyId()),
      eq(bankGuarantees.direction, 'emitido'),
      inArray(bankGuarantees.status, [...ESTADOS_AVAL_VIVOS]),
      isNotNull(bankGuarantees.commissionRatePct),
      sql`${bankGuarantees.issueDate} <= (${`${d.periodo}-01`}::date + interval '1 month' - interval '1 day')`,
    ];
    if (acceso) f.push(acceso);
    const candidatos = await this.dbs.db
      .select({ id: bankGuarantees.id, referencia: bankGuarantees.reference })
      .from(bankGuarantees)
      .where(and(...f))
      .orderBy(bankGuarantees.reference);
    const importes: bigint[] = [];
    for (const c of candidatos) {
      try {
        const id = await this.dbs.db.transaction((tx) =>
          this.devengarEnTx(tx, c.id, d.periodo),
        );
        const r = await this.porId(id);
        res.contabilizados += 1;
        importes.push(toCents(r.importe));
      } catch (e) {
        if (!(e instanceof HttpException) || e.getStatus() >= 500) throw e;
        const cuerpo = e.getResponse() as { message?: string } | string;
        res.omitidos.push({
          avalId: c.id,
          referencia: c.referencia,
          motivo:
            typeof cuerpo === 'string' ? cuerpo : (cuerpo.message ?? e.message),
        });
      }
    }
    res.importe = fromCents(sumCents(importes));
    return res;
  }

  /**
   * Anula un devengo por contra-asiento (con su fecha: período cerrado →
   * FISCAL_PERIOD_CLOSED). No si el banco ya liquidó esa parte de lo devengado
   * (BANK_GUARANTEE_ACCRUAL_SETTLED).
   */
  async anular(
    id: string,
    input: DevengoAnularInput,
    version: number | undefined,
  ): Promise<DevengoAvalDto> {
    const { motivo } = devengoAnularSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const actual = await this.porId(id);
    await this.dbs.db.transaction(async (tx) => {
      const [g] = await tx
        .select()
        .from(bankGuarantees)
        .where(
          and(
            eq(bankGuarantees.id, actual.avalId),
            eq(bankGuarantees.companyId, companyId),
          ),
        )
        .for('update');
      const accesibles = await this.dbs.getObrasAccesibles();
      if (
        accesibles !== null &&
        (!g.projectId || !accesibles.includes(g.projectId))
      ) {
        throw new NotFoundException({
          code: 'BANK_GUARANTEE_ACCRUAL_NOT_FOUND',
          message: 'Devengo del aval no encontrado',
        });
      }
      const [a] = await tx
        .select()
        .from(bankGuaranteeAccruals)
        .where(eq(bankGuaranteeAccruals.id, id))
        .for('update');
      verificarVersion(a.version, version);
      if (a.status !== 'contabilizado') {
        throw new ConflictException({
          code: 'BANK_GUARANTEE_ACCRUAL_NOT_FOUND',
          message: 'El devengo ya está anulado',
        });
      }
      const devengado = toCents(g.accruedCommission) - toCents(a.amount);
      if (devengado < toCents(g.accrualSettled)) {
        throw new ConflictException({
          code: 'BANK_GUARANTEE_ACCRUAL_SETTLED',
          message: `El banco ya liquidó ${centsToNumeric(toCents(g.accrualSettled))} de lo devengado: anular este devengo dejaría la liquidación sin cubrir`,
        });
      }
      let contraId: string | null = null;
      if (a.journalEntryId) {
        const contra = await this.contabilidad.anularEnTx(
          tx,
          companyId,
          a.journalEntryId,
          `Anulación devengo comisión aval ${actual.referencia} ${actual.periodo}: ${motivo}`,
          undefined,
        );
        contraId = contra.id;
      }
      await cambiarEstado(
        tx,
        bankGuaranteeAccruals,
        'bank_guarantee_accrual',
        id,
        'contabilizado',
        'anulado',
        { cancelReason: motivo, reversalEntryId: contraId },
        version,
      );
      await tx
        .update(bankGuarantees)
        .set({
          accruedCommission: centsToNumeric(devengado),
          version: g.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(bankGuarantees.id, g.id));
      const antes = {
        status: 'contabilizado',
        accruedCommission: g.accruedCommission,
      };
      const despues = {
        status: 'anulado',
        accruedCommission: centsToNumeric(devengado),
      };
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee_accrual',
        entityId: id,
        action: 'update',
        oldData: antes,
        newData: {
          ...despues,
          motivo,
          contraAsientoId: contraId,
          cambios: diferenciasAuditoria(antes, despues),
        },
      });
    });
    return this.porId(id);
  }
}
