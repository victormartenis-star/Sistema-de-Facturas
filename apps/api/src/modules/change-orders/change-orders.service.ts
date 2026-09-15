import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  ChangeOrder,
  ChangeOrderLinea,
  changeOrderLineas,
  changeOrders,
  contacts,
  projectPhases,
  projects,
} from '@erp/db';
import {
  ChangeOrderCreateInput,
  ChangeOrderDto,
  ChangeOrderEnviarInput,
  ChangeOrderResolverInput,
  ChangeOrderUpdateInput,
  buildChangeOrderNumber,
  canEditChangeOrder,
  canResolveChangeOrder,
  changeOrderCreateSchema,
  changeOrderEnviarSchema,
  changeOrderResolverSchema,
  changeOrderUpdateSchema,
  computeChangeOrderTotal,
  computeLineaImporte,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function toDto(
  row: ChangeOrder,
  lineas: ChangeOrderLinea[],
  phase: { code: string; name: string } | null,
  dfNombre: string | null,
): ChangeOrderDto {
  return {
    id: row.id,
    projectId: row.projectId,
    phaseId: row.phaseId,
    phaseCode: phase?.code ?? null,
    phaseName: phase?.name ?? null,
    numero: row.numero,
    tipo: row.tipo,
    estado: row.estado,
    titulo: row.titulo,
    descripcion: row.descripcion,
    motivo: row.motivo,
    direccionFacultativaContactId: row.direccionFacultativaContactId,
    direccionFacultativaNombre: dfNombre,
    importeEstimado: Number(row.importeEstimado),
    importeAprobado:
      row.importeAprobado === null ? null : Number(row.importeAprobado),
    documentId: row.documentId,
    fechaEnvio: row.fechaEnvio?.toISOString() ?? null,
    fechaResolucion: row.fechaResolucion?.toISOString() ?? null,
    comentarioResolucion: row.comentarioResolucion,
    notas: row.notas,
    lineas: lineas
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        id: l.id,
        budgetItemId: l.budgetItemId,
        descripcion: l.descripcion,
        unidad: l.unidad,
        cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precioUnitario),
        importe: Number(l.importe),
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ChangeOrdersService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: {
    projectId?: string;
    estado?: string;
  }): Promise<ChangeOrderDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (filter.projectId && !allowed.includes(filter.projectId)) return [];
    }

    const conditions = [
      eq(changeOrders.companyId, companyId),
      isNull(changeOrders.deletedAt),
    ];
    if (filter.projectId)
      conditions.push(eq(changeOrders.projectId, filter.projectId));
    if (filter.estado)
      conditions.push(
        eq(changeOrders.estado, filter.estado as ChangeOrder['estado']),
      );

    const rows = await this.dbs.db
      .select()
      .from(changeOrders)
      .where(and(...conditions))
      .orderBy(desc(changeOrders.createdAt));
    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.projectId));

    return Promise.all(visible.map((row) => this.hydrate(row)));
  }

  async get(id: string): Promise<ChangeOrderDto> {
    const row = await this.find(id);
    return this.hydrate(row);
  }

  async create(input: ChangeOrderCreateInput): Promise<ChangeOrderDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = changeOrderCreateSchema.parse(input);
    const project = await this.findProject(data.projectId);
    if (data.phaseId) await this.findPhase(data.phaseId, data.projectId);
    if (data.direccionFacultativaContactId)
      await this.findContact(data.direccionFacultativaContactId);

    const lineasConImporte = data.lineas.map((l, i) => ({
      ...l,
      importe: computeLineaImporte(l.cantidad, l.precioUnitario),
      sortOrder: i,
    }));
    const importeEstimado = computeChangeOrderTotal(lineasConImporte);

    const { row, lineas } = await this.dbs.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ seq: changeOrders.seq })
        .from(changeOrders)
        .where(
          and(
            eq(changeOrders.projectId, data.projectId),
            isNull(changeOrders.deletedAt),
          ),
        )
        .orderBy(desc(changeOrders.seq))
        .limit(1);
      const seq = (last?.seq ?? 0) + 1;

      const [inserted] = await tx
        .insert(changeOrders)
        .values({
          companyId,
          projectId: data.projectId,
          phaseId: data.phaseId ?? null,
          seq,
          numero: buildChangeOrderNumber(project.code, seq),
          tipo: data.tipo,
          titulo: data.titulo,
          descripcion: data.descripcion,
          motivo: data.motivo ?? null,
          direccionFacultativaContactId:
            data.direccionFacultativaContactId ?? null,
          importeEstimado: importeEstimado.toFixed(2),
          documentId: data.documentId ?? null,
          notas: data.notas ?? null,
        })
        .returning();

      const insertedLineas =
        lineasConImporte.length > 0
          ? await tx
              .insert(changeOrderLineas)
              .values(
                lineasConImporte.map((l) => ({
                  changeOrderId: inserted.id,
                  budgetItemId: l.budgetItemId ?? null,
                  descripcion: l.descripcion,
                  unidad: l.unidad,
                  cantidad: l.cantidad.toFixed(4),
                  precioUnitario: l.precioUnitario.toFixed(4),
                  importe: l.importe.toFixed(2),
                  sortOrder: l.sortOrder,
                })),
              )
              .returning()
          : [];
      return { row: inserted, lineas: insertedLineas };
    });

    void this.audit.log({
      entityType: 'change_order',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return this.hydrate(row, lineas);
  }

  async update(
    id: string,
    input: ChangeOrderUpdateInput,
  ): Promise<ChangeOrderDto> {
    const existing = await this.find(id);
    if (!canEditChangeOrder(existing.estado)) {
      throw new ConflictException(
        'Solo se puede editar un contradictorio/modificado en borrador',
      );
    }
    const data = changeOrderUpdateSchema.parse(input);
    if (data.phaseId) await this.findPhase(data.phaseId, existing.projectId);
    if (data.direccionFacultativaContactId)
      await this.findContact(data.direccionFacultativaContactId);

    const { row, lineas } = await this.dbs.db.transaction(async (tx) => {
      let lineasFinal: ChangeOrderLinea[];
      if (data.lineas !== undefined) {
        await tx
          .delete(changeOrderLineas)
          .where(eq(changeOrderLineas.changeOrderId, id));
        const lineasConImporte = data.lineas.map((l, i) => ({
          ...l,
          importe: computeLineaImporte(l.cantidad, l.precioUnitario),
          sortOrder: i,
        }));
        lineasFinal =
          lineasConImporte.length > 0
            ? await tx
                .insert(changeOrderLineas)
                .values(
                  lineasConImporte.map((l) => ({
                    changeOrderId: id,
                    budgetItemId: l.budgetItemId ?? null,
                    descripcion: l.descripcion,
                    unidad: l.unidad,
                    cantidad: l.cantidad.toFixed(4),
                    precioUnitario: l.precioUnitario.toFixed(4),
                    importe: l.importe.toFixed(2),
                    sortOrder: l.sortOrder,
                  })),
                )
                .returning()
            : [];
      } else {
        lineasFinal = await tx
          .select()
          .from(changeOrderLineas)
          .where(eq(changeOrderLineas.changeOrderId, id));
      }
      const importeEstimado = computeChangeOrderTotal(
        lineasFinal.map((l) => ({ importe: Number(l.importe) })),
      );

      const [updated] = await tx
        .update(changeOrders)
        .set({
          ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
          ...(data.tipo !== undefined && { tipo: data.tipo }),
          ...(data.titulo !== undefined && { titulo: data.titulo }),
          ...(data.descripcion !== undefined && {
            descripcion: data.descripcion,
          }),
          ...(data.motivo !== undefined && { motivo: data.motivo ?? null }),
          ...(data.direccionFacultativaContactId !== undefined && {
            direccionFacultativaContactId:
              data.direccionFacultativaContactId ?? null,
          }),
          ...(data.documentId !== undefined && {
            documentId: data.documentId ?? null,
          }),
          ...(data.notas !== undefined && { notas: data.notas ?? null }),
          importeEstimado: importeEstimado.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, id))
        .returning();
      return { row: updated, lineas: lineasFinal };
    });

    return this.hydrate(row, lineas);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.find(id);
    if (!canEditChangeOrder(existing.estado)) {
      throw new ConflictException(
        'Solo se puede eliminar un contradictorio/modificado en borrador',
      );
    }
    await this.dbs.db
      .update(changeOrders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(changeOrders.id, id));
  }

  /** Envía el borrador a la Dirección Facultativa para su resolución. */
  async enviar(
    id: string,
    input: ChangeOrderEnviarInput,
  ): Promise<ChangeOrderDto> {
    const existing = await this.find(id);
    if (!canEditChangeOrder(existing.estado)) {
      throw new ConflictException(
        'Este contradictorio/modificado ya se ha enviado o resuelto',
      );
    }
    const data = changeOrderEnviarSchema.parse(input);
    await this.findContact(data.direccionFacultativaContactId);

    const [row] = await this.dbs.db
      .update(changeOrders)
      .set({
        estado: 'enviado_df',
        direccionFacultativaContactId: data.direccionFacultativaContactId,
        fechaEnvio: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, id))
      .returning();

    void this.audit.log({
      entityType: 'change_order',
      entityId: id,
      action: 'update',
      newData: { estado: 'enviado_df' },
    });
    return this.hydrate(row);
  }

  /** Resolución de la Dirección Facultativa: aprueba o rechaza. */
  async resolver(
    id: string,
    input: ChangeOrderResolverInput,
  ): Promise<ChangeOrderDto> {
    const existing = await this.find(id);
    if (!canResolveChangeOrder(existing.estado)) {
      throw new ConflictException(
        'Solo se puede resolver un contradictorio/modificado enviado a la Dirección Facultativa',
      );
    }
    const data = changeOrderResolverSchema.parse(input);

    const [row] = await this.dbs.db
      .update(changeOrders)
      .set({
        estado: data.estado,
        importeAprobado:
          data.estado === 'aprobado'
            ? (
                data.importeAprobado ?? Number(existing.importeEstimado)
              ).toFixed(2)
            : null,
        comentarioResolucion: data.comentarioResolucion ?? null,
        fechaResolucion: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(changeOrders.id, id))
      .returning();

    void this.audit.log({
      entityType: 'change_order',
      entityId: id,
      action: 'update',
      newData: { estado: data.estado, importeAprobado: row.importeAprobado },
    });
    return this.hydrate(row);
  }

  /* ────────────────────── privados ────────────────────── */

  private async hydrate(
    row: ChangeOrder,
    lineas?: ChangeOrderLinea[],
  ): Promise<ChangeOrderDto> {
    const finalLineas =
      lineas ??
      (await this.dbs.db
        .select()
        .from(changeOrderLineas)
        .where(eq(changeOrderLineas.changeOrderId, row.id)));
    const phase = row.phaseId ? await this.findPhaseById(row.phaseId) : null;
    const dfNombre = row.direccionFacultativaContactId
      ? (await this.findContact(row.direccionFacultativaContactId)).legalName
      : null;
    return toDto(row, finalLineas, phase, dfNombre);
  }

  private async findPhaseById(
    phaseId: string,
  ): Promise<{ code: string; name: string } | null> {
    const [row] = await this.dbs.db
      .select({ code: projectPhases.code, name: projectPhases.name })
      .from(projectPhases)
      .where(eq(projectPhases.id, phaseId))
      .limit(1);
    return row ?? null;
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
    if (!row) throw new NotFoundException('Fase no encontrada en esta obra');
    return row;
  }

  private async findContact(contactId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Contacto no encontrado');
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

  private async find(id: string): Promise<ChangeOrder> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(changeOrders)
      .where(
        and(
          eq(changeOrders.id, id),
          eq(changeOrders.companyId, companyId),
          isNull(changeOrders.deletedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException('Contradictorio/modificado no encontrado');
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(row.projectId)) {
      throw new NotFoundException('Contradictorio/modificado no encontrado');
    }
    return row;
  }
}
