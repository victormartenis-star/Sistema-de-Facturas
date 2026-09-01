import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, or, SQL } from 'drizzle-orm';
import { Project, contacts, projects, users } from '@erp/db';
import {
  ProjectCreateInput,
  ProjectDto,
  projectCreateSchema,
  ProjectStatus,
  ProjectUpdateInput,
  ProjectStaffInput,
  USER_ROLE_LABELS,
  UserRole,
  projectStaffSchema,
  round2,
} from '@erp/shared';
import { DbService } from '../db/db.service';

/**
 * `withEconomics` en false vacía los importes de contrato y coste objetivo.
 *
 * Se hace en el servidor y no ocultando la cifra en la pantalla: quien no
 * tiene `economico.ver` no debe recibir el dato, no basta con no pintárselo.
 */
function toDto(
  row: Project,
  withEconomics = true,
  clientName: string | null = null,
): ProjectDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as ProjectStatus,
    startDate: row.startDate,
    expectedEnd: row.expectedEnd,
    groupManagerId: row.groupManagerId,
    siteManagerId: row.siteManagerId,
    foremanId: row.foremanId,
    clientId: row.clientId,
    clientName,
    address: row.address,
    pemAmount:
      !withEconomics || row.pemAmount === null ? null : Number(row.pemAmount),
    ggBiAmount: ggBi(row, withEconomics).amount,
    ggBiPct: ggBi(row, withEconomics).pct,
    contractAmount:
      !withEconomics || row.contractAmount === null
        ? null
        : Number(row.contractAmount),
    targetCost:
      !withEconomics || row.targetCost === null ? null : Number(row.targetCost),
    retentionPct: Number(row.retentionPct),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Gastos generales y beneficio industrial: la diferencia entre lo que se
 * factura (contrata) y el coste material presupuestado (PEM). Es el margen
 * teórico de partida, antes de que la obra empiece a gastar.
 */
function ggBi(
  row: Project,
  withEconomics: boolean,
): { amount: number | null; pct: number | null } {
  if (!withEconomics || row.contractAmount === null || row.pemAmount === null) {
    return { amount: null, pct: null };
  }
  const pem = Number(row.pemAmount);
  const contrata = Number(row.contractAmount);
  return {
    amount: round2(contrata - pem),
    pct: pem > 0 ? round2(((contrata - pem) / pem) * 100) : null,
  };
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProjectsService {
  constructor(private readonly dbs: DbService) {}

  /**
   * `visibleProjectIds` limita el listado a las obras asignadas. Llega vacío
   * en los roles transversales —Compras, Administración, Estudios y
   * Dirección—, que trabajan con todas las obras a la vez.
   */
  /**
   * Asignación de responsables (hito E1: "nombre y apellidos por escrito
   * antes del inicio"). Además de dejarlo escrito, es lo que decide qué obras
   * ve cada persona, así que se comprueba que el rol encaja con el puesto.
   */
  async setStaff(id: string, input: ProjectStaffInput): Promise<ProjectDto> {
    await this.find(id);
    const data = projectStaffSchema.parse(input);

    await this.assertRole(data.groupManagerId, 'jefe_grupo');
    await this.assertRole(data.siteManagerId, 'jefe_obra');
    await this.assertRole(data.foremanId, 'encargado');

    await this.dbs.db
      .update(projects)
      .set({
        ...(data.groupManagerId !== undefined && {
          groupManagerId: data.groupManagerId ?? null,
        }),
        ...(data.siteManagerId !== undefined && {
          siteManagerId: data.siteManagerId ?? null,
        }),
        ...(data.foremanId !== undefined && {
          foremanId: data.foremanId ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));
    return toDto(await this.find(id));
  }

  /** El puesto en la obra tiene que corresponderse con el rol del usuario. */
  private async assertRole(
    userId: string | null | undefined,
    expected: UserRole,
  ): Promise<void> {
    if (!userId) return;
    const [user] = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.role !== expected) {
      throw new ConflictException(
        `${user.fullName} es ${USER_ROLE_LABELS[user.role as UserRole]}: no puede asignarse como ${USER_ROLE_LABELS[expected]}`,
      );
    }
  }

  async list(
    search?: string,
    status?: ProjectStatus,
    visibleProjectIds?: string[],
    withEconomics = true,
  ): Promise<ProjectDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(projects.companyId, companyId),
      isNull(projects.deletedAt),
    ];
    if (visibleProjectIds) {
      // Sin obras asignadas no se ve ninguna, en lugar de verlas todas: el
      // filtro vacío es el fallo más caro de este tipo de restricción.
      if (visibleProjectIds.length === 0) return [];
      filters.push(inArray(projects.id, visibleProjectIds));
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
      .select({ project: projects, clientName: contacts.legalName })
      .from(projects)
      .leftJoin(contacts, eq(projects.clientId, contacts.id))
      .where(and(...filters))
      .orderBy(desc(projects.createdAt));
    return rows.map((r) => toDto(r.project, withEconomics, r.clientName));
  }

  async get(id: string, withEconomics = true): Promise<ProjectDto> {
    const row = await this.find(id);
    return toDto(row, withEconomics, await this.clientNameOf(row.clientId));
  }

  private async clientNameOf(clientId: string | null): Promise<string | null> {
    if (!clientId) return null;
    const [row] = await this.dbs.db
      .select({ legalName: contacts.legalName })
      .from(contacts)
      .where(eq(contacts.id, clientId))
      .limit(1);
    return row?.legalName ?? null;
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
          clientId: data.clientId ?? null,
          address: data.address ?? null,
          pemAmount: data.pemAmount?.toFixed(2) ?? null,
          contractAmount: data.contractAmount?.toFixed(2) ?? null,
          targetCost: data.targetCost?.toFixed(2) ?? null,
          retentionPct: data.retentionPct.toFixed(2),
          notes: data.notes ?? null,
        })
        .returning();
      return this.get(row.id);
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
          ...(input.clientId !== undefined && {
            clientId: input.clientId ?? null,
          }),
          ...(input.address !== undefined && {
            address: input.address ?? null,
          }),
          ...(input.pemAmount !== undefined && {
            pemAmount: input.pemAmount?.toFixed(2) ?? null,
          }),
          ...(input.contractAmount !== undefined && {
            contractAmount: input.contractAmount?.toFixed(2) ?? null,
          }),
          ...(input.targetCost !== undefined && {
            targetCost: input.targetCost?.toFixed(2) ?? null,
          }),
          ...(input.retentionPct !== undefined && {
            retentionPct: input.retentionPct.toFixed(2),
          }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning();
      return this.get(row.id);
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
