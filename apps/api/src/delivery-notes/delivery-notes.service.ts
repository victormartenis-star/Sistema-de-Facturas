import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  SQL,
  sql,
  sum,
} from 'drizzle-orm';
import {
  DbOrTx,
  DeliveryNote,
  contacts,
  deliveryNotes,
  projects,
  purchaseOrders,
} from '@erp/db';
import {
  DeliveryNoteCreateInput,
  DeliveryNoteDto,
  DeliveryNoteStatus,
  DeliveryNoteReturnInput,
  DeliveryNoteUpdateInput,
  PurchaseOrderStatus,
  canDeleteDeliveryNote,
  canReturnDeliveryNote,
  deliveryNoteBlockReason,
  deliveryNoteCreateSchema,
  deliveryNoteEditBlockReason,
  deliveryNoteReturnSchema,
  deliveryNoteUpdateSchema,
  construirPagina,
  calcularOffset,
  type PaginaDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { DbService } from '../db/db.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';

const UNIQUE_VIOLATION = '23505';

type Row = {
  note: DeliveryNote;
  contactName: string;
  projectCode: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  orderAmount: string | null;
};

function toDto(row: Row, alreadyDelivered?: number | null): DeliveryNoteDto {
  const { note } = row;
  return {
    id: note.id,
    contactId: note.contactId,
    contactName: row.contactName,
    projectId: note.projectId,
    projectCode: row.projectCode,
    phaseId: note.phaseId,
    orderId: note.orderId,
    orderNumber: row.orderNumber,
    blockReason: deliveryNoteBlockReason({
      orderNumber: row.orderNumber,
      orderStatus: row.orderStatus as PurchaseOrderStatus | null,
      orderAmount: row.orderAmount != null ? Number(row.orderAmount) : null,
      alreadyDelivered: alreadyDelivered ?? null,
      noteAmount: Number(note.amount),
    }),
    noteNumber: note.noteNumber,
    noteDate: note.noteDate,
    description: note.description,
    amount: Number(note.amount),
    status: note.status as DeliveryNoteStatus,
    validatedAt: note.validatedAt?.toISOString() ?? null,
    invoiceId: note.invoiceId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

@Injectable()
export class DeliveryNotesService {
  constructor(
    private readonly dbs: DbService,
    private readonly orders: PurchaseOrdersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Listado con filtros. `availableForContact` devuelve solo los albaranes
   * validados y sin factura de ese proveedor: los candidatos al punteado.
   */
  async list(options: {
    search?: string;
    status?: DeliveryNoteStatus;
    contactId?: string;
    availableForContact?: string;
    projectId?: string;
    /** Con página, responde `PaginaDto`; sin ella, el array completo. */
    pagina?: { page: number; pageSize: number };
  }): Promise<DeliveryNoteDto[] | PaginaDto<DeliveryNoteDto>> {
    const companyId = this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters: SQL[] = [
      eq(deliveryNotes.companyId, companyId),
      isNull(deliveryNotes.deletedAt),
    ];
    if (allowed !== null) {
      if (allowed.length === 0) {
        return options.pagina
          ? construirPagina([], 0, options.pagina.page, options.pagina.pageSize)
          : [];
      }
      filters.push(inArray(deliveryNotes.projectId, allowed));
    }
    if (options.projectId) {
      filters.push(eq(deliveryNotes.projectId, options.projectId));
    }
    if (options.status) filters.push(eq(deliveryNotes.status, options.status));
    if (options.contactId) {
      filters.push(eq(deliveryNotes.contactId, options.contactId));
    }
    if (options.availableForContact) {
      filters.push(
        eq(deliveryNotes.contactId, options.availableForContact),
        eq(deliveryNotes.status, 'validado'),
        isNull(deliveryNotes.invoiceId),
      );
    }
    if (options.search?.trim()) {
      const term = `%${options.search.trim()}%`;
      filters.push(
        or(
          ilike(deliveryNotes.noteNumber, term),
          ilike(contacts.legalName, term),
        ) as SQL,
      );
    }
    let total = 0;
    if (options.pagina) {
      const [c] = await this.dbs.db
        .select({ n: sql<number>`count(*)::int` })
        .from(deliveryNotes)
        .innerJoin(contacts, eq(deliveryNotes.contactId, contacts.id))
        .where(and(...filters));
      total = c?.n ?? 0;
    }
    const query = this.dbs.db
      .select({
        note: deliveryNotes,
        contactName: contacts.legalName,
        projectCode: projects.code,
        orderNumber: purchaseOrders.orderNumber,
        orderStatus: purchaseOrders.status,
        // En el listado no calculamos alreadyDelivered (costoso con N filas)
        orderAmount: purchaseOrders.amount,
      })
      .from(deliveryNotes)
      .innerJoin(contacts, eq(deliveryNotes.contactId, contacts.id))
      .leftJoin(projects, eq(deliveryNotes.projectId, projects.id))
      .leftJoin(purchaseOrders, eq(deliveryNotes.orderId, purchaseOrders.id))
      .where(and(...filters))
      .orderBy(
        desc(deliveryNotes.noteDate),
        desc(deliveryNotes.createdAt),
        desc(deliveryNotes.id),
      );
    if (!options.pagina) return (await query).map((r) => toDto(r));
    const { page, pageSize } = options.pagina;
    const rows = await query
      .limit(pageSize)
      .offset(calcularOffset(page, pageSize));
    return construirPagina(
      rows.map((r) => toDto(r)),
      total,
      page,
      pageSize,
    );
  }

  async create(input: DeliveryNoteCreateInput): Promise<DeliveryNoteDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = deliveryNoteCreateSchema.parse(input);
    try {
      // Albarán y estado del pedido en una sola transacción: si el refresco
      // falla, no queda un albarán con el pedido desfasado.
      const row = await this.dbs.db.transaction(async (tx) => {
        await this.orders.bloquearPedidos(tx, [data.orderId]);
        const [created] = await tx
          .insert(deliveryNotes)
          .values({
            companyId,
            contactId: data.contactId,
            projectId: data.projectId ?? null,
            phaseId: data.phaseId ?? null,
            orderId: data.orderId ?? null,
            noteNumber: data.noteNumber,
            noteDate: data.noteDate,
            description: data.description ?? null,
            amount: data.amount.toFixed(2),
          })
          .returning();
        if (created.orderId) {
          await this.orders.refreshStatus(created.orderId, tx);
        }
        return created;
      });
      return this.get(row.id);
    } catch (err) {
      this.rethrowDuplicateNumber(err, data.noteNumber);
    }
  }

  async update(
    id: string,
    input: DeliveryNoteUpdateInput,
  ): Promise<DeliveryNoteDto> {
    const previa = await this.find(id);
    const data = deliveryNoteUpdateSchema.parse(input);
    const campos = Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    try {
      await this.dbs.db.transaction(async (tx) => {
        // Orden de bloqueo: pedido(s) -> albarán. Luego se relee la fila con
        // bloqueo para aplicar las reglas de estado sobre el estado real.
        await this.orders.bloquearPedidos(tx, [previa.orderId, data.orderId]);
        const note = await this.lockNote(tx, id);
        if (note.orderId !== previa.orderId) {
          throw new ConflictException('El albarán ha cambiado: recarga');
        }
        const bloqueo = deliveryNoteEditBlockReason(
          {
            status: note.status as DeliveryNoteStatus,
            invoiceId: note.invoiceId,
          },
          campos,
        );
        if (bloqueo) throw new ConflictException(bloqueo);

        await tx
          .update(deliveryNotes)
          .set({
            ...(data.contactId !== undefined && { contactId: data.contactId }),
            ...(data.projectId !== undefined && {
              projectId: data.projectId ?? null,
            }),
            ...(data.phaseId !== undefined && {
              phaseId: data.phaseId ?? null,
            }),
            ...(data.orderId !== undefined && {
              orderId: data.orderId ?? null,
            }),
            ...(data.noteNumber !== undefined && {
              noteNumber: data.noteNumber,
            }),
            ...(data.noteDate !== undefined && { noteDate: data.noteDate }),
            ...(data.description !== undefined && {
              description: data.description ?? null,
            }),
            ...(data.amount !== undefined && {
              amount: data.amount.toFixed(2),
            }),
            updatedAt: new Date(),
          })
          .where(eq(deliveryNotes.id, id));

        // El pedido (el de antes y el de ahora) puede quedar desfasado.
        const pedidos = new Set<string>();
        if (note.orderId) pedidos.add(note.orderId);
        if (data.orderId) pedidos.add(data.orderId);
        for (const pedido of [...pedidos].sort()) {
          await this.orders.refreshStatus(pedido, tx);
        }
      });
    } catch (err) {
      this.rethrowDuplicateNumber(err, data.noteNumber ?? '');
    }
    return this.get(id);
  }

  /**
   * El encargado da por bueno el albarán: pasa a "validado".
   *
   * Aquí se aplica la regla de oro del procedimiento de compras: sin número
   * de pedido no hay albarán validado. Es el único punto en el que todavía se
   * puede parar una compra no controlada —antes de que el material se dé por
   * bueno—, y no cuando la factura ya está registrada.
   */
  async validate(id: string): Promise<DeliveryNoteDto> {
    const note = await this.find(id);
    if (note.status !== 'pendiente') {
      throw new ConflictException('Solo se validan albaranes pendientes');
    }

    // Transacción con bloqueo (pedido -> albarán): dos validaciones
    // simultáneas de albaranes del mismo pedido se serializan, así la segunda
    // ve lo recibido por la primera y el 3-way match no se salta el importe.
    await this.dbs.db.transaction(async (tx) => {
      await this.orders.bloquearPedidos(tx, [note.orderId]);
      const [locked] = await tx
        .select({ status: deliveryNotes.status })
        .from(deliveryNotes)
        .where(and(eq(deliveryNotes.id, id), isNull(deliveryNotes.deletedAt)))
        .for('update');
      if (!locked || locked.status !== 'pendiente') {
        throw new ConflictException('Solo se validan albaranes pendientes');
      }

      const dto = await this.get(id, tx);
      if (dto.blockReason) {
        // 422: la petición es correcta, la regla de negocio no se cumple.
        throw new UnprocessableEntityException(dto.blockReason);
      }

      await cambiarEstado(
        tx,
        deliveryNotes,
        'delivery_note',
        id,
        'pendiente',
        'validado',
        { validatedAt: new Date() },
      );
      if (note.orderId) await this.orders.refreshStatus(note.orderId, tx);
    });
    return this.get(id);
  }

  /**
   * Devuelve un albarán validado (y aún sin factura) a pendiente, con motivo.
   * Es la corrección de un albarán ya dado por bueno: queda auditada y vuelve
   * a pasar el 3-way match al revalidarlo.
   */
  async returnToPending(
    id: string,
    input: DeliveryNoteReturnInput,
  ): Promise<DeliveryNoteDto> {
    const { motivo } = deliveryNoteReturnSchema.parse(input);
    const note = await this.find(id);

    await this.dbs.db.transaction(async (tx) => {
      // Mismo orden de bloqueo que `validate`: pedido -> albarán.
      await this.orders.bloquearPedidos(tx, [note.orderId]);
      const locked = await this.lockNote(tx, id);
      if (
        !canReturnDeliveryNote({
          status: locked.status as DeliveryNoteStatus,
          invoiceId: locked.invoiceId,
        })
      ) {
        throw new ConflictException(
          locked.status === 'validado'
            ? 'El albarán está vinculado a una factura: no se puede devolver a pendiente'
            : 'Solo se devuelven a pendiente los albaranes validados',
        );
      }
      await cambiarEstado(
        tx,
        deliveryNotes,
        'delivery_note',
        id,
        'validado',
        'pendiente',
        { validatedAt: null },
      );
      if (locked.orderId) await this.orders.refreshStatus(locked.orderId, tx);
    });

    void this.audit.log({
      entityType: 'delivery_note',
      entityId: id,
      action: 'update',
      oldData: { status: 'validado' },
      newData: { status: 'pendiente' },
      meta: { accion: 'devolver', motivo },
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const previa = await this.find(id);
    await this.dbs.db.transaction(async (tx) => {
      await this.orders.bloquearPedidos(tx, [previa.orderId]);
      const note = await this.lockNote(tx, id);
      if (note.orderId !== previa.orderId) {
        throw new ConflictException('El albarán ha cambiado: recarga');
      }
      const estado = {
        status: note.status as DeliveryNoteStatus,
        invoiceId: note.invoiceId,
      };
      if (!canDeleteDeliveryNote(estado)) {
        throw new ConflictException(
          estado.status === 'facturado'
            ? 'No se puede eliminar un albarán facturado: anula antes la factura'
            : 'No se puede eliminar un albarán validado: devuélvelo antes a pendiente',
        );
      }
      await tx
        .update(deliveryNotes)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(deliveryNotes.id, id));
      if (note.orderId) await this.orders.refreshStatus(note.orderId, tx);
    });
  }

  /** Relee el albarán con `FOR UPDATE`: las reglas de estado se aplican sobre el estado real. */
  private async lockNote(tx: DbOrTx, id: string): Promise<DeliveryNote> {
    const [row] = await tx
      .select()
      .from(deliveryNotes)
      .where(and(eq(deliveryNotes.id, id), isNull(deliveryNotes.deletedAt)))
      .for('update');
    if (!row) throw new NotFoundException('Albarán no encontrado');
    return row;
  }

  private async get(
    id: string,
    executor: DbOrTx = this.dbs.db,
  ): Promise<DeliveryNoteDto> {
    const [row] = await executor
      .select({
        note: deliveryNotes,
        contactName: contacts.legalName,
        projectCode: projects.code,
        orderNumber: purchaseOrders.orderNumber,
        orderStatus: purchaseOrders.status,
        orderAmount: purchaseOrders.amount,
      })
      .from(deliveryNotes)
      .innerJoin(contacts, eq(deliveryNotes.contactId, contacts.id))
      .leftJoin(projects, eq(deliveryNotes.projectId, projects.id))
      .leftJoin(purchaseOrders, eq(deliveryNotes.orderId, purchaseOrders.id))
      .where(and(eq(deliveryNotes.id, id), isNull(deliveryNotes.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Albarán no encontrado');
    }

    // 3-way match banda 1↔2: importe ya recibido en albaranes validados del pedido
    let alreadyDelivered: number | null = null;
    if (row.note.orderId) {
      const [agg] = await executor
        .select({ total: sum(deliveryNotes.amount) })
        .from(deliveryNotes)
        .where(
          and(
            eq(deliveryNotes.orderId, row.note.orderId),
            eq(deliveryNotes.status, 'validado'),
            ne(deliveryNotes.id, id),
            isNull(deliveryNotes.deletedAt),
          ),
        );
      alreadyDelivered = Number(agg?.total ?? 0);
    }

    return toDto(row, alreadyDelivered);
  }

  private async find(id: string): Promise<DeliveryNote> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(deliveryNotes)
      .where(
        and(
          eq(deliveryNotes.id, id),
          eq(deliveryNotes.companyId, companyId),
          isNull(deliveryNotes.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException('Albarán no encontrado');
    }
    // Un usuario restringido por obra solo toca albaranes de sus obras; el
    // 404 (y no 403) no delata que el albarán exista.
    const allowed = await this.dbs.getObrasAccesibles();
    if (
      allowed !== null &&
      (!row.projectId || !allowed.includes(row.projectId))
    ) {
      throw new NotFoundException('Albarán no encontrado');
    }
    return row;
  }

  private rethrowDuplicateNumber(err: unknown, num: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException(
        `Ya existe un albarán con el número "${num}" para ese proveedor`,
      );
    }
    throw err;
  }
}
