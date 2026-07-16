import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, SQL } from 'drizzle-orm';
import { Project, projects } from '@erp/db';
import {
  ProjectCreateInput,
  ProjectDto,
  projectCreateSchema,
  ProjectStatus,
  ProjectUpdateInput,
} from '@erp/shared';
import { DbService } from '../db/db.service';

function toDto(row: Project): ProjectDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as ProjectStatus,
    startDate: row.startDate,
    expectedEnd: row.expectedEnd,
    contractAmount:
      row.contractAmount === null ? null : Number(row.contractAmount),
    retentionPct: Number(row.retentionPct),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProjectsService {
  constructor(private readonly dbs: DbService) {}

  async list(search?: string, status?: ProjectStatus): Promise<ProjectDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(projects.companyId, companyId),
      isNull(projects.deletedAt),
    ];
    if (status) {
      filters.push(eq(projects.status, status));
    }
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      filters.push(
        or(ilike(projects.name, term), ilike(projects.code, term)) as SQL,
      );
    }
    const rows = await this.dbs.db
      .select()
      .from(projects)
      .where(and(...filters))
      .orderBy(desc(projects.createdAt));
    return rows.map(toDto);
  }

  async get(id: string): Promise<ProjectDto> {
    const row = await this.find(id);
    return toDto(row);
  }

  async create(input: ProjectCreateInput): Promise<ProjectDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = projectCreateSchema.parse(input);
    try {
      const [row] = await this.dbs.db
        .insert(projects)
        .values({
          companyId,
          code: data.code,
          name: data.name,
          status: data.status,
          startDate: data.startDate ?? null,
          expectedEnd: data.expectedEnd ?? null,
          contractAmount: data.contractAmount?.toFixed(2) ?? null,
          retentionPct: data.retentionPct.toFixed(2),
          notes: data.notes ?? null,
        })
        .returning();
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, data.code);
    }
  }

  async update(id: string, input: ProjectUpdateInput): Promise<ProjectDto> {
    await this.find(id);
    try {
      const [row] = await this.dbs.db
        .update(projects)
        .set({
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.startDate !== undefined && {
            startDate: input.startDate ?? null,
          }),
          ...(input.expectedEnd !== undefined && {
            expectedEnd: input.expectedEnd ?? null,
          }),
          ...(input.contractAmount !== undefined && {
            contractAmount: input.contractAmount?.toFixed(2) ?? null,
          }),
          ...(input.retentionPct !== undefined && {
            retentionPct: input.retentionPct.toFixed(2),
          }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning();
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, input.code ?? '');
    }
  }

  /** Borrado lógico (deleted_at), como marca 02-base-de-datos.md. */
  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.dbs.db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, id));
  }

  private async find(id: string): Promise<Project> {
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Obra no encontrada');
    }
    return row;
  }

  private rethrowDuplicateCode(err: unknown, code: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException(`Ya existe una obra con el código "${code}"`);
    }
    throw err;
  }
}
