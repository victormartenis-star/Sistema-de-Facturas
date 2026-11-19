import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, or, SQL } from 'drizzle-orm';
import { Project, projects } from '@erp/db';
import {
  ProjectCreateInput,
  ProjectDto,
  projectCreateSchema,
  ProjectStatus,
  ProjectUpdateInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import {
  condicionVersion,
  falloActualizacion,
  incrementarVersion,
  verificarVersion,
} from '../common/version';
import { DbService } from '../db/db.service';

/** 404 de obra con su código de dominio (existe, es de otra empresa o está borrada). */
function obraNoEncontrada(): NotFoundException {
  return new NotFoundException({
    code: 'PROJECT_NOT_FOUND',
    message: 'Obra no encontrada',
  });
}

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
    version: row.version,
  };
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(search?: string, status?: ProjectStatus): Promise<ProjectDto[]> {
    const companyId = this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters: SQL[] = [
      eq(projects.companyId, companyId),
      isNull(projects.deletedAt),
    ];
    if (allowed !== null) {
      // rol obra: solo las obras asignadas explícitamente
      if (allowed.length === 0) return [];
      filters.push(inArray(projects.id, allowed));
    }
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
    const companyId = await this.dbs.getCompanyId();
    const data = projectCreateSchema.parse(input);
    try {
      const row = await this.dbs.db.transaction(async (tx) => {
        const [creada] = await tx
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
        await this.audit.registrar(tx, {
          entityType: 'project',
          entityId: creada.id,
          action: 'create',
          newData: creada,
        });
        return creada;
      });
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, data.code);
    }
  }

  async update(
    id: string,
    input: ProjectUpdateInput,
    versionEsperada?: number,
  ): Promise<ProjectDto> {
    await this.find(id);
    const companyId = await this.dbs.getCompanyId();
    try {
      const row = await this.dbs.db.transaction(async (tx) => {
        // Se bloquea la fila y se valida la versión antes de escribir: dos
        // ediciones concurrentes no se pisan en silencio (control optimista).
        const [actual] = await tx
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.id, id),
              eq(projects.companyId, companyId),
              isNull(projects.deletedAt),
            ),
          )
          .for('update')
          .limit(1);
        if (!actual) throw obraNoEncontrada();
        verificarVersion(actual.version, versionEsperada);
        const [actualizada] = await tx
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
            version: incrementarVersion(projects),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projects.id, id),
              condicionVersion(projects, versionEsperada),
            ),
          )
          .returning();
        if (!actualizada) {
          return falloActualizacion(
            tx,
            projects,
            id,
            versionEsperada,
            () => obraNoEncontrada(),
            'Obra no encontrada',
          );
        }
        await this.audit.registrar(tx, {
          entityType: 'project',
          entityId: id,
          action: 'update',
          newData: actualizada,
        });
        return actualizada;
      });
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateCode(err, input.code ?? '');
    }
  }

  /** Borrado lógico (deleted_at), como marca 02-base-de-datos.md. Versionado. */
  async remove(id: string, versionEsperada?: number): Promise<void> {
    await this.find(id);
    const companyId = await this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            eq(projects.companyId, companyId),
            isNull(projects.deletedAt),
          ),
        )
        .for('update')
        .limit(1);
      if (!actual) throw obraNoEncontrada();
      verificarVersion(actual.version, versionEsperada);
      const [borrada] = await tx
        .update(projects)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: incrementarVersion(projects),
        })
        .where(
          and(eq(projects.id, id), condicionVersion(projects, versionEsperada)),
        )
        .returning();
      if (!borrada) {
        await falloActualizacion(
          tx,
          projects,
          id,
          versionEsperada,
          () => obraNoEncontrada(),
          'Obra no encontrada',
        );
      }
      await this.audit.registrar(tx, {
        entityType: 'project',
        entityId: id,
        action: 'delete',
        oldData: actual,
      });
    });
  }

  private async find(id: string): Promise<Project> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters: SQL[] = [
      eq(projects.id, id),
      eq(projects.companyId, companyId),
      isNull(projects.deletedAt),
    ];
    if (allowed !== null) {
      if (!allowed.includes(id))
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Obra no encontrada',
        });
    }
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(...filters))
      .limit(1);
    if (!row) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    }
    return row;
  }

  private rethrowDuplicateCode(err: unknown, code: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException({
        code: 'PROJECT_CODE_DUPLICATED',
        message: `Ya existe una obra con el código "${code}"`,
      });
    }
    throw err;
  }
}
