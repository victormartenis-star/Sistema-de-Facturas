import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  Project,
  Stoppage,
  StoppageCost,
  projects,
  stoppageCosts,
  stoppages,
} from '@erp/db';
import {
  StoppageAttribution,
  StoppageCause,
  StoppageCostConcept,
  StoppageCostLine,
  StoppageCreateInput,
  StoppageDto,
  StoppageReportDto,
  StoppageUpdateInput,
  daysToOpen,
  isExternalCause,
  round2,
  stoppageCreateSchema,
  stoppageDays,
  stoppageReportWarnings,
  stoppageStatus,
  stoppageUpdateSchema,
  stoppageWarnings,
  todayIso,
  valueStoppage,
} from '@erp/shared';
import { DbService } from '../db/db.service';

/** Número de expediente: código de obra + correlativo propio de esa obra. */
function buildStoppageNumber(projectCode: string, seq: number): string {
  return `${projectCode}-CESE-${String(seq).padStart(4, '0')}`;
}

@Injectable()
export class StoppagesService {
  constructor(private readonly dbs: DbService) {}

  async list(projectId?: string): Promise<StoppageDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters = [
      eq(stoppages.companyId, companyId),
      isNull(stoppages.deletedAt),
    ];
    if (projectId) filters.push(eq(stoppages.projectId, projectId));

    const rows = await this.dbs.db
      .select({
        stoppage: stoppages,
        projectCode: projects.code,
        projectName: projects.name,
      })
      .from(stoppages)
      .innerJoin(projects, eq(stoppages.projectId, projects.id))
      .where(and(...filters))
      .orderBy(asc(projects.code), desc(stoppages.startDate));

    const costs = await this.costsOf(rows.map((r) => r.stoppage.id));
    const today = todayIso();
    return rows.map((r) =>
      toDto(
        r.stoppage,
        r.projectCode,
        r.projectName,
        costs.get(r.stoppage.id) ?? [],
        today,
      ),
    );
  }

  async get(id: string): Promise<StoppageDto> {
    const [row] = await this.dbs.db
      .select({
        stoppage: stoppages,
        projectCode: projects.code,
        projectName: projects.name,
      })
      .from(stoppages)
      .innerJoin(projects, eq(stoppages.projectId, projects.id))
      .where(and(eq(stoppages.id, id), isNull(stoppages.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Expediente no encontrado');

    const costs = await this.costsOf([id]);
    return toDto(
      row.stoppage,
      row.projectCode,
      row.projectName,
      costs.get(id) ?? [],
      todayIso(),
    );
  }

  /**
   * Alta del expediente.
   *
   * `openedAt` cae por defecto en el día de la parada, no en hoy: es lo que
   * manda el manual, y si alguien lo abre más tarde tiene que decirlo
   * expresamente en lugar de que el sistema se lo disimule.
   */
  async create(input: StoppageCreateInput): Promise<StoppageDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = stoppageCreateSchema.parse(input);
    const project = await this.findProject(data.projectId);

    const id = await this.dbs.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ seq: stoppages.seq })
        .from(stoppages)
        .where(
          and(
            eq(stoppages.projectId, data.projectId),
            isNull(stoppages.deletedAt),
          ),
        )
        .orderBy(desc(stoppages.seq))
        .limit(1);
      const seq = (last?.seq ?? 0) + 1;

      const [row] = await tx
        .insert(stoppages)
        .values({
          companyId,
          projectId: data.projectId,
          seq,
          stoppageNumber: buildStoppageNumber(project.code, seq),
          startDate: data.startDate,
          endDate: data.endDate ?? null,
          cause: data.cause as StoppageCause,
          attribution: data.attribution as StoppageAttribution,
          description: data.description,
          openedAt: data.openedAt ?? data.startDate,
          openedBy: data.openedBy ?? null,
          notifiedAt: data.notifiedAt ?? null,
          notifiedTo: data.notifiedTo ?? null,
          claimedAmount: data.claimedAmount?.toFixed(2) ?? null,
          claimedAt: data.claimedAt ?? null,
          notes: data.notes ?? null,
        })
        .returning();

      if (data.costs.length > 0) {
        await tx.insert(stoppageCosts).values(
          data.costs.map((c) => ({
            stoppageId: row.id,
            concept: c.concept as StoppageCostConcept,
            description: c.description ?? null,
            dailyAmount: c.dailyAmount.toFixed(2),
          })),
        );
      }
      return row.id;
    });
    return this.get(id);
  }

  async update(id: string, input: StoppageUpdateInput): Promise<StoppageDto> {
    await this.find(id);
    const data = stoppageUpdateSchema.parse(input);

    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(stoppages)
        .set({
          ...(data.startDate !== undefined && { startDate: data.startDate }),
          ...(data.endDate !== undefined && {
            endDate: data.endDate ?? null,
          }),
          ...(data.cause !== undefined && {
            cause: data.cause as StoppageCause,
          }),
          ...(data.attribution !== undefined && {
            attribution: data.attribution as StoppageAttribution,
          }),
          ...(data.description !== undefined && {
            description: data.description,
          }),
          // La fecha de apertura no se puede vaciar: la columna es obligatoria
          // y borrarla sería tapar el retraso en abrir el expediente.
          ...(data.openedAt != null && { openedAt: data.openedAt }),
          ...(data.openedBy !== undefined && {
            openedBy: data.openedBy ?? null,
          }),
          ...(data.notifiedAt !== undefined && {
            notifiedAt: data.notifiedAt ?? null,
          }),
          ...(data.notifiedTo !== undefined && {
            notifiedTo: data.notifiedTo ?? null,
          }),
          ...(data.claimedAmount !== undefined && {
            claimedAmount: data.claimedAmount?.toFixed(2) ?? null,
          }),
          ...(data.claimedAt !== undefined && {
            claimedAt: data.claimedAt ?? null,
          }),
          ...(data.notes !== undefined && { notes: data.notes ?? null }),
          updatedAt: new Date(),
        })
        .where(eq(stoppages.id, id));

      // La valoración se reemplaza entera: es una lista corta y así no quedan
      // conceptos huérfanos de una versión anterior del expediente.
      if (data.costs !== undefined) {
        await tx.delete(stoppageCosts).where(eq(stoppageCosts.stoppageId, id));
        if (data.costs.length > 0) {
          await tx.insert(stoppageCosts).values(
            data.costs.map((c) => ({
              stoppageId: id,
              concept: c.concept as StoppageCostConcept,
              description: c.description ?? null,
              dailyAmount: Number(c.dailyAmount).toFixed(2),
            })),
          );
        }
      }
    });
    return this.get(id);
  }

  /** Reanudación: la fecha en que la obra volvió a moverse. */
  async resume(id: string, endDate: string): Promise<StoppageDto> {
    return this.update(id, { endDate });
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.dbs.db
      .update(stoppages)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(stoppages.id, id));
  }

  /** Todas las paradas de una obra, como van a la ficha mensual. */
  async report(projectId: string): Promise<StoppageReportDto> {
    const project = await this.findProject(projectId);
    const rows = await this.list(projectId);

    const suma = (pick: (r: StoppageDto) => number) =>
      round2(rows.reduce((s, r) => s + pick(r), 0));

    return {
      projectId,
      projectCode: project.code,
      projectName: project.name,
      stoppages: rows,
      totalDays: rows.reduce((s, r) => s + r.valuation.days, 0),
      totalAccrued: suma((r) => r.valuation.accruedTotal),
      claimableAccrued: round2(
        rows
          .filter((r) => r.externalCause)
          .reduce((s, r) => s + r.valuation.accruedTotal, 0),
      ),
      totalClaimed: suma((r) => r.claimedAmount ?? 0),
      openCount: rows.filter((r) => r.status === 'abierta').length,
      warnings: stoppageReportWarnings(rows),
    };
  }

  /* ────────────────────────── privados ────────────────────────── */

  private async costsOf(ids: string[]): Promise<Map<string, StoppageCost[]>> {
    const map = new Map<string, StoppageCost[]>();
    if (ids.length === 0) return map;
    const rows = await this.dbs.db
      .select()
      .from(stoppageCosts)
      .where(inArray(stoppageCosts.stoppageId, ids));
    for (const r of rows) {
      map.set(r.stoppageId, [...(map.get(r.stoppageId) ?? []), r]);
    }
    return map;
  }

  private async find(id: string): Promise<Stoppage> {
    const [row] = await this.dbs.db
      .select()
      .from(stoppages)
      .where(and(eq(stoppages.id, id), isNull(stoppages.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Expediente no encontrado');
    return row;
  }

  private async findProject(projectId: string): Promise<Project> {
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row;
  }
}

function toDto(
  row: Stoppage,
  projectCode: string,
  projectName: string,
  costs: StoppageCost[],
  today: string,
): StoppageDto {
  const lines: StoppageCostLine[] = costs.map((c) => ({
    concept: c.concept as StoppageCostConcept,
    description: c.description,
    dailyAmount: Number(c.dailyAmount),
  }));

  const days = stoppageDays(row.startDate, row.endDate, today);
  const valuation = valueStoppage(lines, days);
  const attribution = row.attribution as StoppageAttribution;
  const claimedAmount =
    row.claimedAmount === null ? null : Number(row.claimedAmount);

  return {
    id: row.id,
    projectId: row.projectId,
    projectCode,
    projectName,
    seq: row.seq,
    stoppageNumber: row.stoppageNumber,
    startDate: row.startDate,
    endDate: row.endDate,
    cause: row.cause as StoppageCause,
    attribution,
    externalCause: isExternalCause(attribution),
    description: row.description,
    openedAt: row.openedAt,
    openedBy: row.openedBy,
    daysToOpen: daysToOpen(row.startDate, row.openedAt),
    notifiedAt: row.notifiedAt,
    notifiedTo: row.notifiedTo,
    claimedAmount,
    claimedAt: row.claimedAt,
    status: stoppageStatus(row.endDate),
    valuation,
    warnings: stoppageWarnings({
      startDate: row.startDate,
      endDate: row.endDate,
      openedAt: row.openedAt,
      attribution,
      notifiedAt: row.notifiedAt,
      claimedAmount,
      valuation,
    }),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
