import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  Project,
  Variation,
  projectPhases,
  projects,
  variations,
} from '@erp/db';
import {
  VariationApproveInput,
  VariationCreateInput,
  VariationDto,
  VariationKind,
  VariationReportDto,
  VariationStatus,
  VariationUpdateInput,
  buildVariationNumber,
  computeBudgetImpact,
  formatEuros,
  deriveVariationStatus,
  round2,
  todayIso,
  variationAge,
  variationApproveSchema,
  variationCreateSchema,
  variationRejectSchema,
  variationUpdateSchema,
  variationWarnings,
  type VariationRejectInput,
} from '@erp/shared';
import { DbService } from '../db/db.service';

@Injectable()
export class VariationsService {
  constructor(private readonly dbs: DbService) {}

  async list(projectId?: string): Promise<VariationDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters = [
      eq(variations.companyId, companyId),
      isNull(variations.deletedAt),
    ];
    if (projectId) filters.push(eq(variations.projectId, projectId));

    const rows = await this.dbs.db
      .select({
        variation: variations,
        projectCode: projects.code,
        phaseCode: projectPhases.code,
      })
      .from(variations)
      .innerJoin(projects, eq(variations.projectId, projects.id))
      .leftJoin(projectPhases, eq(variations.phaseId, projectPhases.id))
      .where(and(...filters))
      .orderBy(asc(variations.projectId), asc(variations.seq));

    const today = todayIso();
    return rows.map((r) => toDto(r, today));
  }

  async get(id: string): Promise<VariationDto> {
    return toDto(await this.findWithJoins(id), todayIso());
  }

  async create(input: VariationCreateInput): Promise<VariationDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = variationCreateSchema.parse(input);
    const project = await this.findProject(data.projectId);

    const id = await this.dbs.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ seq: variations.seq })
        .from(variations)
        .where(
          and(
            eq(variations.projectId, data.projectId),
            isNull(variations.deletedAt),
          ),
        )
        .orderBy(desc(variations.seq))
        .limit(1);
      const seq = (last?.seq ?? 0) + 1;

      const [row] = await tx
        .insert(variations)
        .values({
          companyId,
          projectId: data.projectId,
          seq,
          variationNumber: buildVariationNumber(project.code, seq),
          kind: data.kind as VariationKind,
          phaseId: data.phaseId ?? null,
          description: data.description,
          salesVariation: data.salesVariation.toFixed(2),
          costVariation: data.costVariation.toFixed(2),
          requestedAt: data.requestedAt,
          executed: data.executed,
          clientOrderRef: data.clientOrderRef ?? null,
          notes: data.notes ?? null,
        })
        .returning();
      return row.id;
    });
    return this.get(id);
  }

  async update(id: string, input: VariationUpdateInput): Promise<VariationDto> {
    const variation = await this.find(id);
    if (variation.status === 'aprobado') {
      throw new ConflictException(
        'Un modificado aprobado no se edita: ya está incorporado al presupuesto actualizado. Registra otra modificación si hay cambios.',
      );
    }
    const data = variationUpdateSchema.parse(input);

    await this.dbs.db
      .update(variations)
      .set({
        ...(data.kind !== undefined && { kind: data.kind as VariationKind }),
        ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.salesVariation !== undefined && {
          salesVariation: data.salesVariation.toFixed(2),
        }),
        ...(data.costVariation !== undefined && {
          costVariation: data.costVariation.toFixed(2),
        }),
        ...(data.requestedAt !== undefined && {
          requestedAt: data.requestedAt,
        }),
        ...(data.executed !== undefined && { executed: data.executed }),
        ...(data.clientOrderRef !== undefined && {
          clientOrderRef: data.clientOrderRef ?? null,
        }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(variations.id, id));
    return this.get(id);
  }

  /**
   * Registra una de las dos aprobaciones. El estado no se fija a mano: se
   * deriva de las firmas registradas, así que no puede quedar "aprobado" un
   * modificado al que le falte una.
   */
  async approve(
    id: string,
    input: VariationApproveInput,
  ): Promise<VariationDto> {
    const variation = await this.find(id);
    if (variation.rejectedAt) {
      throw new ConflictException(
        'El modificado está rechazado. Reábrelo antes de registrar una aprobación.',
      );
    }
    const data = variationApproveSchema.parse(input);
    const approvals = {
      dfApprovedAt:
        data.by === 'df' ? data.date : (variation.dfApprovedAt ?? null),
      ownerApprovedAt:
        data.by === 'propiedad'
          ? data.date
          : (variation.ownerApprovedAt ?? null),
      rejectedAt: null,
    };

    await this.dbs.db
      .update(variations)
      .set({
        ...approvals,
        status: deriveVariationStatus(approvals),
        updatedAt: new Date(),
      })
      .where(eq(variations.id, id));
    return this.get(id);
  }

  /** La Propiedad lo deniega. Se conserva el registro para la liquidación. */
  async reject(id: string, input: VariationRejectInput): Promise<VariationDto> {
    await this.find(id);
    const data = variationRejectSchema.parse(input);
    await this.dbs.db
      .update(variations)
      .set({
        rejectedAt: data.date,
        rejectionReason: data.reason,
        status: 'rechazado',
        updatedAt: new Date(),
      })
      .where(eq(variations.id, id));
    return this.get(id);
  }

  /** Vuelve a dejarlo pendiente, borrando firmas y negativa. */
  async reopen(id: string): Promise<VariationDto> {
    await this.find(id);
    await this.dbs.db
      .update(variations)
      .set({
        dfApprovedAt: null,
        ownerApprovedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        status: 'pendiente',
        updatedAt: new Date(),
      })
      .where(eq(variations.id, id));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const variation = await this.find(id);
    if (variation.status === 'aprobado') {
      throw new ConflictException(
        'Un modificado aprobado no se borra: forma parte del presupuesto actualizado',
      );
    }
    await this.dbs.db
      .update(variations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(variations.id, id));
  }

  /**
   * Informe de modificaciones de una obra (anexo D del manual): el cuadro de
   * impacto y los tres bloques separados, porque lo pendiente y lo rechazado
   * no pueden leerse junto a lo aprobado.
   */
  async report(projectId: string): Promise<VariationReportDto> {
    const project = await this.findProject(projectId);
    const all = await this.list(projectId);

    const impact = computeBudgetImpact(
      Number(project.contractAmount ?? 0),
      all.map((v) => ({
        status: v.status,
        salesVariation: v.salesVariation,
        costVariation: v.costVariation,
        executed: v.executed,
      })),
    );

    const byStatus = (status: VariationStatus) =>
      all.filter((v) => v.status === status);

    const warnings: string[] = [];
    if (project.contractAmount === null) {
      warnings.push(
        'La obra no tiene presupuesto contractual: el cuadro de impacto parte de cero.',
      );
    }
    if (impact.executedNotApprovedCount > 0) {
      warnings.push(
        `${impact.executedNotApprovedCount} modificación(es) en ejecución sin aprobar, con ${formatEuros(impact.executedNotApprovedCost)} de coste comprometido sin ingreso que lo respalde.`,
      );
    }
    const escalables = byStatus('pendiente').filter((v) =>
      v.warnings.some((w) => w.includes('escalarlo')),
    );
    if (escalables.length > 0) {
      warnings.push(
        `${escalables.length} modificación(es) llevan más de 60 días pendientes: ${escalables.map((v) => v.variationNumber).join(', ')}.`,
      );
    }

    return {
      projectId,
      projectCode: project.code,
      projectName: project.name,
      impact,
      approved: byStatus('aprobado'),
      pending: byStatus('pendiente'),
      rejected: byStatus('rechazado'),
      warnings,
    };
  }

  /* ────────────────────────── privados ────────────────────────── */

  private async findWithJoins(id: string) {
    const [row] = await this.dbs.db
      .select({
        variation: variations,
        projectCode: projects.code,
        phaseCode: projectPhases.code,
      })
      .from(variations)
      .innerJoin(projects, eq(variations.projectId, projects.id))
      .leftJoin(projectPhases, eq(variations.phaseId, projectPhases.id))
      .where(and(eq(variations.id, id), isNull(variations.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Modificación no encontrada');
    return row;
  }

  private async find(id: string): Promise<Variation> {
    const [row] = await this.dbs.db
      .select()
      .from(variations)
      .where(and(eq(variations.id, id), isNull(variations.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Modificación no encontrada');
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
  row: {
    variation: Variation;
    projectCode: string;
    phaseCode: string | null;
  },
  today: string,
): VariationDto {
  const v = row.variation;
  const status = v.status as VariationStatus;
  const salesVariation = Number(v.salesVariation);
  const costVariation = Number(v.costVariation);

  return {
    id: v.id,
    variationNumber: v.variationNumber,
    seq: v.seq,
    projectId: v.projectId,
    projectCode: row.projectCode,
    kind: v.kind as VariationKind,
    phaseId: v.phaseId,
    phaseCode: row.phaseCode,
    description: v.description,
    salesVariation,
    costVariation,
    variationMargin: round2(salesVariation - costVariation),
    requestedAt: v.requestedAt,
    // Una vez resuelto deja de acumular antigüedad: lo que se mide es el
    // tiempo que estuvo esperando, no el que lleva existiendo.
    ageDays: status === 'pendiente' ? variationAge(v.requestedAt, today) : 0,
    dfApprovedAt: v.dfApprovedAt,
    ownerApprovedAt: v.ownerApprovedAt,
    rejectedAt: v.rejectedAt,
    rejectionReason: v.rejectionReason,
    status,
    executed: v.executed,
    clientOrderRef: v.clientOrderRef,
    notes: v.notes,
    warnings: variationWarnings(
      {
        variationNumber: v.variationNumber,
        status,
        executed: v.executed,
        clientOrderRef: v.clientOrderRef,
        costVariation,
        requestedAt: v.requestedAt,
        dfApprovedAt: v.dfApprovedAt,
        ownerApprovedAt: v.ownerApprovedAt,
      },
      today,
    ),
    createdAt: v.createdAt.toISOString(),
  };
}
