import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  Investor,
  InvestmentAccount,
  InvestmentCashflow,
  InvestmentParticipation,
  investmentAccounts,
  investmentCashflows,
  investmentParticipations,
  investors,
  projects,
} from '@erp/db';
import {
  DistributeDividendInput,
  DistributeDividendResultDto,
  InvestmentAccountCreateInput,
  InvestmentAccountDto,
  InvestmentAccountReportDto,
  InvestmentAccountUpdateInput,
  InvestmentCashflowCreateInput,
  InvestmentCashflowDto,
  InvestorCreateInput,
  InvestorDto,
  InvestorReturnRowDto,
  InvestorUpdateInput,
  ParticipationCreateInput,
  ParticipationDto,
  ParticipationUpdateInput,
  computeIrr,
  computeNpv,
  distributeDividend,
  distributeDividendSchema,
  investmentAccountCreateSchema,
  investmentAccountUpdateSchema,
  investmentCashflowCreateSchema,
  investorCreateSchema,
  investorUpdateSchema,
  participationCreateSchema,
  participationUpdateSchema,
  todayIso,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function investorToDto(row: Investor): InvestorDto {
  return {
    id: row.id,
    kind: row.kind,
    legalName: row.legalName,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    iban: row.iban,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function cashflowToDto(
  row: InvestmentCashflow,
  investorName: string,
): InvestmentCashflowDto {
  return {
    id: row.id,
    accountId: row.accountId,
    investorId: row.investorId,
    investorName,
    direction: row.direction,
    flowDate: row.flowDate,
    amount: Number(row.amount),
    concept: row.concept,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class InvestorsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────── inversores ────────────────────── */

  async listInvestors(): Promise<InvestorDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const rows = await this.dbs.db
      .select()
      .from(investors)
      .where(
        and(eq(investors.companyId, companyId), isNull(investors.deletedAt)),
      )
      .orderBy(asc(investors.legalName));
    return rows.map(investorToDto);
  }

  async createInvestor(input: InvestorCreateInput): Promise<InvestorDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = investorCreateSchema.parse(input);
    const [row] = await this.dbs.db
      .insert(investors)
      .values({
        companyId,
        kind: data.kind,
        legalName: data.legalName,
        taxId: data.taxId ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        iban: data.iban ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    void this.audit.log({
      entityType: 'investor',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return investorToDto(row);
  }

  async updateInvestor(
    id: string,
    input: InvestorUpdateInput,
  ): Promise<InvestorDto> {
    await this.findInvestor(id);
    const data = investorUpdateSchema.parse(input);
    const [row] = await this.dbs.db
      .update(investors)
      .set({
        ...(data.kind !== undefined && { kind: data.kind }),
        ...(data.legalName !== undefined && { legalName: data.legalName }),
        ...(data.taxId !== undefined && { taxId: data.taxId ?? null }),
        ...(data.email !== undefined && { email: data.email ?? null }),
        ...(data.phone !== undefined && { phone: data.phone ?? null }),
        ...(data.iban !== undefined && { iban: data.iban ?? null }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(investors.id, id))
      .returning();
    return investorToDto(row);
  }

  /* ────────────────────── cuentas en participación ────────────────────── */

  async listAccounts(projectId?: string): Promise<InvestmentAccountDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && allowed.length === 0) return [];

    const conditions = [
      eq(investmentAccounts.companyId, companyId),
      isNull(investmentAccounts.deletedAt),
    ];
    if (projectId) conditions.push(eq(investmentAccounts.projectId, projectId));

    const rows = await this.dbs.db
      .select({ account: investmentAccounts, projectCode: projects.code })
      .from(investmentAccounts)
      .leftJoin(projects, eq(investmentAccounts.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(asc(investmentAccounts.name));

    // Cuentas a nivel de empresa (projectId nulo) solo las ve quien no
    // tenga restricción de obra — un rol `obra`/`cliente` no debe ver
    // fondos que no están atados a ninguna de sus obras.
    const visible =
      allowed === null
        ? rows
        : rows.filter(
            (r) =>
              r.account.projectId !== null &&
              allowed.includes(r.account.projectId),
          );

    return Promise.all(
      visible.map((r) => this.accountToDto(r.account, r.projectCode)),
    );
  }

  async getAccount(id: string): Promise<InvestmentAccountDto> {
    const { account, projectCode } = await this.findAccountWithProject(id);
    return this.accountToDto(account, projectCode);
  }

  async createAccount(
    input: InvestmentAccountCreateInput,
  ): Promise<InvestmentAccountDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = investmentAccountCreateSchema.parse(input);
    let projectCode: string | null = null;
    if (data.projectId) {
      await this.assertProjectAccessible(data.projectId);
      projectCode = await this.projectCode(data.projectId);
    } else {
      await this.assertCompanyWideAllowed();
    }

    const [row] = await this.dbs.db
      .insert(investmentAccounts)
      .values({
        companyId,
        projectId: data.projectId ?? null,
        name: data.name,
        status: data.status,
        committedAmount: data.committedAmount.toFixed(2),
        currentValuationAmount:
          data.currentValuationAmount !== undefined &&
          data.currentValuationAmount !== null
            ? data.currentValuationAmount.toFixed(2)
            : null,
        startDate: data.startDate,
        notes: data.notes ?? null,
      })
      .returning();
    void this.audit.log({
      entityType: 'investment_account',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return this.accountToDto(row, projectCode);
  }

  async updateAccount(
    id: string,
    input: InvestmentAccountUpdateInput,
  ): Promise<InvestmentAccountDto> {
    const { account, projectCode } = await this.findAccountWithProject(id);
    const data = investmentAccountUpdateSchema.parse(input);

    const [row] = await this.dbs.db
      .update(investmentAccounts)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.committedAmount !== undefined && {
          committedAmount: data.committedAmount.toFixed(2),
        }),
        ...(data.currentValuationAmount !== undefined && {
          currentValuationAmount:
            data.currentValuationAmount === null
              ? null
              : data.currentValuationAmount.toFixed(2),
        }),
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(investmentAccounts.id, id))
      .returning();
    void this.audit.log({
      entityType: 'investment_account',
      entityId: row.id,
      action: 'update',
      newData: row,
    });
    return this.accountToDto(row, account.projectId ? projectCode : null);
  }

  async removeAccount(id: string): Promise<void> {
    const { account } = await this.findAccountWithProject(id);
    await this.dbs.db
      .update(investmentAccounts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(investmentAccounts.id, id));
    void this.audit.log({
      entityType: 'investment_account',
      entityId: account.id,
      action: 'delete',
    });
  }

  /* ────────────────────── participaciones ────────────────────── */

  async listParticipations(accountId: string): Promise<ParticipationDto[]> {
    await this.findAccountWithProject(accountId);
    return this.participationsForAccount(accountId);
  }

  async createParticipation(
    accountId: string,
    input: ParticipationCreateInput,
  ): Promise<ParticipationDto> {
    await this.findAccountWithProject(accountId);
    const data = participationCreateSchema.parse(input);
    const investor = await this.findInvestor(data.investorId);

    const [row] = await this.dbs.db
      .insert(investmentParticipations)
      .values({
        accountId,
        investorId: data.investorId,
        participationPct: data.participationPct.toFixed(4),
        committedAmount: data.committedAmount.toFixed(2),
        joinedAt: data.joinedAt,
      })
      .returning();
    void this.audit.log({
      entityType: 'investment_participation',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return this.participationToDto(row, investor.legalName);
  }

  async updateParticipation(
    accountId: string,
    participationId: string,
    input: ParticipationUpdateInput,
  ): Promise<ParticipationDto> {
    await this.findAccountWithProject(accountId);
    const existing = await this.findParticipation(accountId, participationId);
    const data = participationUpdateSchema.parse(input);
    const investor = await this.findInvestor(existing.investorId);

    const [row] = await this.dbs.db
      .update(investmentParticipations)
      .set({
        ...(data.participationPct !== undefined && {
          participationPct: data.participationPct.toFixed(4),
        }),
        ...(data.committedAmount !== undefined && {
          committedAmount: data.committedAmount.toFixed(2),
        }),
        ...(data.joinedAt !== undefined && { joinedAt: data.joinedAt }),
        updatedAt: new Date(),
      })
      .where(eq(investmentParticipations.id, participationId))
      .returning();
    return this.participationToDto(row, investor.legalName);
  }

  async removeParticipation(
    accountId: string,
    participationId: string,
  ): Promise<void> {
    await this.findAccountWithProject(accountId);
    await this.findParticipation(accountId, participationId);
    await this.dbs.db
      .delete(investmentParticipations)
      .where(eq(investmentParticipations.id, participationId));
    void this.audit.log({
      entityType: 'investment_participation',
      entityId: participationId,
      action: 'delete',
    });
  }

  /* ────────────────────── cashflows y reparto ────────────────────── */

  async listCashflows(accountId: string): Promise<InvestmentCashflowDto[]> {
    await this.findAccountWithProject(accountId);
    return this.cashflowsForAccount(accountId);
  }

  async createCashflow(
    accountId: string,
    input: InvestmentCashflowCreateInput,
  ): Promise<InvestmentCashflowDto> {
    await this.findAccountWithProject(accountId);
    const companyId = await this.dbs.getCompanyId();
    const data = investmentCashflowCreateSchema.parse(input);
    const investor = await this.findInvestor(data.investorId);

    const [row] = await this.dbs.db
      .insert(investmentCashflows)
      .values({
        companyId,
        accountId,
        investorId: data.investorId,
        direction: data.direction,
        flowDate: data.flowDate,
        amount: data.amount.toFixed(2),
        concept: data.concept ?? null,
      })
      .returning();
    void this.audit.log({
      entityType: 'investment_cashflow',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return cashflowToDto(row, investor.legalName);
  }

  /** Reparte un dividendo pro-rata entre los inversores de la cuenta (un cashflow `reparto` por inversor). */
  async distribute(
    accountId: string,
    input: DistributeDividendInput,
  ): Promise<DistributeDividendResultDto> {
    await this.findAccountWithProject(accountId);
    const companyId = await this.dbs.getCompanyId();
    const data = distributeDividendSchema.parse(input);
    const participations = await this.participationsForAccount(accountId);
    if (participations.length === 0) {
      throw new BadRequestException(
        'La cuenta no tiene inversores dados de alta todavía',
      );
    }

    const shares = distributeDividend(
      participations.map((p) => ({
        investorId: p.investorId,
        participationPct: p.participationPct,
      })),
      data.totalAmount,
    );

    const rows = await this.dbs.db
      .insert(investmentCashflows)
      .values(
        shares.map((s) => ({
          companyId,
          accountId,
          investorId: s.investorId,
          direction: 'reparto' as const,
          flowDate: data.flowDate,
          amount: s.amount.toFixed(2),
          concept: data.concept ?? null,
        })),
      )
      .returning();

    const namesByInvestor = new Map(
      participations.map((p) => [p.investorId, p.investorName]),
    );
    const created = rows.map((row) =>
      cashflowToDto(row, namesByInvestor.get(row.investorId) ?? ''),
    );

    void this.audit.log({
      entityType: 'investment_account',
      entityId: accountId,
      action: 'update',
      newData: { reparto: data },
    });

    return {
      accountId,
      totalAmount: data.totalAmount,
      flowDate: data.flowDate,
      created,
    };
  }

  /* ────────────────────── informe TIR/VAN ────────────────────── */

  async report(
    accountId: string,
    discountRate: number,
    asOfDate?: string,
  ): Promise<InvestmentAccountReportDto> {
    const { account } = await this.findAccountWithProject(accountId);
    const participations = await this.participationsForAccount(accountId);
    const cashflows = await this.cashflowsForAccount(accountId);
    const valuationDate = asOfDate ?? todayIso();
    const currentValuationAmount = account.currentValuationAmount
      ? Number(account.currentValuationAmount)
      : null;

    const investorRows: InvestorReturnRowDto[] = participations.map((p) => {
      const own = cashflows.filter((c) => c.investorId === p.investorId);
      const totalAportado = own
        .filter((c) => c.direction === 'aportacion')
        .reduce((s, c) => s + c.amount, 0);
      const totalRepartido = own
        .filter((c) => c.direction === 'reparto')
        .reduce((s, c) => s + c.amount, 0);

      const flows = own
        .map((c) => ({
          date: c.flowDate,
          amount: c.direction === 'aportacion' ? -c.amount : c.amount,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (currentValuationAmount !== null) {
        flows.push({
          date: valuationDate,
          amount: (currentValuationAmount * p.participationPct) / 100,
        });
      }

      return {
        investorId: p.investorId,
        investorName: p.investorName,
        participationPct: p.participationPct,
        totalAportado,
        totalRepartido,
        irr: computeIrr(flows),
        npv: computeNpv(discountRate, flows),
      };
    });

    const totalAportado = investorRows.reduce((s, r) => s + r.totalAportado, 0);
    const totalRepartido = investorRows.reduce(
      (s, r) => s + r.totalRepartido,
      0,
    );
    const accountFlows = cashflows
      .map((c) => ({
        date: c.flowDate,
        amount: c.direction === 'aportacion' ? -c.amount : c.amount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (currentValuationAmount !== null) {
      accountFlows.push({
        date: valuationDate,
        amount: currentValuationAmount,
      });
    }

    return {
      accountId,
      accountName: account.name,
      discountRate,
      asOfDate: valuationDate,
      totalAportado,
      totalRepartido,
      currentValuationAmount,
      irr: computeIrr(accountFlows),
      npv: computeNpv(discountRate, accountFlows),
      investors: investorRows,
    };
  }

  /* ────────────────────── privados ────────────────────── */

  private async participationsForAccount(
    accountId: string,
  ): Promise<ParticipationDto[]> {
    const rows = await this.dbs.db
      .select({
        participation: investmentParticipations,
        investorName: investors.legalName,
      })
      .from(investmentParticipations)
      .innerJoin(
        investors,
        eq(investmentParticipations.investorId, investors.id),
      )
      .where(eq(investmentParticipations.accountId, accountId))
      .orderBy(asc(investors.legalName));
    return rows.map((r) =>
      this.participationToDto(r.participation, r.investorName),
    );
  }

  private async cashflowsForAccount(
    accountId: string,
  ): Promise<InvestmentCashflowDto[]> {
    const rows = await this.dbs.db
      .select({
        cashflow: investmentCashflows,
        investorName: investors.legalName,
      })
      .from(investmentCashflows)
      .innerJoin(investors, eq(investmentCashflows.investorId, investors.id))
      .where(eq(investmentCashflows.accountId, accountId))
      .orderBy(asc(investmentCashflows.flowDate));
    return rows.map((r) => cashflowToDto(r.cashflow, r.investorName));
  }

  private participationToDto(
    row: InvestmentParticipation,
    investorName: string,
  ): ParticipationDto {
    return {
      id: row.id,
      accountId: row.accountId,
      investorId: row.investorId,
      investorName,
      participationPct: Number(row.participationPct),
      committedAmount: Number(row.committedAmount),
      joinedAt: row.joinedAt,
    };
  }

  private async accountToDto(
    row: InvestmentAccount,
    projectCode: string | null,
  ): Promise<InvestmentAccountDto> {
    const participations = await this.participationsForAccount(row.id);
    const totalParticipationPct = participations.reduce(
      (s, p) => s + p.participationPct,
      0,
    );
    return {
      id: row.id,
      projectId: row.projectId,
      projectCode,
      name: row.name,
      status: row.status,
      committedAmount: Number(row.committedAmount),
      currentValuationAmount: row.currentValuationAmount
        ? Number(row.currentValuationAmount)
        : null,
      startDate: row.startDate,
      notes: row.notes,
      totalParticipationPct: Math.round(totalParticipationPct * 100) / 100,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async findInvestor(id: string): Promise<Investor> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(investors)
      .where(
        and(
          eq(investors.id, id),
          eq(investors.companyId, companyId),
          isNull(investors.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Inversor no encontrado');
    return row;
  }

  private async findParticipation(
    accountId: string,
    participationId: string,
  ): Promise<InvestmentParticipation> {
    const [row] = await this.dbs.db
      .select()
      .from(investmentParticipations)
      .where(
        and(
          eq(investmentParticipations.id, participationId),
          eq(investmentParticipations.accountId, accountId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Participación no encontrada');
    return row;
  }

  private async findAccountWithProject(
    id: string,
  ): Promise<{ account: InvestmentAccount; projectCode: string | null }> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ account: investmentAccounts, projectCode: projects.code })
      .from(investmentAccounts)
      .leftJoin(projects, eq(investmentAccounts.projectId, projects.id))
      .where(
        and(
          eq(investmentAccounts.id, id),
          eq(investmentAccounts.companyId, companyId),
          isNull(investmentAccounts.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Cuenta no encontrada');
    if (row.account.projectId) {
      await this.assertProjectAccessible(row.account.projectId);
    } else {
      await this.assertCompanyWideAllowed();
    }
    return { account: row.account, projectCode: row.projectCode };
  }

  private async projectCode(projectId: string): Promise<string | null> {
    const [row] = await this.dbs.db
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return row?.code ?? null;
  }

  private async assertProjectAccessible(projectId: string): Promise<void> {
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
  }

  /** Cuentas a nivel de empresa (`projectId` nulo): solo para roles sin restricción de obra. */
  private async assertCompanyWideAllowed(): Promise<void> {
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      throw new NotFoundException('Cuenta no encontrada');
    }
  }
}
