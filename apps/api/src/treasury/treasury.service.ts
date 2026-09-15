import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, ne, SQL } from 'drizzle-orm';
import {
  BankAccount,
  bankAccounts,
  contacts,
  invoiceLines,
  invoices,
  paymentMilestones,
} from '@erp/db';
import {
  BankAccountCreateInput,
  BankAccountDto,
  BankAccountUpdateInput,
  CashflowBucketDto,
  CashflowGrouping,
  CashflowReportDto,
  ILLIQUIDITY_HORIZONS,
  IlliquidityHorizonDto,
  IlliquidityProjectionDto,
  MilestoneDirection,
  MilestoneDto,
  MilestoneStatus,
  addDays,
  addMonths,
  bankAccountCreateSchema,
  bankAccountUpdateSchema,
  hasAllowedProject,
  round2,
  startOfMonth,
  startOfWeek,
  todayIso,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';

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
    const [row] = await this.dbs.db
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
    void this.audit.log({
      entityType: 'bank_account',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return bankAccountToDto(row);
  }

  async updateBankAccount(
    id: string,
    input: BankAccountUpdateInput,
  ): Promise<BankAccountDto> {
    await this.findBankAccount(id);
    const data = bankAccountUpdateSchema.parse(input);
    const [row] = await this.dbs.db
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
    void this.audit.log({
      entityType: 'bank_account',
      entityId: row.id,
      action: 'update',
      newData: row,
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
    if (!row) throw new NotFoundException('Cuenta no encontrada');
    return row;
  }

  async milestones(options: {
    direction?: MilestoneDirection;
    status?: MilestoneStatus;
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
    if (options.from)
      filters.push(gte(paymentMilestones.dueDate, options.from));
    if (options.to) filters.push(lte(paymentMilestones.dueDate, options.to));

    const rows = await this.dbs.db
      .select({
        milestone: paymentMilestones,
        invoiceNumber: invoices.invoiceNumber,
        contactName: contacts.legalName,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(paymentMilestones.invoiceId, invoices.id))
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(and(...filters))
      .orderBy(asc(paymentMilestones.dueDate));

    return rows.map(({ milestone, invoiceNumber, contactName }) => ({
      id: milestone.id,
      invoiceId: milestone.invoiceId,
      invoiceNumber,
      contactName,
      direction: milestone.direction as MilestoneDirection,
      kind: milestone.kind as MilestoneDto['kind'],
      dueDate: milestone.dueDate,
      amount: Number(milestone.amount),
      status: milestone.status as MilestoneStatus,
      paidAt: milestone.paidAt,
    }));
  }

  /** Liquida o reabre un vencimiento y sincroniza el estado de la factura. */
  async setStatus(id: string, status: MilestoneStatus): Promise<void> {
    const [row] = await this.dbs.db
      .select()
      .from(paymentMilestones)
      .where(eq(paymentMilestones.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Vencimiento no encontrado');
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
        throw new NotFoundException('Vencimiento no encontrado');
      }
    }
    if (row.status === status) {
      throw new ConflictException('El vencimiento ya está en ese estado');
    }
    // Homologación PRL: no se paga a una subcontrata bloqueada. Reabrir un
    // vencimiento sí se permite siempre (es deshacer, no comprometer dinero).
    if (status === 'pagado' && row.direction === 'pago') {
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
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(paymentMilestones)
        .set({
          status,
          paidAt: status === 'pagado' ? todayIso() : null,
          updatedAt: new Date(),
        })
        .where(eq(paymentMilestones.id, id));

      // La factura queda pagada cuando no le quedan vencimientos previstos
      const [pending] = await tx
        .select({ id: paymentMilestones.id })
        .from(paymentMilestones)
        .where(
          and(
            eq(paymentMilestones.invoiceId, row.invoiceId),
            eq(paymentMilestones.status, 'previsto'),
          ),
        )
        .limit(1);
      await tx
        .update(invoices)
        .set({
          status: pending ? 'aprobada' : 'pagada',
          updatedAt: new Date(),
        })
        .where(
          and(eq(invoices.id, row.invoiceId), ne(invoices.status, 'anulada')),
        );
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
      if (item.direction === 'cobro') bucket.cobros += item.amount;
      else bucket.pagos += item.amount;
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
