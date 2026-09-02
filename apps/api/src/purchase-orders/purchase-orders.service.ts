import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import {
  PurchaseOrder,
  contacts,
  deliveryNotes,
  projectPhases,
  projects,
  purchaseOrders,
} from '@erp/db';
import {
  PurchaseOrderCreateInput,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  PurchaseOrderUpdateInput,
  TraceabilityReportDto,
  TraceabilityRowDto,
  blockedSupplierWarning,
  buildOrderNumber,
  daysBetween,
  deriveOrderStatus,
  pendingToDeliver,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
  round2,
  todayIso,
  traceabilityReading,
} from '@erp/shared';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';

/** Importes servidos y facturados de un pedido, sacados de sus albaranes. */
interface Delivered {
  deliveredAmount: number;
  invoicedAmount: number;
  count: number;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly dbs: DbService,
    private readonly compliance: ComplianceService,
  ) {}

  async list(options: {
    search?: string;
    status?: PurchaseOrderStatus;
    projectId?: string;
    contactId?: string;
    /** Solo pedidos que todavía pueden recibir albaranes. */
    receiving?: boolean;
  }): Promise<PurchaseOrderDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(purchaseOrders.companyId, companyId),
      isNull(purchaseOrders.deletedAt),
    ];
    if (options.status) filters.push(eq(purchaseOrders.status, options.status));
    if (options.projectId) {
      filters.push(eq(purchaseOrders.projectId, options.projectId));
    }
    if (options.contactId) {
      filters.push(eq(purchaseOrders.contactId, options.contactId));
    }
    if (options.receiving) {
      filters.push(
        inArray(purchaseOrders.status, [
          'emitido',
          'servido_parcial',
          'servido',
        ]),
      );
    }
    if (options.search?.trim()) {
      const term = `%${options.search.trim()}%`;
      filters.push(
        or(
          ilike(purchaseOrders.orderNumber, term),
          ilike(purchaseOrders.description, term),
          ilike(contacts.legalName, term),
        ) as SQL,
      );
    }

    const rows = await this.dbs.db
      .select({
        order: purchaseOrders,
        contactName: contacts.legalName,
        projectCode: projects.code,
        projectName: projects.name,
        phaseCode: projectPhases.code,
      })
      .from(purchaseOrders)
      .innerJoin(contacts, eq(purchaseOrders.contactId, contacts.id))
      .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
      .leftJoin(projectPhases, eq(purchaseOrders.phaseId, projectPhases.id))
      .where(and(...filters))
      .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.seq));

    const delivered = await this.deliveredByOrder(rows.map((r) => r.order.id));
    return rows.map((r) => this.toDto(r, delivered.get(r.order.id)));
  }

  async get(id: string): Promise<PurchaseOrderDto> {
    const row = await this.findWithJoins(id);
    const delivered = await this.deliveredByOrder([id]);
    return this.toDto(row, delivered.get(id));
  }

  /**
   * Alta de pedido. El correlativo se toma del último pedido de la obra
   * dentro de la transacción: dos altas simultáneas no pueden repetir número
   * porque el índice único parcial lo impide.
   */
  async create(input: PurchaseOrderCreateInput): Promise<PurchaseOrderDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = purchaseOrderCreateSchema.parse(input);
    const project = await this.findProject(data.projectId);
    await this.assertContactExists(data.contactId);

    const id = await this.dbs.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ seq: purchaseOrders.seq })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.projectId, data.projectId),
            isNull(purchaseOrders.deletedAt),
          ),
        )
        .orderBy(desc(purchaseOrders.seq))
        .limit(1);
      const seq = (last?.seq ?? 0) + 1;

      const [row] = await tx
        .insert(purchaseOrders)
        .values({
          companyId,
          projectId: data.projectId,
          contactId: data.contactId,
          seq,
          orderNumber: buildOrderNumber(project.code, seq),
          orderDate: data.orderDate,
          phaseId: data.phaseId ?? null,
          categoryId: data.categoryId ?? null,
          description: data.description,
          amount: data.amount.toFixed(2),
          expectedDate: data.expectedDate ?? null,
          requestedBy: data.requestedBy ?? null,
          urgent: data.urgent,
          notes: data.notes ?? null,
        })
        .returning();
      return row.id;
    });
    return this.get(id);
  }

  async update(
    id: string,
    input: PurchaseOrderUpdateInput,
  ): Promise<PurchaseOrderDto> {
    const order = await this.find(id);
    if (order.status === 'cerrado' || order.status === 'anulado') {
      throw new ConflictException(
        `No se puede editar un pedido ${order.status}`,
      );
    }
    const data = purchaseOrderUpdateSchema.parse(input);
    if (data.contactId) await this.assertContactExists(data.contactId);

    await this.dbs.db
      .update(purchaseOrders)
      .set({
        ...(data.contactId !== undefined && { contactId: data.contactId }),
        ...(data.orderDate !== undefined && { orderDate: data.orderDate }),
        ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
        ...(data.categoryId !== undefined && {
          categoryId: data.categoryId ?? null,
        }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.amount !== undefined && { amount: data.amount.toFixed(2) }),
        ...(data.expectedDate !== undefined && {
          expectedDate: data.expectedDate ?? null,
        }),
        ...(data.requestedBy !== undefined && {
          requestedBy: data.requestedBy ?? null,
        }),
        ...(data.urgent !== undefined && { urgent: data.urgent }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));
    await this.refreshStatus(id);
    return this.get(id);
  }

  /**
   * Cierre del pedido (etapa de liquidación: "ningún pedido queda sin
   * factura"). Se avisa de lo recibido sin facturar en lugar de cerrarlo en
   * silencio, porque ese importe es coste que se perdería.
   */
  async close(id: string): Promise<PurchaseOrderDto> {
    const order = await this.find(id);
    if (order.status === 'anulado') {
      throw new ConflictException('El pedido está anulado');
    }
    const delivered = (await this.deliveredByOrder([id])).get(id);
    const pending = round2(
      (delivered?.deliveredAmount ?? 0) - (delivered?.invoicedAmount ?? 0),
    );
    if (pending > 0) {
      throw new ConflictException(
        `No se puede cerrar: quedan ${pending.toFixed(2)} € recibidos sin facturar. Regulariza la factura o anota la incidencia antes de cerrar.`,
      );
    }
    await this.dbs.db
      .update(purchaseOrders)
      .set({ status: 'cerrado', closedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));
    return this.get(id);
  }

  async cancel(id: string): Promise<PurchaseOrderDto> {
    const order = await this.find(id);
    const delivered = (await this.deliveredByOrder([id])).get(id);
    if ((delivered?.count ?? 0) > 0) {
      throw new ConflictException(
        'No se puede anular un pedido con albaranes imputados',
      );
    }
    if (order.status === 'anulado') return this.get(id);
    await this.dbs.db
      .update(purchaseOrders)
      .set({ status: 'anulado', updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const delivered = (await this.deliveredByOrder([id])).get(id);
    if ((delivered?.count ?? 0) > 0) {
      throw new ConflictException(
        'No se puede eliminar un pedido con albaranes imputados',
      );
    }
    await this.find(id);
    await this.dbs.db
      .update(purchaseOrders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));
  }

  /**
   * Recalcula el estado del pedido a partir de sus albaranes. Lo llama el
   * módulo de albaranes cada vez que uno se crea, se imputa o se factura.
   */
  async refreshStatus(id: string): Promise<void> {
    const [order] = await this.dbs.db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .limit(1);
    if (!order) return;

    const delivered = (await this.deliveredByOrder([id])).get(id);
    const next = deriveOrderStatus(
      order.status as PurchaseOrderStatus,
      Number(order.amount),
      delivered?.deliveredAmount ?? 0,
    );
    if (next !== order.status) {
      await this.dbs.db
        .update(purchaseOrders)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, id));
    }
  }

  /**
   * Cuadro de trazabilidad del apartado 6.3 del manual de procesos.
   *
   * La cifra que justifica el cuadro es `totalAccrual`: lo recibido y no
   * facturado, que es exactamente la provisión que necesita el cierre
   * mensual. Sin ella el coste del mes sale falseado a la baja.
   */
  async traceability(projectId?: string): Promise<TraceabilityReportDto> {
    const orders = await this.list({ projectId });

    // Se reutiliza el criterio de homologación en lugar de reimplementarlo:
    // si mañana cambia lo que bloquea a una empresa, cambia también aquí.
    const fichas = await this.compliance.list(false);
    const bloqueadas = new Set(
      fichas.filter((f) => f.blocked).map((f) => f.contactId),
    );

    const rows: TraceabilityRowDto[] = orders
      .filter((o) => o.status !== 'anulado')
      .map((o) => {
        const accrualAmount = round2(o.deliveredAmount - o.invoicedAmount);
        const base = {
          hasDeliveryNote: o.deliveryNoteCount > 0,
          hasInvoice: o.invoicedAmount > 0,
          accrualAmount,
        };
        return {
          orderId: o.id,
          orderNumber: o.orderNumber,
          contactName: o.contactName,
          amount: o.amount,
          deliveredAmount: o.deliveredAmount,
          invoicedAmount: o.invoicedAmount,
          ...base,
          supplierBlocked: bloqueadas.has(o.contactId),
          reading: traceabilityReading(base),
        };
      });

    const sum = (pick: (r: TraceabilityRowDto) => number) =>
      round2(rows.reduce((s, r) => s + pick(r), 0));

    const project = orders[0];
    const aviso = blockedSupplierWarning(rows);
    return {
      projectId: projectId ?? null,
      projectCode: projectId ? (project?.projectCode ?? null) : null,
      rows,
      totalAccrual: sum((r) => r.accrualAmount),
      totalOrdered: sum((r) => r.amount),
      totalDelivered: sum((r) => r.deliveredAmount),
      totalInvoiced: sum((r) => r.invoicedAmount),
      blockedSupplierAmount: round2(
        rows.filter((r) => r.supplierBlocked).reduce((s, r) => s + r.amount, 0),
      ),
      warnings: aviso ? [aviso] : [],
    };
  }

  /* ────────────────────────── privados ────────────────────────── */

  /** Suma de albaranes por pedido, en una sola consulta (sin N+1). */
  private async deliveredByOrder(
    orderIds: string[],
  ): Promise<Map<string, Delivered>> {
    const map = new Map<string, Delivered>();
    if (orderIds.length === 0) return map;

    const rows = await this.dbs.db
      .select({
        orderId: deliveryNotes.orderId,
        delivered: sql<string>`coalesce(sum(${deliveryNotes.amount}), 0)`,
        invoiced: sql<string>`coalesce(sum(${deliveryNotes.amount}) filter (where ${deliveryNotes.invoiceId} is not null), 0)`,
        count: sql<string>`count(*)`,
      })
      .from(deliveryNotes)
      .where(
        and(
          inArray(deliveryNotes.orderId, orderIds),
          isNull(deliveryNotes.deletedAt),
        ),
      )
      .groupBy(deliveryNotes.orderId);

    for (const r of rows) {
      if (!r.orderId) continue;
      map.set(r.orderId, {
        deliveredAmount: round2(Number(r.delivered)),
        invoicedAmount: round2(Number(r.invoiced)),
        count: Number(r.count),
      });
    }
    return map;
  }

  private toDto(
    row: {
      order: PurchaseOrder;
      contactName: string;
      projectCode: string;
      projectName: string;
      phaseCode: string | null;
    },
    delivered: Delivered | undefined,
  ): PurchaseOrderDto {
    const { order } = row;
    const amount = Number(order.amount);
    const deliveredAmount = delivered?.deliveredAmount ?? 0;
    const invoicedAmount = delivered?.invoicedAmount ?? 0;
    // Solo se cuenta retraso mientras el pedido siga esperando material.
    const late =
      order.expectedDate &&
      (order.status === 'emitido' || order.status === 'servido_parcial')
        ? -daysBetween(todayIso(), order.expectedDate)
        : 0;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      seq: order.seq,
      projectId: order.projectId,
      projectCode: row.projectCode,
      projectName: row.projectName,
      contactId: order.contactId,
      contactName: row.contactName,
      orderDate: order.orderDate,
      phaseId: order.phaseId,
      phaseCode: row.phaseCode,
      categoryId: order.categoryId,
      description: order.description,
      amount,
      expectedDate: order.expectedDate,
      daysLate: Math.max(0, late),
      requestedBy: order.requestedBy,
      status: order.status as PurchaseOrderStatus,
      urgent: order.urgent,
      deliveredAmount,
      invoicedAmount,
      pendingToDeliver: pendingToDeliver(amount, deliveredAmount),
      pendingToInvoice: round2(deliveredAmount - invoicedAmount),
      deliveryNoteCount: delivered?.count ?? 0,
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private async findWithJoins(id: string) {
    const [row] = await this.dbs.db
      .select({
        order: purchaseOrders,
        contactName: contacts.legalName,
        projectCode: projects.code,
        projectName: projects.name,
        phaseCode: projectPhases.code,
      })
      .from(purchaseOrders)
      .innerJoin(contacts, eq(purchaseOrders.contactId, contacts.id))
      .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
      .leftJoin(projectPhases, eq(purchaseOrders.phaseId, projectPhases.id))
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Pedido no encontrado');
    return row;
  }

  private async find(id: string): Promise<PurchaseOrder> {
    const [row] = await this.dbs.db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Pedido no encontrado');
    return row;
  }

  private async findProject(projectId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Obra no encontrada');
    return row;
  }

  private async assertContactExists(contactId: string): Promise<void> {
    const [row] = await this.dbs.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Proveedor no encontrado');
  }
}
