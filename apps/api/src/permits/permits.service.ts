import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Permit, Project, permits, projects } from '@erp/db';
import {
  BLOCKING_PERMIT_KINDS,
  PERMIT_COUNTERPARTIES,
  PERMIT_KIND_LABELS,
  PermitBoardDto,
  PermitCreateInput,
  PermitDto,
  PermitKind,
  PermitLight,
  PermitUpdateInput,
  assessPermit,
  permitCreateSchema,
  permitUpdateSchema,
  round2,
  todayIso,
} from '@erp/shared';
import { DbService } from '../db/db.service';

@Injectable()
export class PermitsService {
  constructor(private readonly dbs: DbService) {}

  async list(projectId?: string): Promise<PermitDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters = [
      eq(permits.companyId, companyId),
      isNull(permits.deletedAt),
    ];
    if (projectId) filters.push(eq(permits.projectId, projectId));

    const rows = await this.dbs.db
      .select({
        permit: permits,
        projectCode: projects.code,
        projectEnd: projects.expectedEnd,
      })
      .from(permits)
      .innerJoin(projects, eq(permits.projectId, projects.id))
      .where(and(...filters))
      .orderBy(asc(projects.code), asc(permits.kind));

    const today = todayIso();
    return rows.map((r) => toDto(r, today));
  }

  async create(input: PermitCreateInput): Promise<PermitDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = permitCreateSchema.parse(input);
    await this.findProject(data.projectId);

    const [row] = await this.dbs.db
      .insert(permits)
      .values({
        companyId,
        projectId: data.projectId,
        kind: data.kind as PermitKind,
        // Si no se indica interlocutor se pone el habitual del trámite: es
        // dato que se teclearía siempre igual.
        counterparty:
          data.counterparty ?? PERMIT_COUNTERPARTIES[data.kind as PermitKind],
        reference: data.reference ?? null,
        requestedAt: data.requestedAt ?? null,
        committedAt: data.committedAt ?? null,
        grantedAt: data.grantedAt ?? null,
        neededBy: data.neededBy ?? null,
        cost: data.cost?.toFixed(2) ?? null,
        notApplicable: data.notApplicable,
        notes: data.notes ?? null,
      })
      .returning();
    return this.get(row.id);
  }

  async update(id: string, input: PermitUpdateInput): Promise<PermitDto> {
    await this.find(id);
    const data = permitUpdateSchema.parse(input);

    await this.dbs.db
      .update(permits)
      .set({
        ...(data.kind !== undefined && { kind: data.kind as PermitKind }),
        ...(data.counterparty !== undefined && {
          counterparty: data.counterparty ?? null,
        }),
        ...(data.reference !== undefined && {
          reference: data.reference ?? null,
        }),
        ...(data.requestedAt !== undefined && {
          requestedAt: data.requestedAt ?? null,
        }),
        ...(data.committedAt !== undefined && {
          committedAt: data.committedAt ?? null,
        }),
        ...(data.grantedAt !== undefined && {
          grantedAt: data.grantedAt ?? null,
        }),
        ...(data.neededBy !== undefined && { neededBy: data.neededBy ?? null }),
        ...(data.cost !== undefined && { cost: data.cost?.toFixed(2) ?? null }),
        ...(data.notApplicable !== undefined && {
          notApplicable: data.notApplicable,
        }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(permits.id, id));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.dbs.db
      .update(permits)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(permits.id, id));
  }

  /**
   * Semáforo de una obra, tal y como se lleva a la ficha mensual: para cada
   * suministro, fecha de solicitud, fecha comprometida y días de retraso.
   */
  async board(projectId: string): Promise<PermitBoardDto> {
    const project = await this.findProject(projectId);
    const list = await this.list(projectId);

    const counts: Record<PermitLight, number> = {
      verde: 0,
      ambar: 0,
      rojo: 0,
    };
    for (const p of list) counts[p.light]++;

    const blockingPending = list
      .filter((p) => p.blocking && p.status !== 'concedido' && !p.notApplicable)
      .map((p) => PERMIT_KIND_LABELS[p.kind]);

    const warnings: string[] = [];
    if (project.expectedEnd === null) {
      warnings.push(
        'La obra no tiene fecha de fin prevista: sin ella no se puede avisar de un trámite que no llegará a tiempo, solo del que ya va tarde.',
      );
    }
    if (list.length === 0) {
      warnings.push(
        'No hay ningún trámite registrado. Los expedientes de acometida deberían abrirse el mismo mes de la adjudicación.',
      );
    }
    if (blockingPending.length > 0) {
      warnings.push(
        `Sin resolver, y son requisito para empezar: ${blockingPending.join(', ')}.`,
      );
    }
    if (counts.rojo > 0) {
      warnings.push(
        `${counts.rojo} trámite(s) en rojo. El retraso de una acometida no se recupera con medios: se recupera pidiéndola antes.`,
      );
    }

    return {
      projectId,
      projectCode: project.code,
      projectName: project.name,
      permits: list,
      counts,
      totalCost: round2(list.reduce((s, p) => s + (p.cost ?? 0), 0)),
      blockingPending,
      warnings,
    };
  }

  /** Trámites en rojo o ámbar de todas las obras, para la reunión mensual. */
  async alerts(): Promise<PermitDto[]> {
    const all = await this.list();
    return all
      .filter((p) => p.light !== 'verde')
      .sort((a, b) => b.daysLate - a.daysLate);
  }

  /* ────────────────────────── privados ────────────────────────── */

  private async get(id: string): Promise<PermitDto> {
    const [row] = await this.dbs.db
      .select({
        permit: permits,
        projectCode: projects.code,
        projectEnd: projects.expectedEnd,
      })
      .from(permits)
      .innerJoin(projects, eq(permits.projectId, projects.id))
      .where(and(eq(permits.id, id), isNull(permits.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Trámite no encontrado');
    return toDto(row, todayIso());
  }

  private async find(id: string): Promise<Permit> {
    const [row] = await this.dbs.db
      .select()
      .from(permits)
      .where(and(eq(permits.id, id), isNull(permits.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Trámite no encontrado');
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
  row: { permit: Permit; projectCode: string; projectEnd: string | null },
  today: string,
): PermitDto {
  const p = row.permit;
  const kind = p.kind as PermitKind;
  // La fecha objetivo es la propia del trámite y, si falta, el fin previsto de
  // la obra: es la fecha a la que todo tiene que estar resuelto.
  const neededBy = p.neededBy ?? row.projectEnd;

  const assessment = assessPermit(
    {
      kind,
      requestedAt: p.requestedAt,
      committedAt: p.committedAt,
      grantedAt: p.grantedAt,
      notApplicable: p.notApplicable,
    },
    today,
    neededBy,
  );

  return {
    id: p.id,
    projectId: p.projectId,
    projectCode: row.projectCode,
    kind,
    counterparty: p.counterparty,
    reference: p.reference,
    requestedAt: p.requestedAt,
    committedAt: p.committedAt,
    grantedAt: p.grantedAt,
    neededBy,
    cost: p.cost === null ? null : Number(p.cost),
    notApplicable: p.notApplicable,
    blocking: BLOCKING_PERMIT_KINDS.includes(kind),
    notes: p.notes,
    ...assessment,
    createdAt: p.createdAt.toISOString(),
  };
}
