import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import {
  BankAccount,
  BankTransaction,
  bankAccounts,
  bankTransactions,
  paymentMilestones,
} from '@erp/db';
import {
  BankImportSummaryDto,
  BankStatementFormat,
  BankTransactionDto,
  MatchCandidate,
  MilestoneForMatching,
  matchCandidates,
  parseBankStatement,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';
import { TreasuryService } from '../../treasury/treasury.service';

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
  };
}

export interface SuggestionDto {
  transactionId: string;
  candidates: MatchCandidate[];
}

@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly dbs: DbService,
    private readonly treasury: TreasuryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Importa un extracto y da de alta los movimientos nuevos; los ya
   * importados (mismo `bankAccountId`+fecha+importe+concepto, ver el único
   * de `bank_transactions`) se cuentan como duplicados y se saltan — así
   * reimportar el mismo fichero por error no duplica nada.
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

    let imported = 0;
    let duplicates = 0;
    for (const row of parsed) {
      const [existing] = await this.dbs.db
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
      await this.dbs.db.insert(bankTransactions).values({
        companyId,
        bankAccountId,
        transactionDate: row.transactionDate,
        amount: row.amount.toFixed(2),
        concept: row.concept,
        balanceAfter:
          row.balanceAfter === null ? null : row.balanceAfter.toFixed(2),
        bankReference: row.bankReference,
      });
      imported++;
    }
    return { total: parsed.length, imported, duplicates };
  }

  async list(
    bankAccountId?: string,
    reconciled?: boolean,
  ): Promise<BankTransactionDto[]> {
    const companyId = this.dbs.getCompanyId();
    const filters = [eq(bankTransactions.companyId, companyId)];
    if (bankAccountId) {
      filters.push(eq(bankTransactions.bankAccountId, bankAccountId));
    }
    if (reconciled === true) {
      filters.push(isNotNull(bankTransactions.reconciledMilestoneId));
    } else if (reconciled === false) {
      filters.push(isNull(bankTransactions.reconciledMilestoneId));
    }
    const rows = await this.dbs.db
      .select()
      .from(bankTransactions)
      .where(and(...filters))
      .orderBy(desc(bankTransactions.transactionDate));
    return rows.map(toDto);
  }

  /** Candidatos de conciliación para los movimientos sin conciliar de una cuenta. */
  async suggestions(bankAccountId: string): Promise<SuggestionDto[]> {
    await this.findBankAccount(bankAccountId);
    const companyId = this.dbs.getCompanyId();

    const pending = await this.dbs.db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.companyId, companyId),
          eq(bankTransactions.bankAccountId, bankAccountId),
          isNull(bankTransactions.reconciledMilestoneId),
        ),
      );
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
    const milestones: MilestoneForMatching[] = milestoneRows.map((m) => ({
      id: m.id,
      amount: Number(m.amount),
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

  /** Enlaza el movimiento con un vencimiento y lo marca `pagado` (reutiliza `TreasuryService`, no duplica la lógica). */
  async reconcile(transactionId: string, milestoneId: string): Promise<void> {
    const companyId = this.dbs.getCompanyId();
    const [tx] = await this.dbs.db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankTransactions.companyId, companyId),
        ),
      )
      .limit(1);
    if (!tx) throw new NotFoundException('Movimiento no encontrado');
    if (tx.reconciledMilestoneId) {
      throw new ConflictException('El movimiento ya está conciliado');
    }

    const [milestone] = await this.dbs.db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.id, milestoneId),
          eq(paymentMilestones.companyId, companyId),
        ),
      )
      .limit(1);
    if (!milestone) throw new NotFoundException('Vencimiento no encontrado');

    await this.dbs.db
      .update(bankTransactions)
      .set({ reconciledMilestoneId: milestoneId, reconciledAt: new Date() })
      .where(eq(bankTransactions.id, transactionId));
    await this.treasury.setStatus(milestoneId, 'pagado');
    void this.audit.log({
      entityType: 'bank_transaction',
      entityId: transactionId,
      action: 'update',
      newData: { reconciledMilestoneId: milestoneId },
    });
  }

  /**
   * Desenlaza el movimiento. Deliberadamente **no** devuelve el vencimiento
   * a `previsto`: quien concilió puede haberlo hecho porque el vencimiento
   * ya estaba pagado por otra vía y solo se equivocó de movimiento — revertir
   * el estado del vencimiento a la vez sería una segunda decisión de negocio
   * distinta, no la misma.
   */
  async unreconcile(transactionId: string): Promise<void> {
    const companyId = this.dbs.getCompanyId();
    const [tx] = await this.dbs.db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankTransactions.companyId, companyId),
        ),
      )
      .limit(1);
    if (!tx) throw new NotFoundException('Movimiento no encontrado');
    await this.dbs.db
      .update(bankTransactions)
      .set({ reconciledMilestoneId: null, reconciledAt: null })
      .where(eq(bankTransactions.id, transactionId));
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
    if (!row) throw new NotFoundException('Cuenta bancaria no encontrada');
    return row;
  }
}
