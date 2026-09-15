import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  Fichaje,
  PrlChecklist,
  fichajes,
  prlChecklists,
  projects,
} from '@erp/db';
import {
  FichajeCreateInput,
  FichajeDto,
  PrlChecklistCreateInput,
  PrlChecklistDto,
  PrlChecklistItem,
  fichajeCreateSchema,
  prlChecklistCreateSchema,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function fichajeToDto(row: Fichaje, projectCode: string): FichajeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode,
    workerName: row.workerName,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    latitude: row.latitude ? Number(row.latitude) : null,
    longitude: row.longitude ? Number(row.longitude) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function checklistToDto(
  row: PrlChecklist,
  projectCode: string,
): PrlChecklistDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode,
    workerName: row.workerName,
    checkDate: row.checkDate,
    items: row.items as PrlChecklistItem[],
    allChecked: row.allChecked,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class OfflineFieldService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────── fichajes ────────────────────── */

  async listFichajes(projectId?: string): Promise<FichajeDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (projectId && !allowed.includes(projectId)) return [];
    }

    const conditions = [eq(fichajes.companyId, companyId)];
    if (projectId) conditions.push(eq(fichajes.projectId, projectId));

    const rows = await this.dbs.db
      .select({ fichaje: fichajes, projectCode: projects.code })
      .from(fichajes)
      .innerJoin(projects, eq(fichajes.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(asc(fichajes.occurredAt));
    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.fichaje.projectId));
    return visible.map((r) => fichajeToDto(r.fichaje, r.projectCode));
  }

  /**
   * Crea un fichaje — idempotente por `clientId`: si ya existe uno con ese
   * `clientId` para la empresa (un reintento de sincronización offline que
   * en realidad ya había llegado), devuelve el existente sin duplicar.
   */
  async createFichaje(input: FichajeCreateInput): Promise<FichajeDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = fichajeCreateSchema.parse(input);
    await this.assertProjectAccessible(data.projectId);
    const project = await this.projectCode(data.projectId);

    if (data.clientId) {
      const existing = await this.findFichajeByClientId(
        data.clientId,
        companyId,
      );
      if (existing) return fichajeToDto(existing, project);
    }

    const [row] = await this.dbs.db
      .insert(fichajes)
      .values({
        companyId,
        projectId: data.projectId,
        workerName: data.workerName,
        type: data.type,
        occurredAt: new Date(data.occurredAt),
        latitude: data.latitude != null ? data.latitude.toFixed(7) : null,
        longitude: data.longitude != null ? data.longitude.toFixed(7) : null,
        clientId: data.clientId ?? null,
      })
      .returning();
    void this.audit.log({
      entityType: 'fichaje',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return fichajeToDto(row, project);
  }

  /* ────────────────────── checklist PRL ────────────────────── */

  async listChecklists(projectId?: string): Promise<PrlChecklistDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (projectId && !allowed.includes(projectId)) return [];
    }

    const conditions = [eq(prlChecklists.companyId, companyId)];
    if (projectId) conditions.push(eq(prlChecklists.projectId, projectId));

    const rows = await this.dbs.db
      .select({ checklist: prlChecklists, projectCode: projects.code })
      .from(prlChecklists)
      .innerJoin(projects, eq(prlChecklists.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(asc(prlChecklists.checkDate));
    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.checklist.projectId));
    return visible.map((r) => checklistToDto(r.checklist, r.projectCode));
  }

  async createChecklist(
    input: PrlChecklistCreateInput,
  ): Promise<PrlChecklistDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = prlChecklistCreateSchema.parse(input);
    await this.assertProjectAccessible(data.projectId);
    const project = await this.projectCode(data.projectId);

    if (data.clientId) {
      const existing = await this.findChecklistByClientId(
        data.clientId,
        companyId,
      );
      if (existing) return checklistToDto(existing, project);
    }

    const allChecked = data.items.every((i) => i.checked);
    const [row] = await this.dbs.db
      .insert(prlChecklists)
      .values({
        companyId,
        projectId: data.projectId,
        workerName: data.workerName,
        checkDate: data.checkDate,
        items: data.items,
        allChecked,
        notes: data.notes ?? null,
        clientId: data.clientId ?? null,
      })
      .returning();
    void this.audit.log({
      entityType: 'prl_checklist',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return checklistToDto(row, project);
  }

  /* ────────────────────── privados ────────────────────── */

  private async findFichajeByClientId(
    clientId: string,
    companyId: string,
  ): Promise<Fichaje | undefined> {
    const [row] = await this.dbs.db
      .select()
      .from(fichajes)
      .where(
        and(eq(fichajes.companyId, companyId), eq(fichajes.clientId, clientId)),
      )
      .limit(1);
    return row;
  }

  private async findChecklistByClientId(
    clientId: string,
    companyId: string,
  ): Promise<PrlChecklist | undefined> {
    const [row] = await this.dbs.db
      .select()
      .from(prlChecklists)
      .where(
        and(
          eq(prlChecklists.companyId, companyId),
          eq(prlChecklists.clientId, clientId),
        ),
      )
      .limit(1);
    return row;
  }

  private async projectCode(projectId: string): Promise<string> {
    const [row] = await this.dbs.db
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row.code;
  }

  private async assertProjectAccessible(projectId: string): Promise<void> {
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
  }
}
