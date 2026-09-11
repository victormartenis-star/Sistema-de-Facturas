import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  Budget,
  BudgetItem,
  budgetItems,
  budgets,
  projects,
} from '@erp/db';
import {
  Bc3ImportResultDto,
  BudgetCreateInput,
  BudgetDetailDto,
  BudgetDto,
  BudgetItemCreateInput,
  BudgetItemDto,
  BudgetItemUpdateInput,
  BudgetSource,
  BudgetStatus,
  BudgetUpdateInput,
  budgetCreateSchema,
  budgetItemCreateSchema,
  budgetItemUpdateSchema,
  budgetUpdateSchema,
  round2,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { parseBc3 } from './bc3-parser';

const UNIQUE_VIOLATION = '23505';

// ─── Mappers ──────────────────────────────────────────────────────────────────

function itemToDto(row: BudgetItem): BudgetItemDto {
  return {
    id: row.id,
    budgetId: row.budgetId,
    code: row.code,
    name: row.name,
    unit: row.unit,
    unitPrice: Number(row.unitPrice),
    quantity: Number(row.quantity),
    totalAmount: Number(row.totalAmount),
    phaseId: row.phaseId ?? null,
    level: row.level,
    parentCode: row.parentCode ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function budgetToDto(
  row: Budget,
  totalAmount: number,
  itemCount: number,
): BudgetDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as BudgetStatus,
    source: row.source as BudgetSource,
    importedAt: row.importedAt?.toISOString() ?? null,
    notes: row.notes ?? null,
    totalAmount,
    itemCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BudgetsService {
  constructor(private readonly dbs: DbService) {}

  // ── Presupuestos ─────────────────────────────────────────────────────────────

  async listByProject(projectId: string): Promise<BudgetDto[]> {
    await this.findProject(projectId);

    const rows = await this.dbs.db
      .select({
        budget: budgets,
        totalAmount: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        itemCount: sql<number>`count(${budgetItems.id})::int`,
      })
      .from(budgets)
      .leftJoin(budgetItems, eq(budgetItems.budgetId, budgets.id))
      .where(and(eq(budgets.projectId, projectId), isNull(budgets.deletedAt)))
      .groupBy(budgets.id)
      .orderBy(asc(budgets.createdAt));

    return rows.map((r) =>
      budgetToDto(r.budget, Number(r.totalAmount), r.itemCount),
    );
  }

  async getDetail(id: string): Promise<BudgetDetailDto> {
    const budget = await this.findBudget(id);

    const [aggregate] = await this.dbs.db
      .select({
        totalAmount: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        itemCount: sql<number>`count(*)::int`,
      })
      .from(budgetItems)
      .where(eq(budgetItems.budgetId, id));

    const items = await this.dbs.db
      .select()
      .from(budgetItems)
      .where(eq(budgetItems.budgetId, id))
      .orderBy(asc(budgetItems.level), asc(budgetItems.sortOrder));

    return {
      ...budgetToDto(
        budget,
        Number(aggregate?.totalAmount ?? 0),
        aggregate?.itemCount ?? 0,
      ),
      items: items.map(itemToDto),
    };
  }

  async create(projectId: string, input: BudgetCreateInput): Promise<BudgetDto> {
    const companyId = this.dbs.getCompanyId();
    await this.findProject(projectId);
    const data = budgetCreateSchema.parse(input);

    const [row] = await this.dbs.db
      .insert(budgets)
      .values({
        companyId,
        projectId,
        name: data.name,
        notes: data.notes ?? null,
        source: 'manual',
      })
      .returning();

    return budgetToDto(row, 0, 0);
  }

  async update(id: string, input: BudgetUpdateInput): Promise<BudgetDto> {
    const budget = await this.findBudget(id);
    const data = budgetUpdateSchema.parse(input);

    // Si se quiere activar, desactivar el actual activo primero
    if (data.status === 'activo' && budget.status !== 'activo') {
      await this.dbs.db
        .update(budgets)
        .set({ status: 'cerrado', updatedAt: new Date() })
        .where(
          and(
            eq(budgets.projectId, budget.projectId),
            eq(budgets.status, 'activo'),
          ),
        );
    }

    const [updated] = await this.dbs.db
      .update(budgets)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes }),
        updatedAt: new Date(),
      })
      .where(eq(budgets.id, id))
      .returning();

    const [agg] = await this.dbs.db
      .select({
        totalAmount: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        itemCount: sql<number>`count(*)::int`,
      })
      .from(budgetItems)
      .where(eq(budgetItems.budgetId, id));

    return budgetToDto(updated, Number(agg?.totalAmount ?? 0), agg?.itemCount ?? 0);
  }

  async remove(id: string): Promise<void> {
    await this.findBudget(id);
    await this.dbs.db
      .update(budgets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(budgets.id, id));
  }

  // ── Importación BC3 ──────────────────────────────────────────────────────────

  async importBc3(
    projectId: string,
    name: string,
    fileContent: string,
  ): Promise<Bc3ImportResultDto> {
    const companyId = this.dbs.getCompanyId();
    await this.findProject(projectId);

    const { items, warnings, rootCode } = parseBc3(fileContent);

    if (items.length === 0) {
      throw new BadRequestException(
        `El archivo BC3 no contiene partidas válidas.` +
          (warnings.length ? ' ' + warnings.join(' ') : ''),
      );
    }

    // Crear presupuesto
    const [budget] = await this.dbs.db
      .insert(budgets)
      .values({
        companyId,
        projectId,
        name,
        source: 'bc3',
        importedAt: new Date(),
        notes: rootCode ? `Raíz BC3: ${rootCode}` : null,
      })
      .returning();

    // Insertar partidas en lotes de 200
    const BATCH = 200;
    const now = new Date();
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH);
      await this.dbs.db.insert(budgetItems).values(
        slice.map((item) => ({
          budgetId: budget.id,
          code: item.code,
          name: item.name,
          unit: item.unit,
          unitPrice: item.unitPrice.toFixed(4),
          quantity: item.quantity.toFixed(4),
          totalAmount: item.totalAmount.toFixed(2),
          level: item.level,
          parentCode: item.parentCode ?? null,
          sortOrder: item.sortOrder,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const dto = budgetToDto(
      budget,
      round2(items.reduce((s, i) => s + i.totalAmount, 0)),
      items.length,
    );

    return { budget: dto, itemsCreated: items.length, warnings };
  }

  // ── Partidas ─────────────────────────────────────────────────────────────────

  async createItem(
    budgetId: string,
    input: BudgetItemCreateInput,
  ): Promise<BudgetItemDto> {
    await this.findBudget(budgetId);
    const data = budgetItemCreateSchema.parse(input);
    const totalAmount = round2(data.unitPrice * data.quantity);

    try {
      const [row] = await this.dbs.db
        .insert(budgetItems)
        .values({
          budgetId,
          code: data.code,
          name: data.name,
          unit: data.unit,
          unitPrice: data.unitPrice.toFixed(4),
          quantity: data.quantity.toFixed(4),
          totalAmount: totalAmount.toFixed(2),
          phaseId: data.phaseId ?? null,
          level: data.level,
          parentCode: data.parentCode ?? null,
          sortOrder: data.sortOrder,
        })
        .returning();
      return itemToDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, data.code);
    }
  }

  async updateItem(
    itemId: string,
    input: BudgetItemUpdateInput,
  ): Promise<BudgetItemDto> {
    const existing = await this.findItem(itemId);
    const data = budgetItemUpdateSchema.parse(input);

    const unitPrice =
      data.unitPrice !== undefined ? data.unitPrice : Number(existing.unitPrice);
    const quantity =
      data.quantity !== undefined ? data.quantity : Number(existing.quantity);
    const totalAmount = round2(unitPrice * quantity);

    const [row] = await this.dbs.db
      .update(budgetItems)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.unitPrice !== undefined && {
          unitPrice: data.unitPrice.toFixed(4),
        }),
        ...(data.quantity !== undefined && {
          quantity: data.quantity.toFixed(4),
        }),
        ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
        ...(data.parentCode !== undefined && {
          parentCode: data.parentCode ?? null,
        }),
        ...(data.level !== undefined && { level: data.level }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        totalAmount: totalAmount.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(budgetItems.id, itemId))
      .returning();

    return itemToDto(row);
  }

  async removeItem(itemId: string): Promise<void> {
    await this.findItem(itemId);
    await this.dbs.db.delete(budgetItems).where(eq(budgetItems.id, itemId));
  }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  private async findProject(projectId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row;
  }

  async findBudget(id: string): Promise<Budget> {
    const [row] = await this.dbs.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, id), isNull(budgets.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Presupuesto no encontrado');
    return row;
  }

  private async findItem(id: string): Promise<BudgetItem> {
    const [row] = await this.dbs.db
      .select()
      .from(budgetItems)
      .where(eq(budgetItems.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Partida no encontrada');
    return row;
  }

  private rethrowDuplicateCode(err: unknown, code: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException(
        `Ya existe una partida con el código "${code}" en este presupuesto`,
      );
    }
    throw err;
  }
}
