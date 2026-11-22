import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
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

  /**
   * Bloqueo de ejecución/gasto: una partida con un contradictorio/modificado
   * todavía sin resolver por la Dirección Facultativa (`borrador` o
   * `enviado_df`) no se puede certificar — llamado desde
   * `CertificationLinesService.create()`. Una vez `aprobado`/`rechazado`/
   * `cancelado`, deja de bloquear: la resolución (en cualquier sentido) es
   * lo que libera la partida, no el simple paso del tiempo.
   */
  async assertBudgetItemNotBlocked(budgetItemId: string): Promise<void> {
    const [blocking] = await this.dbs.db
      .select({ numero: changeOrders.numero, estado: changeOrders.estado })
      .from(changeOrderLineas)
      .innerJoin(
        changeOrders,
        eq(changeOrderLineas.changeOrderId, changeOrders.id),
      )
      .where(
        and(
          eq(changeOrderLineas.budgetItemId, budgetItemId),
          isNull(changeOrders.deletedAt),
          inArray(changeOrders.estado, ['borrador', 'enviado_df']),
        ),
      )
      .limit(1);
    if (blocking) {
      throw new ConflictException({
        code: 'CHANGE_ORDER_BLOCKING',
        message: `No se puede certificar: la partida tiene el contradictorio/modificado ${blocking.numero} pendiente de resolución de la Dirección Facultativa`,
      });
    }
  }

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

    return this.hydrateMany(visible);
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
      await this.audit.registrar(tx, {
        entityType: 'change_order',
        entityId: inserted.id,
        action: 'create',
        newData: inserted,
      });
      return { row: inserted, lineas: insertedLineas };
    });

    return this.hydrate(row, lineas);
  }

  async update(
    id: string,
    input: ChangeOrderUpdateInput,
  ): Promise<ChangeOrderDto> {
    const existing = await this.find(id);
    if (!canEditChangeOrder(existing.estado)) {
      throw new ConflictException({
        code: 'CHANGE_ORDER_NOT_DRAFT',
        message:
          'Solo se puede editar un contradictorio/modificado en borrador',
      });
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
      throw new ConflictException({
        code: 'CHANGE_ORDER_NOT_DRAFT',
        message:
          'Solo se puede eliminar un contradictorio/modificado en borrador',
      });
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
      throw new ConflictException({
        code: 'CHANGE_ORDER_ALREADY_SENT',
        message: 'Este contradictorio/modificado ya se ha enviado o resuelto',
      });
    }
    const data = changeOrderEnviarSchema.parse(input);
    await this.findContact(data.direccionFacultativaContactId);

    const row = await this.dbs.db.transaction(async (tx) => {
      const [row] = await tx
        .update(changeOrders)
        .set({
          estado: 'enviado_df',
          direccionFacultativaContactId: data.direccionFacultativaContactId,
          fechaEnvio: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'change_order',
        entityId: id,
        action: 'update',
        newData: { estado: 'enviado_df' },
      });
      return row;
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
      throw new ConflictException({
        code: 'CHANGE_ORDER_NOT_SENT',
        message:
          'Solo se puede resolver un contradictorio/modificado enviado a la Dirección Facultativa',
      });
    }
    const data = changeOrderResolverSchema.parse(input);

    const row = await this.dbs.db.transaction(async (tx) => {
      const [row] = await tx
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
      await this.audit.registrar(tx, {
        entityType: 'change_order',
        entityId: id,
        action: 'update',
        newData: { estado: data.estado, importeAprobado: row.importeAprobado },
      });
      return row;
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

  /**
   * `hydrate` para un listado: tres consultas por lote (líneas, fases y
   * contactos) en lugar de hasta tres por fila.
   */
  private async hydrateMany(rows: ChangeOrder[]): Promise<ChangeOrderDto[]> {
    if (rows.length === 0) return [];
    const companyId = await this.dbs.getCompanyId();
    const lineas = await this.dbs.db
      .select()
      .from(changeOrderLineas)
      .where(
        inArray(
          changeOrderLineas.changeOrderId,
          rows.map((r) => r.id),
        ),
      );
    const lineasPorOrden = new Map<string, ChangeOrderLinea[]>();
    for (const l of lineas) {
      const lista = lineasPorOrden.get(l.changeOrderId) ?? [];
      lista.push(l);
      lineasPorOrden.set(l.changeOrderId, lista);
    }

    const idsFase = [...new Set(rows.map((r) => r.phaseId).filter((x) => !!x))];
    const fases = new Map<string, { code: string; name: string }>();
    if (idsFase.length > 0) {
      const filas = await this.dbs.db
        .select({
          id: projectPhases.id,
          code: projectPhases.code,
          name: projectPhases.name,
        })
        .from(projectPhases)
        .where(
          and(
            inArray(projectPhases.id, idsFase as string[]),
            eq(projectPhases.companyId, companyId),
            isNull(projectPhases.deletedAt),
          ),
        );
      for (const f of filas) fases.set(f.id, f);
    }

    const idsContacto = [
      ...new Set(
        rows.map((r) => r.direccionFacultativaContactId).filter((x) => !!x),
      ),
    ];
    const contactos = new Map<string, string>();
    if (idsContacto.length > 0) {
      const filas = await this.dbs.db
        .select({ id: contacts.id, legalName: contacts.legalName })
        .from(contacts)
        .where(
          and(
            inArray(contacts.id, idsContacto as string[]),
            eq(contacts.companyId, companyId),
            isNull(contacts.deletedAt),
          ),
        );
      for (const c of filas) contactos.set(c.id, c.legalName);
    }

    return rows.map((row) => {
      const phase = row.phaseId ? (fases.get(row.phaseId) ?? null) : null;
      let dfNombre: string | null = null;
      if (row.direccionFacultativaContactId) {
        const nombre = contactos.get(row.direccionFacultativaContactId);
        // Mismo comportamiento que `hydrate`: un contacto borrado da 404.
        if (nombre === undefined)
          throw new NotFoundException({
            code: 'CONTACT_NOT_FOUND',
            message: 'Contacto no encontrado',
          });
        dfNombre = nombre;
      }
      return toDto(row, lineasPorOrden.get(row.id) ?? [], phase, dfNombre);
    });
  }

  private async findPhaseById(
    phaseId: string,
  ): Promise<{ code: string; name: string } | null> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ code: projectPhases.code, name: projectPhases.name })
      .from(projectPhases)
      .where(
        and(
          eq(projectPhases.id, phaseId),
          eq(projectPhases.companyId, companyId),
          isNull(projectPhases.deletedAt),
        ),
      )
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
    if (!row)
      throw new NotFoundException({
        code: 'PHASE_NOT_FOUND',
        message: 'Fase no encontrada en esta obra',
      });
    return row;
  }

  private async findContact(contactId: string) {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.companyId, companyId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contacto no encontrado',
      });
    return row;
  }

  private async findProject(projectId: string) {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    }
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
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
      throw new NotFoundException({
        code: 'CHANGE_ORDER_NOT_FOUND',
        message: 'Contradictorio/modificado no encontrado',
      });
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(row.projectId)) {
      throw new NotFoundException({
        code: 'CHANGE_ORDER_NOT_FOUND',
        message: 'Contradictorio/modificado no encontrado',
      });
    }
    return row;
  }
}
