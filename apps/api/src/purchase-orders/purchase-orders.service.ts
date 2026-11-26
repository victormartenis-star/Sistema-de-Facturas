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
  DbOrTx,
  PurchaseOrder,
  type Tx,
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
  buildOrderNumber,
  centsToNumeric,
  daysBetween,
  deriveOrderStatus,
  pendingToDeliver,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
  round2,
  toCents,
  todayIso,
  traceabilityReading,
} from '@erp/shared';
import { cambiarEstado } from '../common/cambiar-estado';
import { AprobacionesService } from '../aprobaciones/aprobaciones.service';
import { ControlPresupuestarioService } from '../cost-control/control-presupuestario.service';
import { DbService } from '../db/db.service';
import {
  condicionVersion,
  falloActualizacion,
  incrementarVersion,
  verificarVersion,
} from '../common/version';
import { ProveedoresService } from '../modules/proveedores/proveedores.service';
import { facturadoPorLineasDePedidos } from '../compras/cuadre';

/** Importes servidos y facturados de un pedido, sacados de sus albaranes. */
interface Delivered {
  deliveredAmount: number;
  /** Solo albaranes validados o facturados: lo que ya cuenta como recibido. */
  receivedAmount: number;
  invoicedAmount: number;
  count: number;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly dbs: DbService,
    private readonly proveedores: ProveedoresService,
    private readonly control: ControlPresupuestarioService,
    private readonly aprobaciones: AprobacionesService,
  ) {}

  async list(options: {
    search?: string;
    status?: PurchaseOrderStatus;
    projectId?: string;
    contactId?: string;
    /** Solo pedidos que todavía pueden recibir albaranes. */
    receiving?: boolean;
  }): Promise<PurchaseOrderDto[]> {
    const companyId = this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters: SQL[] = [
      eq(purchaseOrders.companyId, companyId),
      isNull(purchaseOrders.deletedAt),
    ];
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      filters.push(inArray(purchaseOrders.projectId, allowed));
    }
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
    const companyId = await this.dbs.getCompanyId();
    const data = purchaseOrderCreateSchema.parse(input);
    const project = await this.findProject(data.projectId);
    await this.assertContactExists(data.contactId);
    // Guard PRL (Fase 11): no se emite un pedido a una subcontrata cuya
    // documentación de prevención de riesgos laborales no está al día —
    // más temprano que el guard de `InvoicesService.approve()`, corta el
    // compromiso antes de que llegue a generar gasto.
    await this.proveedores.assertAptoParaPago(
      data.contactId,
      'emitir el pedido',
    );

    const id = await this.dbs.db.transaction(async (tx) => {
      // Control presupuestario activo: el pedido compromete coste de la obra.
      // Va antes de numerar: su bloqueo por obra serializa también el seq.
      await this.control.verificar(tx, {
        projectId: data.projectId,
        importe: data.amount.toFixed(2),
        operacion: 'pedido_compra',
        referencia: project.code,
      });
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

  /**
   * Alta de un pedido dentro de la transacción del llamador (compras con
   * líneas: solicitud convertida, oferta adjudicada o pedido directo). Mismas
   * reglas que `create`: proveedor existente y apto (PRL), control
   * presupuestario por el importe y correlativo por obra.
   */
  async crearEnTx(
    tx: Tx,
    d: {
      projectId: string;
      contactId: string;
      orderDate: string;
      description: string;
      amount: string;
      phaseId?: string | null;
      expectedDate?: string | null;
      notes?: string | null;
      requisitionId?: string | null;
      rfqId?: string | null;
      tolerancias?: {
        precioPct?: number;
        precioImporte?: number;
        cantidadPct?: number;
      };
    },
  ): Promise<PurchaseOrder> {
    const companyId = this.dbs.getCompanyId();
    const project = await this.findProject(d.projectId);
    await this.assertContactExists(d.contactId);
    await this.proveedores.assertAptoParaPago(d.contactId, 'emitir el pedido');
    await this.control.verificar(tx, {
      projectId: d.projectId,
      importe: d.amount,
      operacion: 'pedido_compra',
      referencia: project.code,
    });
    const [last] = await tx
      .select({ seq: purchaseOrders.seq })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.projectId, d.projectId),
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
        projectId: d.projectId,
        contactId: d.contactId,
        seq,
        orderNumber: buildOrderNumber(project.code, seq),
        orderDate: d.orderDate,
        phaseId: d.phaseId ?? null,
        description: d.description,
        amount: d.amount,
        expectedDate: d.expectedDate ?? null,
        notes: d.notes ?? null,
        requisitionId: d.requisitionId ?? null,
        rfqId: d.rfqId ?? null,
        ...(d.tolerancias?.precioPct !== undefined && {
          priceTolerancePct: d.tolerancias.precioPct.toFixed(2),
        }),
        ...(d.tolerancias?.precioImporte !== undefined && {
          priceToleranceAmount: d.tolerancias.precioImporte.toFixed(2),
        }),
        ...(d.tolerancias?.cantidadPct !== undefined && {
          quantityTolerancePct: d.tolerancias.cantidadPct.toFixed(2),
        }),
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    input: PurchaseOrderUpdateInput,
    versionEsperada?: number,
  ): Promise<PurchaseOrderDto> {
    const order = await this.find(id);
    verificarVersion(order.version, versionEsperada);
    if (order.status === 'cerrado' || order.status === 'anulado') {
      throw new ConflictException({
        code: 'PURCHASE_ORDER_NOT_EDITABLE',
        message: `No se puede editar un pedido ${order.status}`,
      });
    }
    const data = purchaseOrderUpdateSchema.parse(input);
    if (data.contactId) await this.assertContactExists(data.contactId);

    await this.dbs.db.transaction(async (tx) => {
      await this.bloquearPedidos(tx, [id]);
      // Un aumento del importe de un pedido abierto compromete más coste.
      if (
        data.amount !== undefined &&
        ['emitido', 'servido_parcial', 'servido'].includes(order.status)
      ) {
        await this.control.verificar(tx, {
          projectId: order.projectId,
          importe: centsToNumeric(toCents(data.amount) - toCents(order.amount)),
          operacion: 'pedido_compra',
          referencia: order.orderNumber,
        });
      }
      const editados = await tx
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
          version: incrementarVersion(purchaseOrders),
        })
        .where(
          and(
            eq(purchaseOrders.id, id),
            condicionVersion(purchaseOrders, versionEsperada),
          ),
        )
        .returning({ id: purchaseOrders.id });
      if (editados.length === 0) {
        await falloActualizacion(
          tx,
          purchaseOrders,
          id,
          versionEsperada,
          () =>
            new ConflictException({
              code: 'VERSION_CONFLICT',
              message: 'El pedido ha cambiado: recarga',
            }),
          'Pedido no encontrado',
        );
      }
      const proveedorCambia =
        data.contactId !== undefined && data.contactId !== order.contactId;
      if (data.amount !== undefined || proveedorCambia) {
        await this.aprobaciones.invalidarSiProcede(tx, {
          operacion: 'pedido_compra',
          entidadId: id,
          importeNuevo: (data.amount ?? Number(order.amount)).toFixed(2),
          motivo: proveedorCambia
            ? 'Pedido modificado: cambio de proveedor'
            : 'Pedido modificado',
          forzar: proveedorCambia,
        });
      }
      await this.refreshStatus(id, tx);
    });
    return this.get(id);
  }

  /**
   * Cierre del pedido (etapa de liquidación: "ningún pedido queda sin
   * factura"). Se avisa de lo recibido sin facturar en lugar de cerrarlo en
   * silencio, porque ese importe es coste que se perdería.
   */
  async close(id: string, versionEsperada?: number): Promise<PurchaseOrderDto> {
    await this.find(id); // 404 / empresa
    await this.dbs.db.transaction(async (tx) => {
      // Bloqueo ANTES de leer el estado: cerrar y anular a la vez se
      // serializan y el segundo ve el estado ya cambiado.
      await this.bloquearPedidos(tx, [id]);
      const [order] = await tx
        .select()
        .from(purchaseOrders)
        .where(
          and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)),
        );
      if (!order)
        throw new NotFoundException({
          code: 'PURCHASE_ORDER_NOT_FOUND',
          message: 'Pedido no encontrado',
        });
      verificarVersion(order.version, versionEsperada);
      if (order.status === 'anulado') {
        throw new ConflictException({
          code: 'PURCHASE_ORDER_CANCELLED',
          message: 'El pedido está anulado',
        });
      }
      const delivered = (await this.deliveredByOrder([id], tx)).get(id);
      const pending = round2(
        (delivered?.deliveredAmount ?? 0) - (delivered?.invoicedAmount ?? 0),
      );
      if (pending > 0) {
        throw new ConflictException({
          code: 'PURCHASE_ORDER_NOT_CLOSABLE',
          message: `No se puede cerrar: quedan ${pending.toFixed(2)} € recibidos sin facturar. Regulariza la factura o anota la incidencia antes de cerrar.`,
        });
      }
      // Cerrar un pedido ya cerrado es una transición ilegal (409).
      await cambiarEstado(
        tx,
        purchaseOrders,
        'purchase_order',
        id,
        order.status as PurchaseOrderStatus,
        'cerrado',
        { closedAt: new Date() },
        versionEsperada,
      );
    });
    return this.get(id);
  }

  /**
   * CAMBIO DE COMPORTAMIENTO (máquina de estados): solo se anula desde
   * `emitido`. Un pedido cerrado ya no se puede anular (antes sí) porque
   * `cerrado` y `anulado` son terminales. Anular un pedido ya anulado sigue
   * siendo idempotente.
   */
  async cancel(
    id: string,
    versionEsperada?: number,
  ): Promise<PurchaseOrderDto> {
    await this.find(id); // 404 / empresa
    await this.dbs.db.transaction(async (tx) => {
      await this.bloquearPedidos(tx, [id]);
      const [order] = await tx
        .select()
        .from(purchaseOrders)
        .where(
          and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)),
        );
      if (!order)
        throw new NotFoundException({
          code: 'PURCHASE_ORDER_NOT_FOUND',
          message: 'Pedido no encontrado',
        });
      verificarVersion(order.version, versionEsperada);
      const delivered = (await this.deliveredByOrder([id], tx)).get(id);
      if ((delivered?.count ?? 0) > 0) {
        throw new ConflictException({
          code: 'PURCHASE_ORDER_HAS_DELIVERY_NOTES',
          message: 'No se puede anular un pedido con albaranes imputados',
        });
      }
      if (order.status === 'anulado') return;
      await cambiarEstado(
        tx,
        purchaseOrders,
        'purchase_order',
        id,
        order.status as PurchaseOrderStatus,
        'anulado',
        {},
        versionEsperada,
      );
    });
    return this.get(id);
  }

  async remove(id: string, versionEsperada?: number): Promise<void> {
    const previa = await this.find(id);
    verificarVersion(previa.version, versionEsperada);
    await this.dbs.db.transaction(async (tx) => {
      // Con el pedido bloqueado, un albarán que se imputa a la vez no se cuela
      // entre la comprobación y el borrado (el alta de albaranes lo bloquea).
      await this.bloquearPedidos(tx, [id]);
      const delivered = (await this.deliveredByOrder([id], tx)).get(id);
      if ((delivered?.count ?? 0) > 0) {
        throw new ConflictException({
          code: 'PURCHASE_ORDER_HAS_DELIVERY_NOTES',
          message: 'No se puede eliminar un pedido con albaranes imputados',
        });
      }
      await tx
        .update(purchaseOrders)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: incrementarVersion(purchaseOrders),
        })
        .where(
          and(
            eq(purchaseOrders.id, id),
            condicionVersion(purchaseOrders, versionEsperada),
          ),
        );
    });
  }

  /**
   * Bloquea los pedidos (`FOR UPDATE`) en orden ascendente de id. Orden de
   * bloqueo único en todo el módulo: pedido(s) -> albarán(es); así dos
   * operaciones concurrentes sobre el mismo pedido no se interbloquean.
   */
  async bloquearPedidos(
    tx: DbOrTx,
    ids: Array<string | null | undefined>,
  ): Promise<void> {
    const unicos = [...new Set(ids.filter((i): i is string => !!i))].sort();
    if (unicos.length === 0) return;
    // Una sola consulta; ORDER BY id fija el orden de bloqueo.
    await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, unicos))
      .orderBy(purchaseOrders.id)
      .for('update');
  }

  /**
   * Recalcula el estado del pedido a partir de sus albaranes VALIDADOS (un
   * albarán pendiente aún no cuenta como servido). Bloquea el pedido con
   * `FOR UPDATE` antes de leer la suma: debe llamarse dentro de una
   * transacción y, si hay albaranes bloqueados, después de bloquear el pedido.
   */
  async refreshStatus(id: string, tx: DbOrTx): Promise<void> {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .for('update');
    if (!order) return;

    const delivered = (await this.deliveredByOrder([id], tx)).get(id);
    const next = deriveOrderStatus(
      order.status as PurchaseOrderStatus,
      Number(order.amount),
      delivered?.receivedAmount ?? 0,
    );
    if (next !== order.status) {
      await cambiarEstado(
        tx,
        purchaseOrders,
        'purchase_order',
        id,
        order.status as PurchaseOrderStatus,
        next,
      );
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
          reading: traceabilityReading(base),
        };
      });

    const sum = (pick: (r: TraceabilityRowDto) => number) =>
      round2(rows.reduce((s, r) => s + pick(r), 0));

    const project = orders[0];
    return {
      projectId: projectId ?? null,
      projectCode: projectId ? (project?.projectCode ?? null) : null,
      rows,
      totalAccrual: sum((r) => r.accrualAmount),
      totalOrdered: sum((r) => r.amount),
      totalDelivered: sum((r) => r.deliveredAmount),
      totalInvoiced: sum((r) => r.invoicedAmount),
    };
  }

  /* ────────────────────────── privados ────────────────────────── */

  /** Suma de albaranes por pedido, en una sola consulta (sin N+1). */
  private async deliveredByOrder(
    orderIds: string[],
    executor: DbOrTx = this.dbs.db,
  ): Promise<Map<string, Delivered>> {
    const map = new Map<string, Delivered>();
    if (orderIds.length === 0) return map;

    const rows = await executor
      .select({
        orderId: deliveryNotes.orderId,
        delivered: sql<string>`coalesce(sum(${deliveryNotes.amount}), 0)`,
        received: sql<string>`coalesce(sum(${deliveryNotes.amount}) filter (where ${deliveryNotes.status} in ('validado', 'facturado')), 0)`,
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
        receivedAmount: round2(Number(r.received)),
        invoicedAmount: round2(Number(r.invoiced)),
        count: Number(r.count),
      });
    }
    // Lo facturado directamente contra las líneas del pedido (0067) también
    // es facturado: el pendiente de facturar y la provisión lo descuentan.
    const porLineas = await facturadoPorLineasDePedidos(executor, orderIds);
    for (const [orderId, importe] of porLineas) {
      const d = map.get(orderId) ?? {
        deliveredAmount: 0,
        receivedAmount: 0,
        invoicedAmount: 0,
        count: 0,
      };
      d.invoicedAmount = round2(d.invoicedAmount + Number(importe));
      map.set(orderId, d);
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
      version: order.version,
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
    const companyId = this.dbs.getCompanyId();
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
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException({
        code: 'PURCHASE_ORDER_NOT_FOUND',
        message: 'Pedido no encontrado',
      });
    return row;
  }

  private async find(id: string): Promise<PurchaseOrder> {
    const companyId = this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException({
        code: 'PURCHASE_ORDER_NOT_FOUND',
        message: 'Pedido no encontrado',
      });
    return row;
  }

  private async findProject(projectId: string) {
    const companyId = this.dbs.getCompanyId();
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

  private async assertContactExists(contactId: string): Promise<void> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ id: contacts.id })
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
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Proveedor no encontrado',
      });
  }
}
