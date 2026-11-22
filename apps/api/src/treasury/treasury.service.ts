import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  sql,
  SQL,
} from 'drizzle-orm';
import {
  BankAccount,
  bankAccounts,
  certifications,
  contacts,
  invoiceLines,
  invoices,
  paymentMilestones,
  paymentSettlements,
  type PaymentSettlement,
  type Tx,
} from '@erp/db';
import {
  BankAccountCreateInput,
  BankAccountDto,
  BankAccountUpdateInput,
  CashflowBucketDto,
  CashflowGrouping,
  CashflowReportDto,
  CrossedMaturitiesReportDto,
  ILLIQUIDITY_HORIZONS,
  IlliquidityHorizonDto,
  IlliquidityProjectionDto,
  MaturityGroupDto,
  MilestoneDirection,
  MilestoneDetailDto,
  MilestoneDto,
  EstadoLiquidacion,
  SettlementCancelInput,
  SettlementCreateInput,
  SettlementDto,
  SettlementStatus,
  resumenLiquidacion,
  settlementCancelSchema,
  settlementCreateSchema,
  toCents,
  MilestoneStatus,
  PaymentInstrument,
  addDays,
  addMonths,
  bankAccountCreateSchema,
  bankAccountUpdateSchema,
  hasAllowedProject,
  round2,
  setPaymentInstrumentSchema,
  startOfMonth,
  startOfWeek,
  todayIso,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { ComplianceService } from '../compliance/compliance.service';
import { getRequestContext } from '../common/request-context';
import { DbService } from '../db/db.service';
import {
  anularLiquidacion,
  anularTodas,
  liquidarPendiente,
  registrarLiquidacion,
  type Contexto,
  type DatosLiquidacion,
} from './liquidaciones';

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function bankAccountToDto(row: BankAccount): BankAccountDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as BankAccountDto['kind'],
    iban: row.iban,
    currentBalance: Number(row.currentBalance),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function settlementToDto(
  s: PaymentSettlement,
  bankAccountName: string | null,
): SettlementDto {
  return {
    id: s.id,
    milestoneId: s.milestoneId,
    amount: Number(s.amount),
    settledOn: s.settledOn,
    status: s.status as SettlementStatus,
    bankAccountId: s.bankAccountId,
    bankAccountName,
    bankTransactionId: s.bankTransactionId,
    paymentInstrument: s.paymentInstrument as PaymentInstrument,
    reference: s.reference,
    notes: s.notes,
    reversalReason: s.reversalReason,
    reversedAt: s.reversedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    version: s.version,
  };
}

function bucketLabel(periodStart: string, groupBy: CashflowGrouping): string {
  if (groupBy === 'mes') {
    const [y, m] = periodStart.split('-');
    return `${MONTHS_ES[Number(m) - 1]} ${y}`;
  }
  const [, m, d] = periodStart.split('-');
  return `Sem. ${d}/${m}`;
}

@Injectable()
export class TreasuryService {
  constructor(
    private readonly dbs: DbService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
  ) {}

  /* ─────────────────────── cuentas bancarias y caja ─────────────────────── */

  async listBankAccounts(activa?: boolean): Promise<BankAccountDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const filters = [
      eq(bankAccounts.companyId, companyId),
      isNull(bankAccounts.deletedAt),
    ];
    if (activa !== undefined) filters.push(eq(bankAccounts.isActive, activa));
    const rows = await this.dbs.db
      .select()
      .from(bankAccounts)
      .where(and(...filters))
      .orderBy(asc(bankAccounts.name));
    return rows.map(bankAccountToDto);
  }

  async createBankAccount(
    input: BankAccountCreateInput,
  ): Promise<BankAccountDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = bankAccountCreateSchema.parse(input);
    const row = await this.dbs.db.transaction(async (tx) => {
      const [creada] = await tx
        .insert(bankAccounts)
        .values({
          companyId,
          name: data.name,
          kind: data.kind,
          iban: data.iban ?? null,
          currentBalance: data.currentBalance.toFixed(2),
          isActive: data.isActive,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'bank_account',
        entityId: creada.id,
        action: 'create',
        newData: creada,
      });
      return creada;
    });
    return bankAccountToDto(row);
  }

  async updateBankAccount(
    id: string,
    input: BankAccountUpdateInput,
  ): Promise<BankAccountDto> {
    await this.findBankAccount(id);
    const data = bankAccountUpdateSchema.parse(input);
    const row = await this.dbs.db.transaction(async (tx) => {
      const [actualizada] = await tx
        .update(bankAccounts)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.kind !== undefined && { kind: data.kind }),
          ...(data.iban !== undefined && { iban: data.iban ?? null }),
          ...(data.currentBalance !== undefined && {
            currentBalance: data.currentBalance.toFixed(2),
          }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          updatedAt: new Date(),
        })
        .where(eq(bankAccounts.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'bank_account',
        entityId: actualizada.id,
        action: 'update',
        newData: actualizada,
      });
      return actualizada;
    });
    return bankAccountToDto(row);
  }

  private async findBankAccount(id: string): Promise<BankAccount> {
    const companyId = await this.dbs.getCompanyId();
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
        code: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada',
      });
    return row;
  }

  async milestones(options: {
    direction?: MilestoneDirection;
    status?: MilestoneStatus;
    settlementState?: EstadoLiquidacion;
    from?: string;
    to?: string;
  }): Promise<MilestoneDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters: SQL[] = [
      eq(paymentMilestones.companyId, companyId),
      isNull(invoices.deletedAt),
      ne(invoices.status, 'anulada'),
    ];
    if (allowed !== null) {
      // Rol obra: solo vencimientos de facturas con alguna línea en sus obras.
      if (allowed.length === 0) return [];
      const invoiceIds = await this.invoiceIdsForProjects(allowed);
      if (invoiceIds.length === 0) return [];
      filters.push(inArray(paymentMilestones.invoiceId, invoiceIds));
    }
    if (options.direction) {
      filters.push(eq(paymentMilestones.direction, options.direction));
    }
    if (options.status) {
      filters.push(eq(paymentMilestones.status, options.status));
    }
    if (options.settlementState === 'liquidado') {
      filters.push(eq(paymentMilestones.status, 'pagado'));
    } else if (options.settlementState) {
      filters.push(eq(paymentMilestones.status, 'previsto'));
      filters.push(
        options.settlementState === 'parcial'
          ? sql`${paymentMilestones.settledAmount} <> 0`
          : sql`${paymentMilestones.settledAmount} = 0`,
      );
    }
    if (options.from)
      filters.push(gte(paymentMilestones.dueDate, options.from));
    if (options.to) filters.push(lte(paymentMilestones.dueDate, options.to));

    const rows = await this.dbs.db
      .select({
        milestone: paymentMilestones,
        invoiceNumber: invoices.invoiceNumber,
        contactName: contacts.legalName,
        certificationId: certifications.id,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(paymentMilestones.invoiceId, invoices.id))
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .leftJoin(
        certifications,
        and(
          eq(certifications.invoiceId, invoices.id),
          isNull(certifications.deletedAt),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(paymentMilestones.dueDate));

    return rows.map(
      ({ milestone, invoiceNumber, contactName, certificationId }) =>
        this.milestoneToDto(
          milestone,
          invoiceNumber,
          contactName,
          certificationId !== null,
        ),
    );
  }

  private milestoneToDto(
    milestone: typeof paymentMilestones.$inferSelect,
    invoiceNumber: string,
    contactName: string,
    fromCertification: boolean,
  ): MilestoneDto {
    const resumen = resumenLiquidacion(
      milestone.amount,
      milestone.settledAmount,
    );
    return {
      id: milestone.id,
      invoiceId: milestone.invoiceId,
      invoiceNumber,
      contactName,
      direction: milestone.direction as MilestoneDirection,
      kind: milestone.kind as MilestoneDto['kind'],
      paymentInstrument: milestone.paymentInstrument as PaymentInstrument,
      fromCertification,
      dueDate: milestone.dueDate,
      amount: resumen.importe,
      status: milestone.status as MilestoneStatus,
      paidAt: milestone.paidAt,
      settledAmount: resumen.liquidado,
      pendingAmount: resumen.pendiente,
      settlementState: resumen.estado,
      version: milestone.version,
    };
  }

  /* ───────────────────── liquidaciones (cobros y pagos) ───────────────────── */

  private contexto(tx: Tx): Contexto {
    return {
      tx,
      audit: this.audit,
      companyId: this.dbs.getCompanyId(),
      userId: getRequestContext()?.userId ?? null,
    };
  }

  /**
   * Comprobaciones previas comunes: el vencimiento existe en la empresa, el
   * rol obra solo ve los de sus obras y, para pagar a un proveedor, la
   * homologación PRL lo permite (deshacer siempre se permite).
   */
  private async comprobarAcceso(
    id: string,
    comprometeDinero: boolean,
  ): Promise<typeof paymentMilestones.$inferSelect> {
    const companyId = this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.id, id),
          eq(paymentMilestones.companyId, companyId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException({
        code: 'DUE_NOT_FOUND',
        message: 'Vencimiento no encontrado',
      });
    }
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      const lines = await this.dbs.db
        .select({ projectId: invoiceLines.projectId })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, row.invoiceId));
      if (
        !hasAllowedProject(
          allowed,
          lines.map((l) => l.projectId),
        )
      ) {
        throw new NotFoundException({
          code: 'DUE_NOT_FOUND',
          message: 'Vencimiento no encontrado',
        });
      }
    }
    if (comprometeDinero && row.direction === 'pago') {
      const [invoice] = await this.dbs.db
        .select({ contactId: invoices.contactId })
        .from(invoices)
        .where(eq(invoices.id, row.invoiceId))
        .limit(1);
      if (invoice) {
        await this.compliance.assertCanTransact(
          invoice.contactId,
          'liquidar el pago',
        );
      }
    }
    return row;
  }

  /** Detalle del vencimiento con el historial de liquidaciones (vigentes y anuladas). */
  async milestoneDetail(id: string): Promise<MilestoneDetailDto> {
    await this.comprobarAcceso(id, false);
    const [row] = await this.dbs.db
      .select({
        milestone: paymentMilestones,
        invoiceNumber: invoices.invoiceNumber,
        contactName: contacts.legalName,
        certificationId: certifications.id,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(paymentMilestones.invoiceId, invoices.id))
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .leftJoin(
        certifications,
        and(
          eq(certifications.invoiceId, invoices.id),
          isNull(certifications.deletedAt),
        ),
      )
      .where(eq(paymentMilestones.id, id))
      .limit(1);
    const liquidaciones = await this.dbs.db
      .select({ s: paymentSettlements, bankAccountName: bankAccounts.name })
      .from(paymentSettlements)
      .leftJoin(
        bankAccounts,
        eq(bankAccounts.id, paymentSettlements.bankAccountId),
      )
      .where(eq(paymentSettlements.milestoneId, id))
      .orderBy(
        asc(paymentSettlements.settledOn),
        asc(paymentSettlements.createdAt),
      );
    return {
      ...this.milestoneToDto(
        row.milestone,
        row.invoiceNumber,
        row.contactName,
        row.certificationId !== null,
      ),
      settlements: liquidaciones.map(({ s, bankAccountName }) =>
        settlementToDto(s, bankAccountName),
      ),
    };
  }

  /** Registra un cobro o pago (total o parcial) contra el vencimiento. */
  async settle(
    id: string,
    input: SettlementCreateInput,
    versionEsperada?: number,
  ): Promise<MilestoneDetailDto> {
    const data = settlementCreateSchema.parse(input);
    await this.comprobarAcceso(id, true);
    await this.dbs.db.transaction((tx) =>
      registrarLiquidacion(
        this.contexto(tx),
        id,
        {
          cantidad: data.importe,
          fecha: data.fecha,
          bankAccountId: data.bankAccountId,
          paymentInstrument: data.paymentInstrument,
          referencia: data.referencia,
          notas: data.notas,
        },
        versionEsperada,
      ),
    );
    return this.milestoneDetail(id);
  }

  /** Anula una liquidación; el vencimiento recupera ese saldo vivo. */
  async cancelSettlement(
    settlementId: string,
    input: SettlementCancelInput,
    versionEsperada?: number,
  ): Promise<MilestoneDetailDto> {
    const data = settlementCancelSchema.parse(input);
    const [ref] = await this.dbs.db
      .select({ milestoneId: paymentSettlements.milestoneId })
      .from(paymentSettlements)
      .where(
        and(
          eq(paymentSettlements.id, settlementId),
          eq(paymentSettlements.companyId, this.dbs.getCompanyId()),
        ),
      )
      .limit(1);
    if (!ref) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Liquidación no encontrada',
      });
    }
    await this.comprobarAcceso(ref.milestoneId, false);
    await this.dbs.db.transaction((tx) =>
      anularLiquidacion(
        this.contexto(tx),
        settlementId,
        data.motivo,
        versionEsperada,
      ),
    );
    return this.milestoneDetail(ref.milestoneId);
  }

  /**
   * Variante para la conciliación bancaria: registra la liquidación dentro
   * de la transacción del enlace movimiento ↔ vencimiento (atómico).
   */
  async settleInTx(
    tx: Tx,
    milestoneId: string,
    datos: DatosLiquidacion,
  ): Promise<void> {
    await this.comprobarAcceso(milestoneId, true);
    await registrarLiquidacion(this.contexto(tx), milestoneId, datos);
  }

  /** Marca a mano el instrumento de cobro/pago de un vencimiento (informativo, sin integración bancaria). */
  async setPaymentInstrument(
    id: string,
    input: { paymentInstrument: PaymentInstrument },
  ): Promise<void> {
    const companyId = await this.dbs.getCompanyId();
    const data = setPaymentInstrumentSchema.parse(input);
    const [row] = await this.dbs.db
      .update(paymentMilestones)
      .set({ paymentInstrument: data.paymentInstrument, updatedAt: new Date() })
      .where(
        and(
          eq(paymentMilestones.id, id),
          eq(paymentMilestones.companyId, companyId),
        ),
      )
      .returning({ id: paymentMilestones.id });
    if (!row)
      throw new NotFoundException({
        code: 'DUE_NOT_FOUND',
        message: 'Vencimiento no encontrado',
      });
  }

  /**
   * Cruce de vencimientos: cobros por certificación de obra frente al resto,
   * y pagos aplazados por confirming/pagaré frente al resto — la pregunta
   * real de tesorería en construcción es si lo que se espera certificar
   * llega a tiempo de cubrir lo ya comprometido en instrumentos aplazados.
   */
  async crossedMaturities(
    from?: string,
    to?: string,
  ): Promise<CrossedMaturitiesReportDto> {
    const start = from ?? todayIso();
    const end = to ?? addDays(start, 90);
    const items = await this.milestones({
      status: 'previsto',
      from: start,
      to: end,
    });

    const group = (rows: MilestoneDto[]): MaturityGroupDto => ({
      total: round2(rows.reduce((s, r) => s + r.pendingAmount, 0)),
      items: rows,
    });

    const cobros = items.filter((m) => m.direction === 'cobro');
    const pagos = items.filter((m) => m.direction === 'pago');

    return {
      from: start,
      to: end,
      cobrosPorCertificacion: group(cobros.filter((m) => m.fromCertification)),
      cobrosOtros: group(cobros.filter((m) => !m.fromCertification)),
      pagosConfirmingPagare: group(
        pagos.filter(
          (m) =>
            m.paymentInstrument === 'confirming' ||
            m.paymentInstrument === 'pagare',
        ),
      ),
      pagosOtros: group(
        pagos.filter(
          (m) =>
            m.paymentInstrument !== 'confirming' &&
            m.paymentInstrument !== 'pagare',
        ),
      ),
    };
  }

  /**
   * Acciones de siempre, ahora sobre liquidaciones:
   *  - `pagado`: liquida TODO el saldo vivo con fecha de hoy (una liquidación).
   *  - `previsto` (reabrir): anula todas las liquidaciones vigentes.
   * 409 `DUE_ALREADY_IN_STATE` si ya está liquidado del todo o sin nada liquidado.
   */
  async setStatus(id: string, status: MilestoneStatus): Promise<void> {
    const row = await this.comprobarAcceso(id, status === 'pagado');
    const sinLiquidar = toCents(row.settledAmount) === 0n;
    if (
      (status === 'pagado' && row.status === 'pagado') ||
      (status === 'previsto' && sinLiquidar)
    ) {
      throw new ConflictException({
        code: 'DUE_ALREADY_IN_STATE',
        message: 'El vencimiento ya está en ese estado',
      });
    }
    await this.dbs.db.transaction(async (tx) => {
      const ctx = this.contexto(tx);
      if (status === 'pagado') {
        await liquidarPendiente(ctx, id, { fecha: todayIso() });
      } else {
        await anularTodas(ctx, id, 'Reapertura del vencimiento');
      }
    });
  }

  /**
   * Previsión de flujo de caja: agrupa los vencimientos previstos por
   * semana o mes y marca con alerta de tensión los periodos en los que
   * el saldo acumulado (cobros - pagos) queda en negativo.
   */
  async cashflow(
    from?: string,
    to?: string,
    groupBy: CashflowGrouping = 'semana',
  ): Promise<CashflowReportDto> {
    const start = from ?? todayIso();
    const end = to ?? addDays(start, 90);
    const items = await this.milestones({
      status: 'previsto',
      from: start,
      to: end,
    });

    const keyOf = groupBy === 'mes' ? startOfMonth : startOfWeek;
    const step =
      groupBy === 'mes'
        ? (iso: string) => addMonths(iso, 1)
        : (iso: string) => addDays(iso, 7);

    // Construye todos los periodos del horizonte, aunque estén vacíos
    const totals = new Map<string, { cobros: number; pagos: number }>();
    for (let cursor = keyOf(start); cursor <= end; cursor = step(cursor)) {
      totals.set(cursor, { cobros: 0, pagos: 0 });
    }
    for (const item of items) {
      const key = keyOf(item.dueDate);
      const bucket = totals.get(key) ?? { cobros: 0, pagos: 0 };
      // Solo el saldo vivo: lo ya cobrado o pagado en parte no vuelve a contar.
      if (item.direction === 'cobro') bucket.cobros += item.pendingAmount;
      else bucket.pagos += item.pendingAmount;
      totals.set(key, bucket);
    }

    const saldoInicial = await this.bankBalance();
    let saldo = saldoInicial;
    let alertas = 0;
    const buckets: CashflowBucketDto[] = [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodStart, t]) => {
        const cobros = round2(t.cobros);
        const pagos = round2(t.pagos);
        const neto = round2(cobros - pagos);
        saldo = round2(saldo + neto);
        const tension = saldo < 0;
        if (tension) alertas += 1;
        return {
          periodStart,
          label: bucketLabel(periodStart, groupBy),
          cobros,
          pagos,
          neto,
          saldoAcumulado: saldo,
          tension,
        };
      });

    return {
      from: start,
      to: end,
      groupBy,
      buckets,
      totalCobros: round2(buckets.reduce((s, b) => s + b.cobros, 0)),
      totalPagos: round2(buckets.reduce((s, b) => s + b.pagos, 0)),
      saldoInicial,
      saldoFinal: saldo,
      alertas,
    };
  }

  /**
   * Proyección de iliquidez a 30/60/90 días: para cada horizonte, reutiliza
   * `cashflow()` (mismo saldo inicial de cuentas activas) y señala si el
   * saldo acumulado llega a quedar en negativo dentro del periodo.
   */
  async illiquidityProjection(
    from?: string,
  ): Promise<IlliquidityProjectionDto> {
    const start = from ?? todayIso();
    const saldoInicial = await this.bankBalance();
    const horizontes: IlliquidityHorizonDto[] = [];
    for (const horizon of ILLIQUIDITY_HORIZONS) {
      const to = addDays(start, horizon);
      const report = await this.cashflow(start, to, 'semana');
      const tensionBucket = report.buckets.find((b) => b.tension);
      horizontes.push({
        horizon,
        to,
        saldoFinal: report.saldoFinal,
        tension: report.alertas > 0,
        primeraTensionEn: tensionBucket?.periodStart ?? null,
      });
    }
    return { from: start, saldoInicial, horizontes };
  }

  /** Suma de saldos de las cuentas bancarias/caja activas: el punto de partida de la proyección. */
  private async bankBalance(): Promise<number> {
    const companyId = await this.dbs.getCompanyId();
    const rows = await this.dbs.db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.companyId, companyId),
          eq(bankAccounts.isActive, true),
          isNull(bankAccounts.deletedAt),
        ),
      );
    return round2(rows.reduce((sum, r) => sum + Number(r.currentBalance), 0));
  }

  /** IDs de factura con al menos una línea imputada a una de las obras dadas. */
  private async invoiceIdsForProjects(projectIds: string[]): Promise<string[]> {
    const rows = await this.dbs.db
      .selectDistinct({ invoiceId: invoiceLines.invoiceId })
      .from(invoiceLines)
      .where(inArray(invoiceLines.projectId, projectIds));
    return rows.map((r) => r.invoiceId);
  }
}
