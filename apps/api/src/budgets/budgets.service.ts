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
  DbOrTx,
  budgetItems,
  budgets,
  projects,
} from '@erp/db';
import {
  Bc3ImportResultDto,
  BUDGET_STATUS_LABELS,
  BUDGET_TRANSITIONS,
  BudgetCreateInput,
  BudgetDetailDto,
  BudgetDto,
  BudgetDuplicateInput,
  BudgetItemCreateInput,
  BudgetItemDto,
  BudgetItemUpdateInput,
  BudgetSource,
  BudgetStatus,
  BudgetUpdateInput,
  PaginaDto,
  calcularOffset,
  construirPagina,
  budgetCreateSchema,
  budgetDuplicateSchema,
  budgetEditBlockReason,
  budgetItemCreateSchema,
  budgetItemEditBlockReason,
  budgetItemStructureBlockReason,
  budgetItemUpdateSchema,
  budgetUpdateSchema,
  canDeleteBudget,
  centsToNumeric,
  lineAmountCents,
  motivoTransicionInvalida,
  round2,
} from '@erp/shared';
import { cambiarEstado, cambiarEstadoMasivo } from '../common/cambiar-estado';
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

  async listByProject(
    projectId: string,
    status?: BudgetStatus,
    /** Con página, responde `PaginaDto`; sin ella, el array completo. */
    pagina?: { page: number; pageSize: number },
  ): Promise<BudgetDto[] | PaginaDto<BudgetDto>> {
    await this.findProject(projectId);

    const filtros = [
      eq(budgets.projectId, projectId),
      isNull(budgets.deletedAt),
    ];
    if (status) filtros.push(eq(budgets.status, status));
    const query = this.dbs.db
      .select({
        budget: budgets,
        totalAmount: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        itemCount: sql<number>`count(${budgetItems.id})::int`,
      })
      .from(budgets)
      .leftJoin(budgetItems, eq(budgetItems.budgetId, budgets.id))
      .where(and(...filtros))
      .groupBy(budgets.id)
      .orderBy(asc(budgets.createdAt), asc(budgets.id));
    const aDto = (r: Awaited<typeof query>[number]) =>
      budgetToDto(r.budget, Number(r.totalAmount), r.itemCount);

    if (!pagina) return (await query).map(aDto);
    // El total cuenta presupuestos (sin el join a las partidas).
    const [c] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(budgets)
      .where(and(...filtros));
    const rows = await query
      .limit(pagina.pageSize)
      .offset(calcularOffset(pagina.page, pagina.pageSize));
    return construirPagina(
      rows.map(aDto),
      c?.n ?? 0,
      pagina.page,
      pagina.pageSize,
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

  async create(
    projectId: string,
    input: BudgetCreateInput,
  ): Promise<BudgetDto> {
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
    const found = await this.findBudget(id);
    const data = budgetUpdateSchema.parse(input);

    // Cerrar el activo actual y activar el nuevo es una sola operación: si
    // falla la segunda mitad, la obra no puede quedarse sin presupuesto
    // activo. Se bloquea la fila de la obra para serializar dos activaciones
    // simultáneas (si no, podrían quedar dos presupuestos activos).
    const updated = await this.dbs.db.transaction(async (tx) => {
      if (data.status === 'activo' && found.status !== 'activo') {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, found.projectId))
          .for('update');
      }
      // Las reglas de estado se comprueban releyendo la fila con bloqueo.
      const budget = await this.lockBudget(tx, id);

      const campos = (['name', 'notes'] as const).filter(
        (c) => data[c] !== undefined,
      );
      const bloqueo = budgetEditBlockReason(
        budget.status as BudgetStatus,
        campos,
      );
      if (bloqueo) throw new ConflictException(bloqueo);

      if (data.status !== undefined && data.status !== budget.status) {
        const motivo = motivoTransicionInvalida(
          BUDGET_TRANSITIONS,
          budget.status as BudgetStatus,
          data.status,
          BUDGET_STATUS_LABELS,
          'El presupuesto',
        );
        if (motivo) throw new ConflictException(motivo);
      }

      if (data.status === 'activo' && budget.status !== 'activo') {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(budgetItems)
          .where(eq(budgetItems.budgetId, id));
        if (n === 0) {
          throw new ConflictException(
            'No se puede activar un presupuesto sin partidas',
          );
        }
        await cambiarEstadoMasivo(
          tx,
          budgets,
          'budget',
          eq(budgets.projectId, budget.projectId),
          'activo',
          'cerrado',
        );
      }

      const valores = {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.notes !== undefined && { notes: data.notes }),
      };
      if (data.status !== undefined && data.status !== budget.status) {
        return cambiarEstado(
          tx,
          budgets,
          'budget',
          id,
          budget.status as BudgetStatus,
          data.status,
          valores,
        );
      }
      const [row] = await tx
        .update(budgets)
        .set({ ...valores, updatedAt: new Date() })
        .where(eq(budgets.id, id))
        .returning();
      return row;
    });

    const [agg] = await this.dbs.db
      .select({
        totalAmount: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        itemCount: sql<number>`count(*)::int`,
      })
      .from(budgetItems)
      .where(eq(budgetItems.budgetId, id));

    return budgetToDto(
      updated,
      Number(agg?.totalAmount ?? 0),
      agg?.itemCount ?? 0,
    );
  }

  async remove(id: string): Promise<void> {
    await this.findBudget(id);
    await this.dbs.db.transaction(async (tx) => {
      const budget = await this.lockBudget(tx, id);
      if (!canDeleteBudget(budget.status as BudgetStatus)) {
        throw new ConflictException(
          `Solo se puede borrar un presupuesto en borrador (este está ${budget.status}). Ciérralo en lugar de borrarlo`,
        );
      }
      await tx
        .update(budgets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(budgets.id, id));
    });
  }

  /**
   * Nueva versión: copia cabecera y partidas a un borrador. Es la forma de
   * corregir un presupuesto activo o cerrado; al activarse cierra el anterior.
   */
  async duplicate(id: string, input: BudgetDuplicateInput): Promise<BudgetDto> {
    const original = await this.findBudget(id);
    const data = budgetDuplicateSchema.parse(input);
    const BATCH = 200;

    const { copy, count, total } = await this.dbs.db.transaction(async (tx) => {
      const items = await tx
        .select()
        .from(budgetItems)
        .where(eq(budgetItems.budgetId, id))
        .orderBy(asc(budgetItems.level), asc(budgetItems.sortOrder));

      const [created] = await tx
        .insert(budgets)
        .values({
          companyId: original.companyId,
          projectId: original.projectId,
          name: data.name ?? `${original.name} (copia)`,
          source: original.source,
          importedAt: original.importedAt,
          notes: original.notes,
        })
        .returning();

      for (let i = 0; i < items.length; i += BATCH) {
        await tx.insert(budgetItems).values(
          items.slice(i, i + BATCH).map((item) => ({
            budgetId: created.id,
            code: item.code,
            name: item.name,
            unit: item.unit,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalAmount: item.totalAmount,
            phaseId: item.phaseId,
            level: item.level,
            parentCode: item.parentCode,
            sortOrder: item.sortOrder,
          })),
        );
      }
      return {
        copy: created,
        count: items.length,
        total: items.reduce((sum, item) => sum + Number(item.totalAmount), 0),
      };
    });

    return budgetToDto(copy, round2(total), count);
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

    // Presupuesto y partidas en una sola transacción: si un lote falla no
    // queda un presupuesto importado a medias.
    const BATCH = 200;
    const now = new Date();
    let budget: Budget;
    try {
      budget = await this.dbs.db.transaction(async (tx) => {
        const [created] = await tx
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
        for (let i = 0; i < items.length; i += BATCH) {
          const slice = items.slice(i, i + BATCH);
          await tx.insert(budgetItems).values(
            slice.map((item) => ({
              budgetId: created.id,
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
        return created;
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new BadRequestException(
          'El archivo BC3 contiene códigos de partida repetidos',
        );
      }
      throw err;
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
    const totalAmount = centsToNumeric(
      lineAmountCents(data.unitPrice, data.quantity),
    );

    try {
      const row = await this.dbs.db.transaction(async (tx) => {
        const budget = await this.lockBudget(tx, budgetId);
        const bloqueo = budgetItemStructureBlockReason(
          budget.status as BudgetStatus,
        );
        if (bloqueo) throw new ConflictException(bloqueo);
        const [created] = await tx
          .insert(budgetItems)
          .values({
            budgetId,
            code: data.code,
            name: data.name,
            unit: data.unit,
            unitPrice: data.unitPrice.toFixed(4),
            quantity: data.quantity.toFixed(4),
            totalAmount,
            phaseId: data.phaseId ?? null,
            level: data.level,
            parentCode: data.parentCode ?? null,
            sortOrder: data.sortOrder,
          })
          .returning();
        return created;
      });
      return itemToDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, data.code);
    }
  }

  async updateItem(
    itemId: string,
    input: BudgetItemUpdateInput,
  ): Promise<BudgetItemDto> {
    const found = await this.findItem(itemId);
    const data = budgetItemUpdateSchema.parse(input);
    const campos = Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);

    const row = await this.dbs.db.transaction(async (tx) => {
      const budget = await this.lockBudget(tx, found.budgetId);
      const bloqueo = budgetItemEditBlockReason(
        budget.status as BudgetStatus,
        campos,
      );
      if (bloqueo) throw new ConflictException(bloqueo);

      // Se relee la partida ya con el presupuesto bloqueado.
      const [existing] = await tx
        .select()
        .from(budgetItems)
        .where(eq(budgetItems.id, itemId))
        .limit(1);
      if (!existing) throw new NotFoundException('Partida no encontrada');

      const totalAmount = centsToNumeric(
        lineAmountCents(
          data.unitPrice ?? existing.unitPrice,
          data.quantity ?? existing.quantity,
        ),
      );
      const [updated] = await tx
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
          totalAmount,
          updatedAt: new Date(),
        })
        .where(eq(budgetItems.id, itemId))
        .returning();
      return updated;
    });

    return itemToDto(row);
  }

  async removeItem(itemId: string): Promise<void> {
    const found = await this.findItem(itemId);
    await this.dbs.db.transaction(async (tx) => {
      const budget = await this.lockBudget(tx, found.budgetId);
      const bloqueo = budgetItemStructureBlockReason(
        budget.status as BudgetStatus,
      );
      if (bloqueo) throw new ConflictException(bloqueo);
      await tx.delete(budgetItems).where(eq(budgetItems.id, itemId));
    });
  }

  /** Relee el presupuesto con `FOR UPDATE`: las reglas de estado se aplican sobre el estado real. */
  private async lockBudget(tx: DbOrTx, id: string): Promise<Budget> {
    const [row] = await tx
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, id), isNull(budgets.deletedAt)))
      .for('update');
    if (!row) throw new NotFoundException('Presupuesto no encontrado');
    return row;
  }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  private async findProject(projectId: string) {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row;
  }

  async findBudget(id: string): Promise<Budget> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.id, id),
          eq(budgets.companyId, companyId),
          isNull(budgets.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Presupuesto no encontrado');
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(row.projectId)) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    return row;
  }

  private async findItem(id: string): Promise<BudgetItem> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ item: budgetItems, projectId: budgets.projectId })
      .from(budgetItems)
      .innerJoin(budgets, eq(budgetItems.budgetId, budgets.id))
      .where(and(eq(budgetItems.id, id), eq(budgets.companyId, companyId)))
      .limit(1);
    if (!row) throw new NotFoundException('Partida no encontrada');
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(row.projectId)) {
      throw new NotFoundException('Partida no encontrada');
    }
    return row.item;
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
