import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  ParteMaquinaria,
  PartePersonal,
  partesMaquinaria,
  partesPersonal,
  projectPhases,
  projects,
} from '@erp/db';
import {
  ParteMaquinariaCreateInput,
  ParteMaquinariaDto,
  ParteMaquinariaUpdateInput,
  PartePersonalCreateInput,
  PartePersonalDto,
  PartePersonalUpdateInput,
  computeParteMaquinariaCost,
  computePartePersonalCost,
  parteMaquinariaCreateSchema,
  parteMaquinariaUpdateSchema,
  partePersonalCreateSchema,
  partePersonalUpdateSchema,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function personalToDto(
  row: PartePersonal,
  phaseCode: string | null,
): PartePersonalDto {
  return {
    id: row.id,
    projectId: row.projectId,
    phaseId: row.phaseId,
    phaseCode,
    workerName: row.workerName,
    categoryId: row.categoryId,
    workDate: row.workDate,
    ordinaryHours: Number(row.ordinaryHours),
    overtimeHours: Number(row.overtimeHours),
    ordinaryRate: Number(row.ordinaryRate),
    overtimeRate: Number(row.overtimeRate),
    totalCost: Number(row.totalCost),
    notes: row.notes,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function maquinariaToDto(
  row: ParteMaquinaria,
  phaseCode: string | null,
): ParteMaquinariaDto {
  return {
    id: row.id,
    projectId: row.projectId,
    phaseId: row.phaseId,
    phaseCode,
    machineName: row.machineName,
    ownership: row.ownership,
    workDate: row.workDate,
    hoursUsed: Number(row.hoursUsed),
    fuelLiters: row.fuelLiters === null ? null : Number(row.fuelLiters),
    hourlyRate: Number(row.hourlyRate),
    totalCost: Number(row.totalCost),
    notes: row.notes,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PartesListFilter {
  projectId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class PartesDiariosService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────── personal ────────────────────── */

  async listPersonal(filter: PartesListFilter): Promise<PartePersonalDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (filter.projectId && !allowed.includes(filter.projectId)) return [];
    }

    const conditions = [
      eq(partesPersonal.companyId, companyId),
      isNull(partesPersonal.deletedAt),
    ];
    if (filter.projectId)
      conditions.push(eq(partesPersonal.projectId, filter.projectId));
    if (allowed !== null)
      conditions.push(inArray(partesPersonal.projectId, allowed));
    if (filter.from) conditions.push(gte(partesPersonal.workDate, filter.from));
    if (filter.to) conditions.push(lte(partesPersonal.workDate, filter.to));

    const rows = await this.dbs.db
      .select({ parte: partesPersonal, phaseCode: projectPhases.code })
      .from(partesPersonal)
      .leftJoin(projectPhases, eq(partesPersonal.phaseId, projectPhases.id))
      .where(and(...conditions))
      .orderBy(desc(partesPersonal.workDate), asc(partesPersonal.workerName));

    return rows.map((r) => personalToDto(r.parte, r.phaseCode));
  }

  async createPersonal(
    input: PartePersonalCreateInput,
  ): Promise<PartePersonalDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = partePersonalCreateSchema.parse(input);
    await this.findProject(data.projectId);
    const phase = data.phaseId
      ? await this.findPhase(data.phaseId, data.projectId)
      : null;
    const totalCost = computePartePersonalCost(data);

    const [row] = await this.dbs.db
      .insert(partesPersonal)
      .values({
        companyId,
        projectId: data.projectId,
        phaseId: data.phaseId ?? null,
        workerName: data.workerName,
        categoryId: data.categoryId ?? null,
        workDate: data.workDate,
        ordinaryHours: data.ordinaryHours.toFixed(2),
        overtimeHours: data.overtimeHours.toFixed(2),
        ordinaryRate: data.ordinaryRate.toFixed(2),
        overtimeRate: data.overtimeRate.toFixed(2),
        totalCost: totalCost.toFixed(2),
        notes: data.notes ?? null,
      })
      .returning();

    void this.audit.log({
      entityType: 'parte_personal',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return personalToDto(row, phase?.code ?? null);
  }

  async updatePersonal(
    id: string,
    input: PartePersonalUpdateInput,
  ): Promise<PartePersonalDto> {
    const existing = await this.findPersonal(id);
    const data = partePersonalUpdateSchema.parse(input);
    const phaseId =
      data.phaseId !== undefined ? data.phaseId : existing.phaseId;
    if (data.phaseId) await this.findPhase(data.phaseId, existing.projectId);

    const merged = {
      ordinaryHours: data.ordinaryHours ?? Number(existing.ordinaryHours),
      overtimeHours: data.overtimeHours ?? Number(existing.overtimeHours),
      ordinaryRate: data.ordinaryRate ?? Number(existing.ordinaryRate),
      overtimeRate: data.overtimeRate ?? Number(existing.overtimeRate),
    };
    const totalCost = computePartePersonalCost(merged);

    const [row] = await this.dbs.db
      .update(partesPersonal)
      .set({
        ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
        ...(data.workerName !== undefined && { workerName: data.workerName }),
        ...(data.categoryId !== undefined && {
          categoryId: data.categoryId ?? null,
        }),
        ...(data.workDate !== undefined && { workDate: data.workDate }),
        ordinaryHours: merged.ordinaryHours.toFixed(2),
        overtimeHours: merged.overtimeHours.toFixed(2),
        ordinaryRate: merged.ordinaryRate.toFixed(2),
        overtimeRate: merged.overtimeRate.toFixed(2),
        totalCost: totalCost.toFixed(2),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(partesPersonal.id, id))
      .returning();

    const phase = phaseId ? await this.findPhase(phaseId, row.projectId) : null;
    return personalToDto(row, phase?.code ?? null);
  }

  async removePersonal(id: string): Promise<void> {
    await this.findPersonal(id);
    await this.dbs.db
      .update(partesPersonal)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(partesPersonal.id, id));
  }

  async approvePersonal(id: string, userId: string): Promise<PartePersonalDto> {
    const existing = await this.findPersonal(id);
    const [row] = await this.dbs.db
      .update(partesPersonal)
      .set({
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(partesPersonal.id, id))
      .returning();
    const phase = existing.phaseId
      ? await this.findPhase(existing.phaseId, existing.projectId)
      : null;
    return personalToDto(row, phase?.code ?? null);
  }

  /* ────────────────────── maquinaria ────────────────────── */

  async listMaquinaria(
    filter: PartesListFilter,
  ): Promise<ParteMaquinariaDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (filter.projectId && !allowed.includes(filter.projectId)) return [];
    }

    const conditions = [
      eq(partesMaquinaria.companyId, companyId),
      isNull(partesMaquinaria.deletedAt),
    ];
    if (filter.projectId)
      conditions.push(eq(partesMaquinaria.projectId, filter.projectId));
    if (allowed !== null)
      conditions.push(inArray(partesMaquinaria.projectId, allowed));
    if (filter.from)
      conditions.push(gte(partesMaquinaria.workDate, filter.from));
    if (filter.to) conditions.push(lte(partesMaquinaria.workDate, filter.to));

    const rows = await this.dbs.db
      .select({ parte: partesMaquinaria, phaseCode: projectPhases.code })
      .from(partesMaquinaria)
      .leftJoin(projectPhases, eq(partesMaquinaria.phaseId, projectPhases.id))
      .where(and(...conditions))
      .orderBy(
        desc(partesMaquinaria.workDate),
        asc(partesMaquinaria.machineName),
      );

    return rows.map((r) => maquinariaToDto(r.parte, r.phaseCode));
  }

  async createMaquinaria(
    input: ParteMaquinariaCreateInput,
  ): Promise<ParteMaquinariaDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = parteMaquinariaCreateSchema.parse(input);
    await this.findProject(data.projectId);
    const phase = data.phaseId
      ? await this.findPhase(data.phaseId, data.projectId)
      : null;
    const totalCost = computeParteMaquinariaCost(data);

    const [row] = await this.dbs.db
      .insert(partesMaquinaria)
      .values({
        companyId,
        projectId: data.projectId,
        phaseId: data.phaseId ?? null,
        machineName: data.machineName,
        ownership: data.ownership,
        workDate: data.workDate,
        hoursUsed: data.hoursUsed.toFixed(2),
        fuelLiters: data.fuelLiters?.toFixed(2) ?? null,
        hourlyRate: data.hourlyRate.toFixed(2),
        totalCost: totalCost.toFixed(2),
        notes: data.notes ?? null,
      })
      .returning();

    void this.audit.log({
      entityType: 'parte_maquinaria',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return maquinariaToDto(row, phase?.code ?? null);
  }

  async updateMaquinaria(
    id: string,
    input: ParteMaquinariaUpdateInput,
  ): Promise<ParteMaquinariaDto> {
    const existing = await this.findMaquinaria(id);
    const data = parteMaquinariaUpdateSchema.parse(input);
    const phaseId =
      data.phaseId !== undefined ? data.phaseId : existing.phaseId;
    if (data.phaseId) await this.findPhase(data.phaseId, existing.projectId);

    const merged = {
      hoursUsed: data.hoursUsed ?? Number(existing.hoursUsed),
      hourlyRate: data.hourlyRate ?? Number(existing.hourlyRate),
    };
    const totalCost = computeParteMaquinariaCost(merged);

    const [row] = await this.dbs.db
      .update(partesMaquinaria)
      .set({
        ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
        ...(data.machineName !== undefined && {
          machineName: data.machineName,
        }),
        ...(data.ownership !== undefined && { ownership: data.ownership }),
        ...(data.workDate !== undefined && { workDate: data.workDate }),
        hoursUsed: merged.hoursUsed.toFixed(2),
        ...(data.fuelLiters !== undefined && {
          fuelLiters: data.fuelLiters?.toFixed(2) ?? null,
        }),
        hourlyRate: merged.hourlyRate.toFixed(2),
        totalCost: totalCost.toFixed(2),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(partesMaquinaria.id, id))
      .returning();

    const phase = phaseId ? await this.findPhase(phaseId, row.projectId) : null;
    return maquinariaToDto(row, phase?.code ?? null);
  }

  async removeMaquinaria(id: string): Promise<void> {
    await this.findMaquinaria(id);
    await this.dbs.db
      .update(partesMaquinaria)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(partesMaquinaria.id, id));
  }

  async approveMaquinaria(
    id: string,
    userId: string,
  ): Promise<ParteMaquinariaDto> {
    const existing = await this.findMaquinaria(id);
    const [row] = await this.dbs.db
      .update(partesMaquinaria)
      .set({
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(partesMaquinaria.id, id))
      .returning();
    const phase = existing.phaseId
      ? await this.findPhase(existing.phaseId, existing.projectId)
      : null;
    return maquinariaToDto(row, phase?.code ?? null);
  }

  /* ────────────────────── privados ────────────────────── */

  private async findPersonal(id: string): Promise<PartePersonal> {
    const allowed = await this.dbs.getObrasAccesibles();
    const [row] = await this.dbs.db
      .select()
      .from(partesPersonal)
      .where(and(eq(partesPersonal.id, id), isNull(partesPersonal.deletedAt)))
      .limit(1);
    if (!row || (allowed !== null && !allowed.includes(row.projectId))) {
      throw new NotFoundException('Parte de personal no encontrado');
    }
    return row;
  }

  private async findMaquinaria(id: string): Promise<ParteMaquinaria> {
    const allowed = await this.dbs.getObrasAccesibles();
    const [row] = await this.dbs.db
      .select()
      .from(partesMaquinaria)
      .where(
        and(eq(partesMaquinaria.id, id), isNull(partesMaquinaria.deletedAt)),
      )
      .limit(1);
    if (!row || (allowed !== null && !allowed.includes(row.projectId))) {
      throw new NotFoundException('Parte de maquinaria no encontrado');
    }
    return row;
  }

  private async findPhase(phaseId: string, projectId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(projectPhases)
      .where(
        and(
          eq(projectPhases.id, phaseId),
          eq(projectPhases.projectId, projectId),
          isNull(projectPhases.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Partida no encontrada en esta obra');
    return row;
  }

  private async findProject(projectId: string) {
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row;
  }
}
