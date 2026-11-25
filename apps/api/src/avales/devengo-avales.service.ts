import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql, SQL } from 'drizzle-orm';
import {
  bankGuaranteeAccrualBatches,
  bankGuaranteeAccrualRuns,
  bankGuaranteeAccruals,
  bankGuaranteeMovements,
  bankGuaranteeRates,
  bankGuarantees,
  type BankGuarantee,
  type BankGuaranteeAccrual,
  type BankGuaranteeAccrualBatch,
  type BankGuaranteeAccrualRun,
  type Tx,
} from '@erp/db';
import {
  ESTADOS_AVAL_VIVOS,
  asientoDevengoComision,
  avisosDevengoAutomatico,
  centsToNumeric,
  devengoAnularSchema,
  devengoAutomaticoSchema,
  devengoAvalesSchema,
  devengoPorTramos,
  diferenciasAuditoria,
  fromCents,
  mesesEntre,
  mesAnteriorA,
  mesTerminado,
  sumCents,
  toCents,
  todayIso,
  type AvisoDevengoDto,
  type DevengoAnularInput,
  type LoteDevengoDto,
  type DevengoAutomaticoInput,
  type DevengoAvalDto,
  type DevengoAvalesInput,
  type DevengoAvalesQuery,
  type DisparoDevengo,
  type EjecucionDevengoDto,
  type ResultadoDevengoAutomaticoDto,
  type ResultadoDevengoAvalesDto,
  type TramoDevengo,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { usuarioPersistible } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';

const clavePeriodo = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}`;
const finDeMes = (periodo: string) => {
  const [y, m] = periodo.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** El aval tiene (o tuvo) una tasa de comisión: la actual o alguna del historial. */
const conTasa = sql`(${bankGuarantees.commissionRatePct} is not null or exists (
  select 1 from bank_guarantee_rates br
  where br.guarantee_id = ${bankGuarantees.id} and br.rate_pct is not null))`;
/** Meses hacia atrás que recorre como máximo el devengo automático. */
const MAX_MESES_AUTOMATICO = 24;
/** Meses previos a la ventana que se revisan para avisar de lo saltado. */
const MAX_MESES_REVISION = 120;

function loteDto(l: BankGuaranteeAccrualBatch): LoteDevengoDto {
  return {
    id: l.id,
    disparo: l.trigger as DisparoDevengo,
    fechaReferencia: l.referenceDate,
    desde: l.periodFrom,
    hasta: l.periodTo,
    contabilizados: l.postedCount,
    importe: fromCents(toCents(l.amount)),
    avisos: l.warnings as AvisoDevengoDto[],
    alertas: l.alertCount,
    ejecutadoEn: l.createdAt.toISOString(),
  };
}

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
    tramos: (a.segments as TramoDevengo[]) ?? [],
    version: a.version,
  };
}

function ejecucionDto(r: BankGuaranteeAccrualRun): EjecucionDevengoDto {
  return {
    id: r.id,
    periodo: clavePeriodo(r.year, r.month),
    disparo: r.trigger as DisparoDevengo,
    contabilizados: r.postedCount,
    importe: fromCents(toCents(r.amount)),
    omitidos: r.skippedCount,
    ejecutadoEn: r.createdAt.toISOString(),
  };
}

/**
 * Devengo mensual de comisiones de avales emitidos (SAP Accruals / Oracle
 * Subledger Accounting), **prorrateado por tramos de saldo**: el mes se parte
 * en tramos con el saldo vivo constante según el historial de movimientos
 * (alta, liberaciones, ejecuciones, vencimiento), y se devenga
 * Σ saldo × tasa × días / 365 (`devengoPorTramos`), 6260 (obra) a 4100 al
 * último día del mes por `contabilizarEnTx` (período o ejercicio cerrado:
 * FISCAL_PERIOD_CLOSED / FISCAL_YEAR_CLOSED). Un devengo vigente por aval y
 * mes (índice único): no se duplica. Solo meses terminados. Cada ejecución
 * (manual o programada) queda registrada y auditada; el devengo automático
 * recorre los meses pendientes y es idempotente.
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

  async ejecuciones(): Promise<EjecucionDevengoDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(bankGuaranteeAccrualRuns)
      .where(eq(bankGuaranteeAccrualRuns.companyId, this.dbs.getCompanyId()))
      .orderBy(desc(bankGuaranteeAccrualRuns.createdAt))
      .limit(60);
    return filas.map(ejecucionDto);
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

  /**
   * Fecha de referencia (por defecto, hoy): decide qué meses están
   * terminados. Explícita, el devengo es determinista; nunca futura.
   */
  private referencia(fecha: string | undefined): string {
    const hoy = todayIso();
    if (fecha && fecha > hoy) {
      throw new UnprocessableEntityException({
        code: 'BANK_GUARANTEE_REFERENCE_DATE_INVALID',
        message: `La fecha de referencia (${fecha}) no puede ser futura`,
      });
    }
    return fecha ?? hoy;
  }

  private exigirMesTerminado(periodo: string, referencia: string): void {
    if (!mesTerminado(periodo, referencia)) {
      throw new UnprocessableEntityException({
        code: 'BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN',
        message: `El mes ${periodo} aún no ha terminado (referencia ${referencia}): solo se devengan meses cerrados`,
      });
    }
  }

  /** Historial de tasas del aval (null = sin comisión desde esa fecha → 0). */
  private async historialTasas(tx: Tx, g: BankGuarantee) {
    const filas = await tx
      .select({
        fecha: bankGuaranteeRates.effectiveDate,
        tasa: bankGuaranteeRates.ratePct,
      })
      .from(bankGuaranteeRates)
      .where(eq(bankGuaranteeRates.guaranteeId, g.id))
      .orderBy(asc(bankGuaranteeRates.effectiveDate));
    return filas.map((f) => ({ fecha: f.fecha, tasaAnualPct: f.tasa ?? '0' }));
  }

  /** Historial de saldo vivo del aval: el de cada fecha rige desde ese día. */
  private async historialSaldo(tx: Tx, g: BankGuarantee) {
    const movs = await tx
      .select({
        fecha: bankGuaranteeMovements.movementDate,
        saldo: bankGuaranteeMovements.outstandingAfter,
      })
      .from(bankGuaranteeMovements)
      .where(eq(bankGuaranteeMovements.guaranteeId, g.id))
      .orderBy(
        asc(bankGuaranteeMovements.movementDate),
        asc(bankGuaranteeMovements.createdAt),
      );
    // Varios movimientos el mismo día: vale el último.
    const porFecha = new Map<string, string>();
    for (const m of movs) porFecha.set(m.fecha, m.saldo);
    if (!porFecha.has(g.issueDate) && movs.length === 0) {
      porFecha.set(g.issueDate, g.amount);
    }
    return [...porFecha].map(([fecha, saldo]) => ({ fecha, saldo }));
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
    if (g.direction !== 'emitido') {
      throw noAplica(
        'Solo los avales emitidos devengan comisión a nuestro cargo',
      );
    }
    if (g.status === 'anulado') {
      throw noAplica(`El aval ${g.reference} está anulado`);
    }
    const tasas = await this.historialTasas(tx, g);
    if (
      g.commissionRatePct === null &&
      !tasas.some((t) => toCents(t.tasaAnualPct) > 0n)
    ) {
      throw noAplica(`El aval ${g.reference} no tiene tasa de comisión`);
    }
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
    const calculo = devengoPorTramos({
      periodo,
      emision: g.issueDate,
      vencimiento: g.expiryDate,
      // Sin historial (avales anteriores a la 0064): la tasa actual desde la emisión.
      tasaAnualPct: g.commissionRatePct ?? '0',
      tasas,
      saldos: await this.historialSaldo(tx, g),
    });
    if (calculo.tramos.length === 0 || toCents(calculo.importe) <= 0n) {
      throw noAplica(
        `El aval ${g.reference} no tuvo saldo vivo en ${periodo} (devengo cero)`,
      );
    }
    const id = randomUUID();
    const concepto = `Devengo comisión aval ${g.reference} ${periodo}`;
    const asiento = await this.contabilidad.contabilizarEnTx(tx, {
      companyId,
      fecha: finDeMes(periodo),
      concepto,
      origen: 'aval',
      origenId: id,
      lineas: asientoDevengoComision(calculo.importe).map((l) => ({
        cuenta: l.cuenta,
        debe: l.debe,
        haber: l.haber,
        projectId: l.imputaObra ? g.projectId : null,
        concepto,
      })),
    });
    const primero = calculo.tramos[0];
    const ultimo = calculo.tramos[calculo.tramos.length - 1];
    const [row] = await tx
      .insert(bankGuaranteeAccruals)
      .values({
        id,
        companyId,
        guaranteeId: g.id,
        year: y,
        month: m,
        periodFrom: primero.desde,
        periodTo: ultimo.hasta,
        days: calculo.dias,
        baseAmount: centsToNumeric(toCents(primero.saldo)),
        ratePct: (primero.tasaAnualPct ?? 0).toFixed(4),
        amount: centsToNumeric(toCents(calculo.importe)),
        segments: calculo.tramos,
        journalEntryId: asiento.id,
        createdBy: usuarioPersistible(),
      })
      .returning();
    const devengado = toCents(g.accruedCommission) + toCents(calculo.importe);
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

  /** Avales que pueden devengar en el mes: emitidos con tasa, vivos en algún día. */
  private async candidatos(periodo: string) {
    const acceso = await this.acceso();
    if (acceso === null) return [];
    const inicio = `${periodo}-01`;
    const f: SQL[] = [
      eq(bankGuarantees.companyId, this.dbs.getCompanyId()),
      eq(bankGuarantees.direction, 'emitido'),
      ne(bankGuarantees.status, 'anulado'),
      conTasa,
      sql`${bankGuarantees.issueDate} <= ${finDeMes(periodo)}`,
      // Vivo hoy, o se redujo a cero (liberación, ejecución, vencimiento) en
      // ese mes o después: estuvo vivo en parte del mes.
      sql`(${inArray(bankGuarantees.status, [...ESTADOS_AVAL_VIVOS])} OR EXISTS (
        select 1 from bank_guarantee_movements mv
        where mv.guarantee_id = ${bankGuarantees.id}
          and mv.type in ('liberacion', 'ejecucion', 'vencimiento')
          and mv.outstanding_after = 0
          and mv.movement_date >= ${inicio}))`,
    ];
    if (acceso) f.push(acceso);
    return this.dbs.db
      .select({ id: bankGuarantees.id, referencia: bankGuarantees.reference })
      .from(bankGuarantees)
      .where(and(...f))
      .orderBy(bankGuarantees.reference);
  }

  /** Devengo masivo de un mes; registra la ejecución. */
  private async devengarMes(
    periodo: string,
    disparo: DisparoDevengo,
    silenciarYaDevengados: boolean,
  ): Promise<ResultadoDevengoAvalesDto> {
    const candidatos = await this.candidatos(periodo);
    const res: ResultadoDevengoAvalesDto = {
      periodo,
      contabilizados: 0,
      importe: 0,
      omitidos: [],
      candidatos: candidatos.length,
      yaDevengados: 0,
    };
    const importes: bigint[] = [];
    for (const c of candidatos) {
      try {
        const id = await this.dbs.db.transaction((tx) =>
          this.devengarEnTx(tx, c.id, periodo),
        );
        const r = await this.porId(id);
        res.contabilizados += 1;
        importes.push(toCents(r.importe));
      } catch (e) {
        if (!(e instanceof HttpException) || e.getStatus() >= 500) throw e;
        const cuerpo = e.getResponse() as
          { message?: string; code?: string } | string;
        const code = typeof cuerpo === 'string' ? '' : (cuerpo.code ?? '');
        if (silenciarYaDevengados) {
          // Idempotencia: lo ya devengado no se repite ni es un rechazo; lo no
          // aplicable (sin saldo ni tasa en el mes) tampoco es una omisión.
          if (code === 'BANK_GUARANTEE_ACCRUAL_ALREADY_POSTED') {
            res.yaDevengados! += 1;
            continue;
          }
          if (code === 'BANK_GUARANTEE_ACCRUAL_NOT_APPLICABLE') continue;
        }
        res.omitidos.push({
          avalId: c.id,
          referencia: c.referencia,
          motivo:
            typeof cuerpo === 'string' ? cuerpo : (cuerpo.message ?? e.message),
          ...(code ? { codigo: code } : {}),
        });
      }
    }
    res.importe = fromCents(sumCents(importes));
    const ejecucionId = await this.registrarEjecucion(res, disparo);
    return { ...res, ejecucionId };
  }

  private async registrarEjecucion(
    res: ResultadoDevengoAvalesDto,
    disparo: DisparoDevengo,
  ): Promise<string> {
    const [y, m] = res.periodo.split('-').map(Number);
    return this.dbs.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(bankGuaranteeAccrualRuns)
        .values({
          companyId: this.dbs.getCompanyId(),
          year: y,
          month: m,
          trigger: disparo,
          postedCount: res.contabilizados,
          amount: centsToNumeric(toCents(res.importe)),
          skippedCount: res.omitidos.length,
          skipped: res.omitidos,
          createdBy: usuarioPersistible(),
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee_accrual_run',
        entityId: run.id,
        action: 'create',
        newData: run,
      });
      return run.id;
    });
  }

  /**
   * Meses anteriores a la ventana del devengo automático en los que algún
   * aval candidato no tiene devengo vigente: quedarían saltados en silencio.
   * Se revisan como máximo los `MAX_MESES_REVISION` meses previos.
   */
  private async fueraDeVentana(
    desde: string,
    primeroVentana: string,
  ): Promise<{ periodo: string; pendientes: number }[]> {
    const previos = mesesEntre(desde, primeroVentana)
      .filter((p) => p < primeroVentana)
      .slice(-MAX_MESES_REVISION);
    const out: { periodo: string; pendientes: number }[] = [];
    for (const periodo of previos) {
      const ids = (await this.candidatos(periodo)).map((c) => c.id);
      if (ids.length === 0) continue;
      const [y, m] = periodo.split('-').map(Number);
      const hechos = await this.dbs.db
        .select({ id: bankGuaranteeAccruals.guaranteeId })
        .from(bankGuaranteeAccruals)
        .where(
          and(
            inArray(bankGuaranteeAccruals.guaranteeId, ids),
            eq(bankGuaranteeAccruals.year, y),
            eq(bankGuaranteeAccruals.month, m),
            eq(bankGuaranteeAccruals.status, 'contabilizado'),
          ),
        );
      out.push({ periodo, pendientes: ids.length - hechos.length });
    }
    return out;
  }

  /** Guarda el lote del devengo automático, enlaza sus ejecuciones y lo audita. */
  private async registrarLote(
    res: ResultadoDevengoAutomaticoDto,
    referencia: string,
    disparo: DisparoDevengo,
    ejecuciones: string[],
  ): Promise<string> {
    return this.dbs.db.transaction(async (tx) => {
      const [lote] = await tx
        .insert(bankGuaranteeAccrualBatches)
        .values({
          companyId: this.dbs.getCompanyId(),
          trigger: disparo,
          referenceDate: referencia,
          periodFrom: res.desde,
          periodTo: res.hasta,
          postedCount: res.contabilizados,
          amount: centsToNumeric(toCents(res.importe)),
          warnings: res.avisos,
          alertCount: res.alertas,
          createdBy: usuarioPersistible(),
        })
        .returning();
      if (ejecuciones.length > 0) {
        await tx
          .update(bankGuaranteeAccrualRuns)
          .set({ batchId: lote.id })
          .where(inArray(bankGuaranteeAccrualRuns.id, ejecuciones));
      }
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee_accrual_batch',
        entityId: lote.id,
        action: 'create',
        newData: lote,
        meta: { ejecuciones: ejecuciones.length, alertas: res.alertas },
      });
      return lote.id;
    });
  }

  /** Lotes del devengo automático (manuales y programados), con sus avisos. */
  async lotes(): Promise<LoteDevengoDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(bankGuaranteeAccrualBatches)
      .where(eq(bankGuaranteeAccrualBatches.companyId, this.dbs.getCompanyId()))
      .orderBy(desc(bankGuaranteeAccrualBatches.createdAt))
      .limit(24);
    return filas.map(loteDto);
  }

  /**
   * Devenga un mes terminado: un aval (errores tal cual) o todos los
   * emitidos con tasa que estuvieron vivos, cada uno en su transacción; los
   * rechazados (ya devengado, período cerrado…) se informan sin bloquear.
   */
  async devengar(
    input: DevengoAvalesInput,
  ): Promise<ResultadoDevengoAvalesDto | DevengoAvalDto> {
    const d = devengoAvalesSchema.parse(input);
    this.exigirMesTerminado(d.periodo, this.referencia(d.fechaReferencia));
    if (d.avalId) {
      const id = await this.dbs.db.transaction((tx) =>
        this.devengarEnTx(tx, d.avalId!, d.periodo),
      );
      return this.porId(id);
    }
    return this.devengarMes(d.periodo, 'manual', false);
  }

  /**
   * Devengo automático: todos los meses terminados hasta `hasta` (por
   * defecto, el anterior al actual) desde el primero en que algún aval pudo
   * devengar (máximo 24 meses). Idempotente: los meses ya devengados no se
   * repiten. Cada mes no devengado del todo se explica en `avisos` (ya
   * devengado o sin avales: info; período o ejercicio cerrado, rechazo o mes
   * anterior a la ventana con avales sin devengar: alerta). La ejecución se
   * guarda como lote auditado, también la de la tarea programada.
   */
  async automatico(
    input: DevengoAutomaticoInput,
    disparo: DisparoDevengo = 'manual',
  ): Promise<ResultadoDevengoAutomaticoDto> {
    const d = devengoAutomaticoSchema.parse(input);
    const ref = this.referencia(d.fechaReferencia);
    const hasta = d.hasta ?? mesAnteriorA(ref);
    this.exigirMesTerminado(hasta, ref);
    const [primero] = await this.dbs.db
      .select({ desde: sql<string | null>`min(${bankGuarantees.issueDate})` })
      .from(bankGuarantees)
      .where(
        and(
          eq(bankGuarantees.companyId, this.dbs.getCompanyId()),
          eq(bankGuarantees.direction, 'emitido'),
          ne(bankGuarantees.status, 'anulado'),
          conTasa,
        ),
      );
    const res: ResultadoDevengoAutomaticoDto = {
      desde: null,
      hasta,
      periodos: [],
      contabilizados: 0,
      importe: 0,
      loteId: null,
      avisos: [],
      alertas: 0,
    };
    // Sin avales con tasa no hay nada que devengar ni lote que guardar.
    if (!primero?.desde) return res;
    const todos = mesesEntre(primero.desde.slice(0, 7), hasta);
    const meses = todos.slice(-MAX_MESES_AUTOMATICO);
    res.desde = meses[0] ?? null;
    const importes: bigint[] = [];
    const ejecuciones: string[] = [];
    for (const periodo of meses) {
      const r = await this.devengarMes(periodo, disparo, true);
      ejecuciones.push(r.ejecucionId!);
      res.periodos.push(r);
      res.contabilizados += r.contabilizados;
      importes.push(toCents(r.importe));
    }
    res.importe = fromCents(sumCents(importes));
    res.avisos = avisosDevengoAutomatico(
      res.periodos.map((p) => ({
        periodo: p.periodo,
        candidatos: p.candidatos ?? 0,
        contabilizados: p.contabilizados,
        yaDevengados: p.yaDevengados ?? 0,
        omitidos: p.omitidos,
      })),
      todos.length > meses.length && res.desde
        ? await this.fueraDeVentana(todos[0], res.desde)
        : [],
    );
    res.alertas = res.avisos.filter((a) => a.nivel === 'alerta').length;
    res.loteId = await this.registrarLote(res, ref, disparo, ejecuciones);
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
