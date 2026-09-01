import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  Project,
  Worker,
  WorkerDoc,
  contacts,
  projects,
  workerAssignments,
  workerDocs,
  workers,
} from '@erp/db';
import {
  GateListDto,
  WorkerAssignmentInput,
  WorkerCreateInput,
  WorkerDocDto,
  WorkerDocInput,
  WorkerDocType,
  WorkerDto,
  WorkerUpdateInput,
  assessWorker,
  complianceDocStatus,
  daysBetween,
  daysToNextExpiry,
  todayIso,
  workerAssignmentSchema,
  workerCreateSchema,
  workerDocSchema,
  workerUpdateSchema,
} from '@erp/shared';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';

@Injectable()
export class WorkersService {
  constructor(
    private readonly dbs: DbService,
    private readonly compliance: ComplianceService,
  ) {}

  async list(options: {
    contactId?: string;
    projectId?: string;
  }): Promise<WorkerDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters = [
      eq(workers.companyId, companyId),
      isNull(workers.deletedAt),
    ];
    if (options.contactId)
      filters.push(eq(workers.contactId, options.contactId));

    const rows = await this.dbs.db
      .select({ worker: workers, contactName: contacts.legalName })
      .from(workers)
      .innerJoin(contacts, eq(workers.contactId, contacts.id))
      .where(and(...filters))
      .orderBy(asc(contacts.legalName), asc(workers.fullName));

    const ids = rows.map((r) => r.worker.id);
    const [docs, assignments, blocked] = await Promise.all([
      this.docsOf(ids),
      this.assignmentsOf(ids),
      this.blockedCompanies(rows.map((r) => r.worker.contactId)),
    ]);

    const today = todayIso();
    const dtos = rows.map((r) =>
      toDto(
        r.worker,
        r.contactName,
        docs.get(r.worker.id) ?? [],
        assignments.get(r.worker.id) ?? [],
        blocked.has(r.worker.contactId),
        today,
      ),
    );

    return options.projectId
      ? dtos.filter((w) => w.projects.some((p) => p.id === options.projectId))
      : dtos;
  }

  async get(id: string): Promise<WorkerDto> {
    const [row] = await this.dbs.db
      .select({ worker: workers, contactName: contacts.legalName })
      .from(workers)
      .innerJoin(contacts, eq(workers.contactId, contacts.id))
      .where(and(eq(workers.id, id), isNull(workers.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Trabajador no encontrado');

    const [docs, assignments, blocked] = await Promise.all([
      this.docsOf([id]),
      this.assignmentsOf([id]),
      this.blockedCompanies([row.worker.contactId]),
    ]);
    return toDto(
      row.worker,
      row.contactName,
      docs.get(id) ?? [],
      assignments.get(id) ?? [],
      blocked.has(row.worker.contactId),
      todayIso(),
    );
  }

  async create(input: WorkerCreateInput): Promise<WorkerDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = workerCreateSchema.parse(input);
    const [row] = await this.dbs.db
      .insert(workers)
      .values({
        companyId,
        contactId: data.contactId,
        fullName: data.fullName,
        docId: data.docId ?? null,
        jobTitle: data.jobTitle ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    return this.get(row.id);
  }

  async update(id: string, input: WorkerUpdateInput): Promise<WorkerDto> {
    await this.find(id);
    const data = workerUpdateSchema.parse(input);
    await this.dbs.db
      .update(workers)
      .set({
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.docId !== undefined && { docId: data.docId ?? null }),
        ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle ?? null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(workers.id, id));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.dbs.db
      .update(workers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workers.id, id));
  }

  /** Un documento de cada tipo: el nuevo sustituye al anterior. */
  async saveDoc(workerId: string, input: WorkerDocInput): Promise<WorkerDto> {
    await this.find(workerId);
    const data = workerDocSchema.parse(input);
    await this.dbs.db
      .insert(workerDocs)
      .values({
        workerId,
        docType: data.docType as WorkerDocType,
        issuedAt: data.issuedAt ?? null,
        expiresAt: data.expiresAt ?? null,
        documentId: data.documentId ?? null,
        rejected: data.rejected,
        notes: data.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [workerDocs.workerId, workerDocs.docType],
        set: {
          issuedAt: data.issuedAt ?? null,
          expiresAt: data.expiresAt ?? null,
          documentId: data.documentId ?? null,
          rejected: data.rejected,
          notes: data.notes ?? null,
          updatedAt: new Date(),
        },
      });
    return this.get(workerId);
  }

  async setAssignment(
    workerId: string,
    input: WorkerAssignmentInput,
  ): Promise<WorkerDto> {
    await this.find(workerId);
    const data = workerAssignmentSchema.parse(input);

    if (data.assigned) {
      await this.dbs.db
        .insert(workerAssignments)
        .values({ workerId, projectId: data.projectId })
        .onConflictDoNothing();
    } else {
      await this.dbs.db
        .delete(workerAssignments)
        .where(
          and(
            eq(workerAssignments.workerId, workerId),
            eq(workerAssignments.projectId, data.projectId),
          ),
        );
    }
    return this.get(workerId);
  }

  /**
   * Listado semanal de autorizados de una obra: el papel que el encargado
   * lleva a la valla.
   *
   * Salen los autorizados **y** los denegados. Un listado que solo trae a los
   * buenos no sirve para negar el acceso a nadie: quien no aparece puede ser
   * tanto un vetado como alguien a quien nadie dio de alta, y en la puerta esa
   * diferencia no se puede resolver.
   */
  async gateList(projectId: string): Promise<GateListDto> {
    const project = await this.findProject(projectId);
    const list = await this.list({ projectId });

    const allowed = list.filter((w) => w.allowed);
    const denied = list.filter((w) => !w.allowed);

    const blockedCompanies = [
      ...new Set(
        denied
          .filter((w) =>
            w.reasons.some((r) => r.includes('empresa no está homologada')),
          )
          .map((w) => w.contactName),
      ),
    ];

    const warnings: string[] = [];
    if (list.length === 0) {
      warnings.push(
        'No hay ningún trabajador dado de alta en esta obra. Sin listado no se puede controlar el acceso.',
      );
    }
    if (denied.length > 0) {
      warnings.push(
        `${denied.length} trabajador(es) no pueden acceder hoy. Sin documentación validada no hay acceso.`,
      );
    }
    if (blockedCompanies.length > 0) {
      warnings.push(
        `Subcontratas bloqueadas con gente asignada: ${blockedCompanies.join(', ')}.`,
      );
    }
    const caducanPronto = allowed.filter((w) => w.expiring.length > 0);
    if (caducanPronto.length > 0) {
      warnings.push(
        `${caducanPronto.length} trabajador(es) tienen documentación a punto de caducar: pide la renovación antes de que les deje fuera.`,
      );
    }

    return {
      projectId,
      projectCode: project.code,
      projectName: project.name,
      generatedAt: todayIso(),
      allowed,
      denied,
      blockedCompanies,
      warnings,
    };
  }

  /* ────────────────────────── privados ────────────────────────── */

  private async docsOf(ids: string[]): Promise<Map<string, WorkerDoc[]>> {
    const map = new Map<string, WorkerDoc[]>();
    if (ids.length === 0) return map;
    const rows = await this.dbs.db
      .select()
      .from(workerDocs)
      .where(inArray(workerDocs.workerId, ids));
    for (const r of rows) {
      map.set(r.workerId, [...(map.get(r.workerId) ?? []), r]);
    }
    return map;
  }

  private async assignmentsOf(
    ids: string[],
  ): Promise<Map<string, { id: string; code: string }[]>> {
    const map = new Map<string, { id: string; code: string }[]>();
    if (ids.length === 0) return map;
    const rows = await this.dbs.db
      .select({
        workerId: workerAssignments.workerId,
        id: projects.id,
        code: projects.code,
      })
      .from(workerAssignments)
      .innerJoin(projects, eq(workerAssignments.projectId, projects.id))
      .where(
        and(
          inArray(workerAssignments.workerId, ids),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(asc(projects.code));
    for (const r of rows) {
      map.set(r.workerId, [
        ...(map.get(r.workerId) ?? []),
        { id: r.id, code: r.code },
      ]);
    }
    return map;
  }

  /**
   * Subcontratas bloqueadas, según el módulo de homologación. Se reutiliza su
   * criterio en lugar de reimplementarlo: si mañana cambia lo que bloquea a
   * una empresa, tiene que cambiar también aquí sin tocar nada.
   */
  private async blockedCompanies(contactIds: string[]): Promise<Set<string>> {
    const unicos = [...new Set(contactIds)];
    if (unicos.length === 0) return new Set();
    const fichas = await this.compliance.list(false);
    return new Set(fichas.filter((f) => f.blocked).map((f) => f.contactId));
  }

  private async find(id: string): Promise<Worker> {
    const [row] = await this.dbs.db
      .select()
      .from(workers)
      .where(and(eq(workers.id, id), isNull(workers.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Trabajador no encontrado');
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
  worker: Worker,
  contactName: string,
  docs: WorkerDoc[],
  projectList: { id: string; code: string }[],
  companyBlocked: boolean,
  today: string,
): WorkerDto {
  const docStates = docs.map((d) => ({
    docType: d.docType as WorkerDocType,
    expiresAt: d.expiresAt,
    rejected: d.rejected,
  }));

  const assessment = assessWorker(
    { isActive: worker.isActive, docs: docStates, companyBlocked },
    today,
  );

  const docDtos: WorkerDocDto[] = docs.map((d) => ({
    id: d.id,
    docType: d.docType as WorkerDocType,
    issuedAt: d.issuedAt,
    expiresAt: d.expiresAt,
    documentId: d.documentId,
    rejected: d.rejected,
    notes: d.notes,
    status: complianceDocStatus(
      { rejected: d.rejected, expiresAt: d.expiresAt },
      today,
    ) as WorkerDocDto['status'],
    daysToExpiry: d.expiresAt ? daysBetween(today, d.expiresAt) : null,
  }));

  return {
    id: worker.id,
    contactId: worker.contactId,
    contactName,
    fullName: worker.fullName,
    docId: worker.docId,
    jobTitle: worker.jobTitle,
    isActive: worker.isActive,
    notes: worker.notes,
    docs: docDtos,
    projects: projectList,
    ...assessment,
    daysToNextExpiry: daysToNextExpiry(docStates, today),
    createdAt: worker.createdAt.toISOString(),
  };
}
