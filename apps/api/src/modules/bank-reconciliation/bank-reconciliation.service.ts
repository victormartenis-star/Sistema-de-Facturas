import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import {
  BankAccount,
  BankTransaction,
  bankAccounts,
  bankStatements,
  bankTransactions,
  checks,
  contacts,
  invoices,
  paymentMilestones,
  paymentSettlements,
  sepaRemittanceItems,
  sepaRemittances,
  type Tx,
} from '@erp/db';
import {
  BankImportSummaryDto,
  BankStatementFormat,
  BankTransactionDto,
  MatchCandidate,
  MilestoneForMatching,
  asientoComisionBancaria,
  centsToNumeric,
  conciliacionSchema,
  desconciliacionSchema,
  diferenciasAuditoria,
  fromCents,
  matchCandidates,
  parseBankStatement,
  planConciliacion,
  resumenLiquidacion,
  sugerirConciliacion,
  toCents,
  type CandidatoConciliacion,
  type ConciliacionInput,
  type DesconciliacionInput,
  type SugerenciasMovimientoDto,
  type TipoConciliacion,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { errorBanca, reglaBanca } from '../../banca/comun';
import { getRequestContext } from '../../common/request-context';
import { verificarVersion } from '../../common/version';
import { ContabilidadService } from '../../contabilidad/contabilidad.service';
import { DbService } from '../../db/db.service';
import { TalonesService } from '../../talones/talones.service';
import {
  anularLiquidacion,
  registrarLiquidacion,
  type Contexto,
} from '../../treasury/liquidaciones';

function toDto(row: BankTransaction): BankTransactionDto {
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    transactionDate: row.transactionDate,
    amount: Number(row.amount),
    concept: row.concept,
    balanceAfter: row.balanceAfter === null ? null : Number(row.balanceAfter),
    bankReference: row.bankReference,
    reconciledMilestoneId: row.reconciledMilestoneId,
    reconciledAt: row.reconciledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    reconciliationKind:
      (row.reconciliationKind as TipoConciliacion | null) ?? null,
    reconciledSettlementId: row.reconciledSettlementId,
    reconciledRemittanceId: row.reconciledRemittanceId,
    reconciledRemittanceItemId: row.reconciledRemittanceItemId,
    reconciledCheckId: row.reconciledCheckId,
    feeAmount: Number(row.feeAmount),
    statementId: row.statementId,
    version: row.version,
  };
}

export interface SuggestionDto {
  transactionId: string;
  candidates: MatchCandidate[];
}

/** Estado de conciliación que se borra al desconciliar (antes/después en auditoría). */
const SIN_CONCILIAR = {
  reconciliationKind: null,
  reconciledMilestoneId: null,
  reconciledSettlementId: null,
  reconciledRemittanceId: null,
  reconciledRemittanceItemId: null,
  reconciledCheckId: null,
  reconciledAt: null,
  reconciledBy: null,
  feeAmount: '0',
  feeEntryId: null,
} as const;

function enlace(row: BankTransaction) {
  return {
    reconciliationKind: row.reconciliationKind,
    reconciledMilestoneId: row.reconciledMilestoneId,
    reconciledSettlementId: row.reconciledSettlementId,
    reconciledRemittanceId: row.reconciledRemittanceId,
    reconciledRemittanceItemId: row.reconciledRemittanceItemId,
    reconciledCheckId: row.reconciledCheckId,
    feeAmount: row.feeAmount,
  };
}

/**
 * Conciliación bancaria asistida (SAP Electronic Bank Statement / Oracle
 * Bank Statement Reconciliation): extractos con huella (reimportar no
 * duplica), sugerencias puntuadas contra vencimientos, liquidaciones ya
 * registradas, remesas SEPA, devoluciones y talones, y conciliación con
 * comisión bancaria (6260 a 5720) sin duplicar asientos: un documento se
 * concilia con un solo movimiento (índices únicos) y lo ya contabilizado
 * (remesa, talón, liquidación) solo se enlaza.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
    private readonly talones: TalonesService,
  ) {}

  private contexto(tx: Tx): Contexto {
    return {
      tx,
      audit: this.audit,
      companyId: this.dbs.getCompanyId(),
      userId: getRequestContext()?.userId ?? null,
    };
  }

  /**
   * Importa un extracto y da de alta los movimientos nuevos; los ya
   * importados (mismo `bankAccountId`+fecha+importe+concepto, ver el único
   * de `bank_transactions`) se cuentan como duplicados y se saltan — así
   * reimportar el mismo fichero por error no duplica nada. El extracto queda
   * registrado con la huella SHA-256 del fichero.
   */
  async importStatement(
    bankAccountId: string,
    format: BankStatementFormat,
    fileText: string,
  ): Promise<BankImportSummaryDto> {
    await this.findBankAccount(bankAccountId);
    const companyId = this.dbs.getCompanyId();

    let parsed;
    try {
      parsed = parseBankStatement(format, fileText);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const fileHash = createHash('sha256')
      .update(fileText, 'utf8')
      .digest('hex');

    return this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`extracto:${bankAccountId}`}))`,
      );
      const [previo] = await tx
        .select({ id: bankStatements.id })
        .from(bankStatements)
        .where(
          and(
            eq(bankStatements.companyId, companyId),
            eq(bankStatements.bankAccountId, bankAccountId),
            eq(bankStatements.fileHash, fileHash),
          ),
        );
      const fechas = parsed.map((r) => r.transactionDate).sort();
      const saldos = parsed.filter((r) => r.balanceAfter !== null);
      const statementId =
        previo?.id ??
        (
          await tx
            .insert(bankStatements)
            .values({
              companyId,
              bankAccountId,
              format,
              fileHash,
              fromDate: fechas[0] ?? null,
              toDate: fechas[fechas.length - 1] ?? null,
              lineCount: parsed.length,
              importedCount: 0,
              closingBalance:
                saldos.length > 0
                  ? saldos[saldos.length - 1].balanceAfter!.toFixed(2)
                  : null,
              createdBy: getRequestContext()?.userId ?? null,
            })
            .returning({ id: bankStatements.id })
        )[0].id;

      let imported = 0;
      let duplicates = 0;
      for (const row of parsed) {
        const [existing] = await tx
          .select({ id: bankTransactions.id })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.bankAccountId, bankAccountId),
              eq(bankTransactions.transactionDate, row.transactionDate),
              eq(bankTransactions.amount, row.amount.toFixed(2)),
              eq(bankTransactions.concept, row.concept),
            ),
          )
          .limit(1);
        if (existing) {
          duplicates++;
          continue;
        }
        await tx.insert(bankTransactions).values({
          companyId,
          bankAccountId,
          statementId,
          transactionDate: row.transactionDate,
          amount: row.amount.toFixed(2),
          concept: row.concept,
          balanceAfter:
            row.balanceAfter === null ? null : row.balanceAfter.toFixed(2),
          bankReference: row.bankReference,
        });
        imported++;
      }
      if (!previo) {
        await tx
          .update(bankStatements)
          .set({ importedCount: imported })
          .where(eq(bankStatements.id, statementId));
        await this.audit.registrar(tx, {
          entityType: 'bank_statement',
          entityId: statementId,
          action: 'create',
          newData: {
            bankAccountId,
            format,
            fileHash,
            lineas: parsed.length,
            importados: imported,
          },
        });
      }
      return { total: parsed.length, imported, duplicates, statementId };
    });
  }

  async list(
    bankAccountId?: string,
    reconciled?: boolean,
  ): Promise<BankTransactionDto[]> {
    const companyId = this.dbs.getCompanyId();
    const filters = [eq(bankTransactions.companyId, companyId)];
    if (bankAccountId)
      filters.push(eq(bankTransactions.bankAccountId, bankAccountId));
    if (reconciled === true)
      filters.push(isNotNull(bankTransactions.reconciliationKind));
    else if (reconciled === false)
      filters.push(isNull(bankTransactions.reconciliationKind));
    const rows = await this.dbs.db
      .select()
      .from(bankTransactions)
      .where(and(...filters))
      .orderBy(desc(bankTransactions.transactionDate));
    return rows.map(toDto);
  }

  /** Candidatos (vencimiento completo por importe y fecha) de los movimientos sin conciliar. */
  async suggestions(bankAccountId: string): Promise<SuggestionDto[]> {
    await this.findBankAccount(bankAccountId);
    const companyId = this.dbs.getCompanyId();
    const pending = await this.pendientes(bankAccountId);
    if (pending.length === 0) return [];
    const milestoneRows = await this.dbs.db
      .select()
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.companyId, companyId),
          ne(paymentMilestones.status, 'pagado'),
        ),
      );
    // Se casa contra el saldo vivo: un vencimiento cobrado en parte sugiere
    // el movimiento que salda lo que falta.
    const milestones: MilestoneForMatching[] = milestoneRows.map((m) => ({
      id: m.id,
      amount: Math.abs(resumenLiquidacion(m.amount, m.settledAmount).pendiente),
      dueDate: m.dueDate,
      direction: m.direction,
    }));
    return pending.map((tx) => ({
      transactionId: tx.id,
      candidates: matchCandidates(
        { amount: Number(tx.amount), transactionDate: tx.transactionDate },
        milestones,
      ),
    }));
  }

  private pendientes(bankAccountId: string) {
    return this.dbs.db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.companyId, this.dbs.getCompanyId()),
          eq(bankTransactions.bankAccountId, bankAccountId),
          isNull(bankTransactions.reconciliationKind),
        ),
      )
      .orderBy(desc(bankTransactions.transactionDate));
  }

  /** Documentos que aún puede conciliar un movimiento de la cuenta. */
  private async candidatos(
    bankAccountId: string,
  ): Promise<CandidatoConciliacion[]> {
    const companyId = this.dbs.getCompanyId();
    const db = this.dbs.db;
    const salida: CandidatoConciliacion[] = [];

    // 1. Vencimientos vivos de facturas aprobadas, fuera de remesas vivas.
    const vencimientos = await db
      .select({
        m: paymentMilestones,
        numero: invoices.invoiceNumber,
        tercero: contacts.legalName,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(
        and(
          eq(paymentMilestones.companyId, companyId),
          eq(paymentMilestones.status, 'previsto'),
          eq(invoices.status, 'aprobada'),
          notExists(
            db
              .select({ x: sepaRemittanceItems.id })
              .from(sepaRemittanceItems)
              .where(
                and(
                  eq(sepaRemittanceItems.milestoneId, paymentMilestones.id),
                  eq(sepaRemittanceItems.status, 'incluida'),
                ),
              ),
          ),
        ),
      );
    for (const v of vencimientos) {
      const pendiente = Math.abs(
        resumenLiquidacion(v.m.amount, v.m.settledAmount).pendiente,
      );
      if (pendiente <= 0) continue;
      salida.push({
        tipo: 'vencimiento',
        id: v.m.id,
        importe: pendiente,
        signo: v.m.direction === 'cobro' ? 1 : -1,
        fecha: v.m.dueDate,
        referencias: [v.numero],
        tercero: v.tercero,
        descripcion: `${v.m.direction === 'cobro' ? 'Cobro' : 'Pago'} ${v.numero} · ${v.tercero}`,
      });
    }

    // 2. Liquidaciones de tesorería vigentes sin movimiento enlazado.
    const liquidaciones = await db
      .select({
        s: paymentSettlements,
        direccion: paymentMilestones.direction,
        numero: invoices.invoiceNumber,
        tercero: contacts.legalName,
      })
      .from(paymentSettlements)
      .innerJoin(
        paymentMilestones,
        eq(paymentMilestones.id, paymentSettlements.milestoneId),
      )
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(
        and(
          eq(paymentSettlements.companyId, companyId),
          eq(paymentSettlements.status, 'vigente'),
          eq(paymentSettlements.source, 'tesoreria'),
          isNull(paymentSettlements.checkId),
          isNull(paymentSettlements.remittanceItemId),
          or(
            isNull(paymentSettlements.bankAccountId),
            eq(paymentSettlements.bankAccountId, bankAccountId),
          ),
          notExists(
            db
              .select({ x: bankTransactions.id })
              .from(bankTransactions)
              .where(
                eq(
                  bankTransactions.reconciledSettlementId,
                  paymentSettlements.id,
                ),
              ),
          ),
        ),
      );
    for (const l of liquidaciones) {
      salida.push({
        tipo: 'liquidacion',
        id: l.s.id,
        importe: Math.abs(Number(l.s.amount)),
        signo: l.direccion === 'cobro' ? 1 : -1,
        fecha: l.s.settledOn,
        referencias: [l.numero, ...(l.s.reference ? [l.s.reference] : [])],
        tercero: l.tercero,
        descripcion: `${l.direccion === 'cobro' ? 'Cobro' : 'Pago'} ya registrado ${l.numero} · ${l.tercero}`,
      });
    }

    // 3. Remesas remitidas de la cuenta sin conciliar (cargo o abono global).
    const remesas = await db
      .select()
      .from(sepaRemittances)
      .where(
        and(
          eq(sepaRemittances.companyId, companyId),
          eq(sepaRemittances.bankAccountId, bankAccountId),
          inArray(sepaRemittances.status, ['remitida', 'devuelta']),
          notExists(
            db
              .select({ x: bankTransactions.id })
              .from(bankTransactions)
              .where(
                eq(bankTransactions.reconciledRemittanceId, sepaRemittances.id),
              ),
          ),
        ),
      );
    for (const r of remesas) {
      salida.push({
        tipo: 'remesa',
        id: r.id,
        importe: Number(r.totalAmount),
        signo: r.type === 'adeudo' ? 1 : -1,
        fecha: r.sentOn ?? r.executionDate,
        referencias: [r.number],
        tercero: null,
        descripcion: `Remesa ${r.number} (${r.itemCount} partidas)`,
      });
    }

    // 4. Partidas devueltas sin conciliar (movimiento de signo contrario).
    const devueltas = await db
      .select({ p: sepaRemittanceItems, r: sepaRemittances })
      .from(sepaRemittanceItems)
      .innerJoin(
        sepaRemittances,
        eq(sepaRemittances.id, sepaRemittanceItems.remittanceId),
      )
      .where(
        and(
          eq(sepaRemittanceItems.companyId, companyId),
          eq(sepaRemittances.bankAccountId, bankAccountId),
          eq(sepaRemittanceItems.status, 'devuelta'),
          notExists(
            db
              .select({ x: bankTransactions.id })
              .from(bankTransactions)
              .where(
                eq(
                  bankTransactions.reconciledRemittanceItemId,
                  sepaRemittanceItems.id,
                ),
              ),
          ),
        ),
      );
    for (const d of devueltas) {
      salida.push({
        tipo: 'devolucion',
        id: d.p.id,
        importe: Number(d.p.amount),
        signo: d.r.type === 'adeudo' ? -1 : 1,
        fecha: d.p.returnedOn ?? d.r.executionDate,
        referencias: [d.p.endToEndId, d.r.number],
        tercero: d.p.name,
        descripcion: `Devolución ${d.p.endToEndId} · ${d.p.name}`,
      });
    }

    // 5. Talones de la cuenta pendientes de compensar o compensados sin conciliar.
    const talones = await db
      .select({ c: checks, tercero: contacts.legalName })
      .from(checks)
      .leftJoin(contacts, eq(contacts.id, checks.contactId))
      .where(
        and(
          eq(checks.companyId, companyId),
          eq(checks.bankAccountId, bankAccountId),
          inArray(checks.status, ['emitido', 'entregado', 'cobrado']),
          notExists(
            db
              .select({ x: bankTransactions.id })
              .from(bankTransactions)
              .where(eq(bankTransactions.reconciledCheckId, checks.id)),
          ),
        ),
      );
    for (const t of talones) {
      salida.push({
        tipo: 'talon',
        id: t.c.id,
        importe: Number(t.c.amount),
        signo: t.c.direction === 'emitido' ? -1 : 1,
        fecha: t.c.clearedOn ?? t.c.dueDate ?? t.c.issueDate,
        referencias: [t.c.number],
        tercero: t.tercero,
        descripcion: `Talón ${t.c.number}${t.tercero ? ` · ${t.tercero}` : ''} (${t.c.status})`,
      });
    }
    return salida;
  }

  /** Sugerencias puntuadas (0-100) de cada movimiento pendiente de la cuenta. */
  async sugerencias(
    bankAccountId: string,
  ): Promise<SugerenciasMovimientoDto[]> {
    await this.findBankAccount(bankAccountId);
    const pendientes = await this.pendientes(bankAccountId);
    if (pendientes.length === 0) return [];
    const candidatos = await this.candidatos(bankAccountId);
    return pendientes.map((tx) => ({
      transactionId: tx.id,
      importe: Number(tx.amount),
      fecha: tx.transactionDate,
      concepto: tx.concept,
      sugerencias: sugerirConciliacion(
        {
          importe: tx.amount,
          fecha: tx.transactionDate,
          concepto: tx.concept,
          referencia: tx.bankReference,
        },
        candidatos,
      ),
    }));
  }

  /** Conciliación de siempre: el movimiento contra un vencimiento. */
  async reconcile(transactionId: string, milestoneId: string): Promise<void> {
    await this.conciliar(
      transactionId,
      { tipo: 'vencimiento', id: milestoneId },
      undefined,
    );
  }

  /**
   * Concilia un movimiento con un documento, en una sola transacción:
   *  - vencimiento: registra la liquidación por el bruto (puede ser parcial)
   *    y la contabiliza a la fecha del movimiento (período cerrado → 409);
   *  - liquidación, remesa, devolución: solo enlaza (ya contabilizado);
   *  - talón: lo compensa a la fecha del movimiento si aún no lo estaba;
   *  - comisión: un cargo sin documento, 6260 a 5720.
   * La comisión indicada se contabiliza aparte (origen `conciliacion`).
   */
  async conciliar(
    transactionId: string,
    input: ConciliacionInput,
    version: number | undefined,
  ): Promise<BankTransactionDto> {
    const d = conciliacionSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    try {
      await this.dbs.db.transaction(async (tx) => {
        const mov = await this.bloquearMovimiento(tx, transactionId);
        verificarVersion(mov.version, version);
        if (mov.reconciliationKind) {
          throw new ConflictException({
            code: 'BANK_MOVEMENT_ALREADY_RECONCILED',
            message: 'El movimiento ya está conciliado',
          });
        }
        const enlaces: Partial<
          Record<
            | 'reconciledMilestoneId'
            | 'reconciledSettlementId'
            | 'reconciledRemittanceId'
            | 'reconciledRemittanceItemId'
            | 'reconciledCheckId',
            string | null
          >
        > = {};
        let comision = 0n;
        const plan = (
          signo: 1 | -1,
          objetivo: string | number,
          exacto: boolean,
        ) =>
          reglaBanca(() =>
            planConciliacion({
              movimiento: mov.amount,
              signoEsperado: signo,
              comision: d.comision ?? 0,
              objetivo,
              exacto,
            }),
          );

        if (d.tipo === 'vencimiento') {
          const [m] = await tx
            .select()
            .from(paymentMilestones)
            .where(
              and(
                eq(paymentMilestones.id, d.id!),
                eq(paymentMilestones.companyId, companyId),
              ),
            );
          if (!m)
            throw new NotFoundException({
              code: 'DUE_NOT_FOUND',
              message: 'Vencimiento no encontrado',
            });
          const pendiente = Math.abs(
            resumenLiquidacion(m.amount, m.settledAmount).pendiente,
          );
          const p = plan(m.direction === 'cobro' ? 1 : -1, pendiente, false);
          comision = p.comision;
          const liq = await registrarLiquidacion(this.contexto(tx), m.id, {
            cantidad: fromCents(p.bruto),
            fecha: mov.transactionDate,
            bankAccountId: mov.bankAccountId,
            bankTransactionId: mov.id,
            referencia: mov.concept.slice(0, 80) || null,
          });
          await this.contabilidad.contabilizarLiquidacionEnTx(
            tx,
            companyId,
            liq.id,
          );
          enlaces.reconciledMilestoneId = m.id;
          enlaces.reconciledSettlementId = liq.id;
        } else if (d.tipo === 'liquidacion') {
          const [s] = await tx
            .select({
              s: paymentSettlements,
              direccion: paymentMilestones.direction,
            })
            .from(paymentSettlements)
            .innerJoin(
              paymentMilestones,
              eq(paymentMilestones.id, paymentSettlements.milestoneId),
            )
            .where(
              and(
                eq(paymentSettlements.id, d.id!),
                eq(paymentSettlements.companyId, companyId),
              ),
            );
          if (!s)
            throw new NotFoundException({
              code: 'SETTLEMENT_NOT_FOUND',
              message: 'Liquidación no encontrada',
            });
          if (
            s.s.status !== 'vigente' ||
            s.s.source !== 'tesoreria' ||
            (s.s.bankAccountId && s.s.bankAccountId !== mov.bankAccountId)
          ) {
            throw errorBanca(
              'BANK_RECON_TARGET_INVALID',
              'La liquidación no está vigente o es de otra cuenta',
            );
          }
          // La de una remesa o un talón se concilia con su documento (el
          // cargo global de la remesa, la compensación del talón): por
          // separado se conciliaría dos veces el mismo dinero.
          if (s.s.remittanceItemId || s.s.checkId) {
            throw errorBanca(
              'BANK_RECON_TARGET_INVALID',
              s.s.remittanceItemId
                ? 'La liquidación es de una remesa SEPA: concilia el cargo o abono de la remesa'
                : 'La liquidación es de un talón: concilia el talón',
            );
          }
          comision = plan(
            s.direccion === 'cobro' ? 1 : -1,
            Math.abs(Number(s.s.amount)),
            true,
          ).comision;
          enlaces.reconciledMilestoneId = s.s.milestoneId;
          enlaces.reconciledSettlementId = s.s.id;
        } else if (d.tipo === 'remesa') {
          const [r] = await tx
            .select()
            .from(sepaRemittances)
            .where(
              and(
                eq(sepaRemittances.id, d.id!),
                eq(sepaRemittances.companyId, companyId),
              ),
            );
          if (!r)
            throw errorBanca(
              'SEPA_REMITTANCE_NOT_FOUND',
              'Remesa no encontrada',
            );
          if (
            r.bankAccountId !== mov.bankAccountId ||
            (r.status !== 'remitida' && r.status !== 'devuelta')
          ) {
            throw errorBanca(
              'BANK_RECON_TARGET_INVALID',
              'La remesa no está remitida o es de otra cuenta',
            );
          }
          comision = plan(
            r.type === 'adeudo' ? 1 : -1,
            r.totalAmount,
            true,
          ).comision;
          enlaces.reconciledRemittanceId = r.id;
        } else if (d.tipo === 'devolucion') {
          const [p] = await tx
            .select({ p: sepaRemittanceItems, r: sepaRemittances })
            .from(sepaRemittanceItems)
            .innerJoin(
              sepaRemittances,
              eq(sepaRemittances.id, sepaRemittanceItems.remittanceId),
            )
            .where(
              and(
                eq(sepaRemittanceItems.id, d.id!),
                eq(sepaRemittanceItems.companyId, companyId),
              ),
            );
          if (!p)
            throw errorBanca(
              'SEPA_ITEM_NOT_FOUND',
              'Partida de remesa no encontrada',
            );
          if (
            p.p.status !== 'devuelta' ||
            p.r.bankAccountId !== mov.bankAccountId
          ) {
            throw errorBanca(
              'BANK_RECON_TARGET_INVALID',
              'La partida no está devuelta o es de otra cuenta',
            );
          }
          comision = plan(
            p.r.type === 'adeudo' ? -1 : 1,
            p.p.amount,
            true,
          ).comision;
          enlaces.reconciledRemittanceItemId = p.p.id;
          enlaces.reconciledRemittanceId = null;
        } else if (d.tipo === 'talon') {
          const [c] = await tx
            .select()
            .from(checks)
            .where(and(eq(checks.id, d.id!), eq(checks.companyId, companyId)));
          if (!c)
            throw new NotFoundException({
              code: 'CHECK_NOT_FOUND',
              message: 'Talón no encontrado',
            });
          if (
            c.bankAccountId !== mov.bankAccountId ||
            !['emitido', 'entregado', 'cobrado'].includes(c.status)
          ) {
            throw errorBanca(
              'BANK_RECON_TARGET_INVALID',
              'El talón es de otra cuenta o ya no está vivo',
            );
          }
          comision = plan(
            c.direction === 'emitido' ? -1 : 1,
            c.amount,
            true,
          ).comision;
          if (c.status !== 'cobrado') {
            // El extracto prueba la compensación: 5729 ↔ 5720 a su fecha.
            await this.talones.accionEnTx(
              tx,
              c.id,
              { accion: 'cobrar', fecha: mov.transactionDate },
              undefined,
            );
          }
          enlaces.reconciledCheckId = c.id;
        } else {
          const m = toCents(mov.amount);
          if (m >= 0n)
            throw errorBanca(
              'BANK_FEE_INVALID',
              'Solo un cargo puede ser una comisión bancaria',
            );
          if (d.comision !== undefined && toCents(d.comision) !== -m) {
            throw errorBanca(
              'BANK_DIFFERENCE_MISMATCH',
              'La comisión debe ser el importe del cargo',
            );
          }
          comision = -m;
        }

        let feeEntryId: string | null = null;
        if (comision > 0n) {
          const concepto = `Comisión bancaria: ${mov.concept}`.slice(0, 240);
          const asiento = await this.contabilidad.contabilizarEnTx(tx, {
            companyId,
            fecha: mov.transactionDate,
            concepto,
            origen: 'conciliacion',
            origenId: mov.id,
            lineas: asientoComisionBancaria(fromCents(comision), concepto),
          });
          feeEntryId = asiento.id;
        }
        const nuevo = {
          ...enlaces,
          reconciliationKind: d.tipo,
          reconciledAt: new Date(),
          reconciledBy: getRequestContext()?.userId ?? null,
          feeAmount: centsToNumeric(comision),
          feeEntryId,
        };
        const [act] = await tx
          .update(bankTransactions)
          .set({ ...nuevo, version: sql`${bankTransactions.version} + 1` })
          .where(eq(bankTransactions.id, mov.id))
          .returning();
        await this.audit.registrar(tx, {
          entityType: 'bank_transaction',
          entityId: mov.id,
          action: 'update',
          oldData: enlace(mov),
          newData: diferenciasAuditoria(enlace(mov), enlace(act)),
          meta: { conciliacion: d.tipo, documento: d.id ?? null },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw errorBanca(
          'BANK_RECON_TARGET_TAKEN',
          'El documento ya está conciliado con otro movimiento',
        );
      }
      throw e;
    }
    return this.movimiento(transactionId);
  }

  /**
   * Desconcilia. Revierte a la fecha del movimiento la comisión contabilizada
   * y, si se pide en un vencimiento, también la liquidación que creó (período
   * cerrado → 409). Sin `anularLiquidacion`, la liquidación sigue vigente
   * (quien concilió pudo equivocarse solo de movimiento) y vuelve a ofrecerse
   * como «cobro o pago ya registrado». Un talón sigue compensado.
   */
  async desconciliar(
    transactionId: string,
    input: DesconciliacionInput | undefined,
    version: number | undefined,
  ): Promise<BankTransactionDto> {
    const d = desconciliacionSchema.parse(input ?? {});
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const mov = await this.bloquearMovimiento(tx, transactionId);
      verificarVersion(mov.version, version);
      if (!mov.reconciliationKind) {
        throw errorBanca(
          'BANK_MOVEMENT_NOT_RECONCILED',
          'El movimiento no está conciliado',
        );
      }
      const motivo = `Desconciliación: ${d.motivo || mov.concept}`.slice(
        0,
        240,
      );
      if (mov.feeEntryId) {
        await this.contabilidad.anularEnTx(
          tx,
          companyId,
          mov.feeEntryId,
          motivo,
          mov.transactionDate,
        );
      }
      if (
        d.anularLiquidacion &&
        mov.reconciliationKind === 'vencimiento' &&
        mov.reconciledSettlementId
      ) {
        await anularLiquidacion(
          this.contexto(tx),
          mov.reconciledSettlementId,
          motivo,
        );
        await this.contabilidad.anularDeOrigenEnTx(
          tx,
          companyId,
          ['cobro', 'pago'],
          mov.reconciledSettlementId,
          motivo,
          mov.transactionDate,
        );
      }
      const [act] = await tx
        .update(bankTransactions)
        .set({
          ...SIN_CONCILIAR,
          version: sql`${bankTransactions.version} + 1`,
        })
        .where(eq(bankTransactions.id, mov.id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'bank_transaction',
        entityId: mov.id,
        action: 'update',
        oldData: enlace(mov),
        newData: diferenciasAuditoria(enlace(mov), enlace(act)),
        meta: {
          desconciliacion: true,
          anularLiquidacion: d.anularLiquidacion ?? false,
        },
      });
    });
    return this.movimiento(transactionId);
  }

  async unreconcile(transactionId: string): Promise<void> {
    await this.desconciliar(transactionId, {}, undefined);
  }

  async movimiento(id: string): Promise<BankTransactionDto> {
    const [row] = await this.dbs.db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, id),
          eq(bankTransactions.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!row)
      throw new NotFoundException({
        code: 'BANK_MOVEMENT_NOT_FOUND',
        message: 'Movimiento no encontrado',
      });
    return toDto(row);
  }

  private async bloquearMovimiento(
    tx: Tx,
    id: string,
  ): Promise<BankTransaction> {
    const [row] = await tx
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, id),
          eq(bankTransactions.companyId, this.dbs.getCompanyId()),
        ),
      )
      .for('update');
    if (!row)
      throw new NotFoundException({
        code: 'BANK_MOVEMENT_NOT_FOUND',
        message: 'Movimiento no encontrado',
      });
    return row;
  }

  private async findBankAccount(id: string): Promise<BankAccount> {
    const companyId = this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, id),
          eq(bankAccounts.companyId, companyId),
          isNull(bankAccounts.deletedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Cuenta bancaria no encontrada',
      });
    return row;
  }
}
