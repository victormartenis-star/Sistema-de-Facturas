import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  Project,
  permits,
  projectChecklist,
  projectMonthlyPlan,
  projects,
  users,
} from '@erp/db';
import {
  AutoFacts,
  ChecklistDto,
  ChecklistItemKey,
  ChecklistMarkInput,
  ManualMark,
  buildChecklist,
  checklistBlockReason,
  checklistItem,
  checklistMarkSchema,
  checklistSummary,
  todayIso,
} from '@erp/shared';
import { DbService } from '../db/db.service';

@Injectable()
export class ChecklistService {
  constructor(private readonly dbs: DbService) {}

  async get(projectId: string): Promise<ChecklistDto> {
    const project = await this.findProject(projectId);
    const [auto, manual] = await Promise.all([
      this.autoFacts(project),
      this.manualMarks(projectId),
    ]);

    const rows = buildChecklist(auto, manual);
    const summary = checklistSummary(rows);

    const warnings: string[] = [];
    if (!summary.canStart && project.status === 'en_curso') {
      warnings.push(
        `La obra figura en curso con ${summary.pendingBlockers.length} requisito(s) de apertura sin cumplir.`,
      );
    }
    const prevencion = rows.find((r) => r.key === 'apertura_centro_trabajo');
    if (prevencion && !prevencion.done && project.startDate) {
      warnings.push(
        'La comunicación de apertura de centro de trabajo es previa al inicio de los trabajos, y la obra ya tiene fecha de inicio.',
      );
    }

    return {
      projectId,
      projectCode: project.code,
      projectName: project.name,
      rows,
      ...summary,
      warnings,
    };
  }

  /**
   * Marca o desmarca un punto manual. Se comprueba el orden aquí y no solo en
   * la pantalla: la regla de prevención tiene que sostenerse aunque alguien
   * llame a la API directamente.
   */
  async mark(
    projectId: string,
    input: ChecklistMarkInput,
  ): Promise<ChecklistDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    await this.findProject(projectId);
    const data = checklistMarkSchema.parse(input);
    const key = data.key as ChecklistItemKey;

    if (checklistItem(key).auto) {
      throw new ConflictException(
        'Este punto lo comprueba el sistema: se cumple registrando el dato que le falta, no marcándolo.',
      );
    }

    if (data.done) {
      const current = await this.get(projectId);
      const blocked = checklistBlockReason(key, current.rows);
      if (blocked) throw new ConflictException(blocked);

      await this.dbs.db
        .insert(projectChecklist)
        .values({
          companyId,
          projectId,
          itemKey: key,
          doneAt: todayIso(),
          markedBy: data.markedBy ?? null,
          notes: data.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [projectChecklist.projectId, projectChecklist.itemKey],
          set: {
            doneAt: todayIso(),
            markedBy: data.markedBy ?? null,
            notes: data.notes ?? null,
            updatedAt: new Date(),
          },
        });
    } else {
      // Al desmarcar caen también los pasos que dependían de este: dejar
      // aprobada un acta cuyo plan ya no consta sería peor que no tenerla.
      const dependents = dependentsOf(key);
      await this.dbs.db.transaction(async (tx) => {
        for (const k of [key, ...dependents]) {
          await tx
            .delete(projectChecklist)
            .where(
              and(
                eq(projectChecklist.projectId, projectId),
                eq(projectChecklist.itemKey, k),
              ),
            );
        }
      });
    }

    return this.get(projectId);
  }

  /* ────────────────────────── privados ────────────────────────── */

  /**
   * Lo que el sistema puede comprobar por su cuenta. Cada punto devuelve
   * además un detalle legible, para que quien mire la pantalla sepa **qué** ha
   * visto el sistema y no solo si dice sí o no.
   */
  private async autoFacts(project: Project): Promise<AutoFacts> {
    const [plan, projectPermits, staff] = await Promise.all([
      this.dbs.db
        .select({ month: projectMonthlyPlan.month })
        .from(projectMonthlyPlan)
        .where(
          and(
            eq(projectMonthlyPlan.projectId, project.id),
            isNull(projectMonthlyPlan.deletedAt),
          ),
        ),
      this.dbs.db
        .select()
        .from(permits)
        .where(
          and(eq(permits.projectId, project.id), isNull(permits.deletedAt)),
        ),
      this.staffNames(project),
    ]);

    const permit = (kind: string) =>
      projectPermits.find((p) => p.kind === kind);
    const requested = (kind: string) => {
      const p = permit(kind);
      return !p ? false : p.notApplicable || p.requestedAt !== null;
    };
    const granted = (kind: string) => {
      const p = permit(kind);
      return !p ? false : p.notApplicable || p.grantedAt !== null;
    };

    const faltanLicencias = [
      !requested('licencia_obra') && 'licencia de obra',
      !requested('ocupacion_via_publica') && 'ocupación de vía pública',
      !requested('licencia_cala') && 'licencia de cala',
    ].filter(Boolean) as string[];

    const faltanAcometidas = [
      !granted('acometida_agua_provisional') && 'agua provisional sin resolver',
      !granted('acometida_electrica_provisional') &&
        'luz provisional sin resolver',
      !requested('acometida_agua') && 'agua definitiva sin iniciar',
      !requested('acometida_electrica') && 'luz definitiva sin iniciar',
    ].filter(Boolean) as string[];

    const presupuestoFalta = [
      project.contractAmount === null && 'presupuesto de venta',
      project.targetCost === null && 'coste objetivo',
      plan.length === 0 && 'planificación mensual',
    ].filter(Boolean) as string[];

    return {
      codigo_obra: { done: true, detail: project.code },
      responsables_asignados: {
        done: Boolean(project.groupManagerId && project.siteManagerId),
        detail: staff.responsables,
      },
      presupuesto_cargado: {
        done: presupuestoFalta.length === 0,
        detail:
          presupuestoFalta.length === 0
            ? `Venta, objetivo y ${plan.length} meses planificados`
            : `Falta: ${presupuestoFalta.join(', ')}`,
      },
      licencias_solicitadas: {
        done: faltanLicencias.length === 0,
        detail:
          faltanLicencias.length === 0
            ? 'Las tres constan solicitadas o marcadas como no aplicables'
            : `Sin registrar: ${faltanLicencias.join(', ')}`,
      },
      acometidas_provisionales: {
        done: faltanAcometidas.length === 0,
        detail:
          faltanAcometidas.length === 0
            ? 'Provisionales concedidas y definitivas en trámite'
            : faltanAcometidas.join(', '),
      },
      encargado_designado: {
        done: project.foremanId !== null,
        detail: staff.encargado,
      },
    };
  }

  /** Nombres de los responsables, para el detalle de la pantalla. */
  private async staffNames(
    project: Project,
  ): Promise<{ responsables: string; encargado: string }> {
    const ids = [
      project.groupManagerId,
      project.siteManagerId,
      project.foremanId,
    ].filter(Boolean) as string[];

    const rows = ids.length
      ? await this.dbs.db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(isNull(users.deletedAt))
      : [];
    const name = (id: string | null) =>
      id ? (rows.find((r) => r.id === id)?.fullName ?? '—') : null;

    const grupo = name(project.groupManagerId);
    const obra = name(project.siteManagerId);
    const responsables = !grupo
      ? 'Falta el Jefe de Grupo'
      : !obra
        ? 'Falta el Jefe de Obra'
        : `Jefe de Grupo ${grupo} · Jefe de Obra ${obra}`;

    return {
      responsables,
      encargado: name(project.foremanId) ?? 'Sin encargado designado',
    };
  }

  private async manualMarks(projectId: string): Promise<ManualMark[]> {
    const rows = await this.dbs.db
      .select()
      .from(projectChecklist)
      .where(eq(projectChecklist.projectId, projectId));
    return rows.map((r) => ({
      key: r.itemKey as ChecklistItemKey,
      doneAt: r.doneAt,
      markedBy: r.markedBy,
      notes: r.notes,
    }));
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

/** Puntos que dependen, directa o indirectamente, del que se desmarca. */
function dependentsOf(key: ChecklistItemKey): ChecklistItemKey[] {
  const chain: Record<string, ChecklistItemKey[]> = {
    plan_seguridad: ['acta_aprobacion_plan', 'apertura_centro_trabajo'],
    acta_aprobacion_plan: ['apertura_centro_trabajo'],
  };
  return chain[key] ?? [];
}
