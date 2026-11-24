import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, SQL } from 'drizzle-orm';
import {
  materialRequestLines,
  materialRequests,
  projects,
  purchaseOrders,
  stockArticles,
  stockItems,
  warehouses,
  type DbOrTx,
  type MaterialRequest,
  type Tx,
} from '@erp/db';
import {
  ErrorStock,
  cancelarSolicitudSchema,
  centsToNumeric,
  estadoSolicitudMaterial,
  faltanteLinea,
  fromCents,
  pedidoFaltanteSchema,
  planificarReserva,
  planificarServicio,
  scaledToNumeric,
  servirSolicitudSchema,
  solicitudMaterialCreateSchema,
  sumCents,
  toCents,
  toScaled,
  valorEntradaStock,
  type CancelarSolicitudInput,
  type EstadoSolicitudMaterial,
  type MovimientoStockDto,
  type PedidoFaltanteInput,
  type ServirSolicitudInput,
  type SolicitudMaterialCreateInput,
  type SolicitudMaterialDto,
  type SolicitudesMaterialQuery,
  type UnidadStock,
} from '@erp/shared';
import { NotificacionesService } from '../alerts/notificaciones.service';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { AlmacenService } from './almacen.service';

const ESTADOS_ABIERTOS: readonly EstadoSolicitudMaterial[] = [
  'abierta',
  'servida_parcial',
];

const noEncontrada = () =>
  new NotFoundException({
    code: 'MATERIAL_REQUEST_NOT_FOUND',
    message: 'Solicitud de material no encontrada',
  });

/** Cantidad (texto `numeric`) en milésimas. */
const mil = (v: string) => toScaled(v, 3);
const milTexto = (v: bigint) => scaledToNumeric(v, 3);

/** Traduce el rechazo de una regla pura de la solicitud a RFC 7807. */
function regla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorStock) {
      throw new UnprocessableEntityException({
        code: e.codigo,
        message: e.message,
        ...(e.disponible !== undefined && { pendiente: Number(e.disponible) }),
      });
    }
    throw e;
  }
}

/**
 * Solicitudes de material de obra (SAP MM reservation + purchase
 * requisition). Reservar actualiza `stock_items.reserved_quantity`, de modo
 * que el resto de consumos, traspasos y regularizaciones (que ya respetan lo
 * reservado) no pueden llevarse ese material. Servir reutiliza el consumo de
 * almacén (`AlmacenService.consumoEnTx`: PMP, asiento, control presupuestario
 * y kárdex) liberando primero la reserva. El faltante se convierte en pedido
 * de compra por `PurchaseOrdersService`, con su control presupuestario y sus
 * aprobaciones.
 */
@Injectable()
export class SolicitudesMaterialService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly almacen: AlmacenService,
    private readonly pedidos: PurchaseOrdersService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /* ───────────────────────────── lectura ───────────────────────────── */

  private async dtos(
    ex: DbOrTx,
    filtros: SQL[],
  ): Promise<SolicitudMaterialDto[]> {
    const cabeceras = await ex
      .select({
        r: materialRequests,
        projectCodigo: projects.code,
        almacenCodigo: warehouses.code,
      })
      .from(materialRequests)
      .innerJoin(projects, eq(projects.id, materialRequests.projectId))
      .innerJoin(warehouses, eq(warehouses.id, materialRequests.warehouseId))
      .where(and(...filtros))
      .orderBy(desc(materialRequests.createdAt))
      .limit(500);
    if (cabeceras.length === 0) return [];
    const lineas = await ex
      .select({
        l: materialRequestLines,
        codigo: stockArticles.code,
        nombre: stockArticles.name,
        unidad: stockArticles.unit,
        pedidoNumero: purchaseOrders.orderNumber,
      })
      .from(materialRequestLines)
      .innerJoin(
        stockArticles,
        eq(stockArticles.id, materialRequestLines.articleId),
      )
      .leftJoin(
        purchaseOrders,
        eq(purchaseOrders.id, materialRequestLines.purchaseOrderId),
      )
      .where(
        inArray(
          materialRequestLines.requestId,
          cabeceras.map((c) => c.r.id),
        ),
      )
      .orderBy(asc(stockArticles.code));
    return cabeceras.map(({ r, projectCodigo, almacenCodigo }) => {
      const propias = lineas
        .filter(({ l }) => l.requestId === r.id)
        .map(({ l, codigo, nombre, unidad, pedidoNumero }) => {
          const faltante = Number(
            faltanteLinea({
              solicitada: l.quantityRequested,
              servida: l.quantityServed,
              reservada: l.quantityReserved,
            }),
          );
          return {
            id: l.id,
            articuloId: l.articleId,
            articuloCodigo: codigo,
            articuloNombre: nombre,
            unidad: unidad as UnidadStock,
            solicitada: Number(l.quantityRequested),
            reservada: Number(l.quantityReserved),
            servida: Number(l.quantityServed),
            faltante,
            pedidoId: l.purchaseOrderId,
            pedidoNumero: pedidoNumero ?? null,
          };
        });
      const abierta = ESTADOS_ABIERTOS.includes(
        r.status as EstadoSolicitudMaterial,
      );
      return {
        id: r.id,
        numero: r.number,
        projectId: r.projectId,
        projectCodigo,
        almacenId: r.warehouseId,
        almacenCodigo,
        estado: r.status as EstadoSolicitudMaterial,
        fechaNecesidad: r.neededBy,
        notas: r.notes,
        motivoCancelacion: r.cancelReason,
        solicitadaPor: r.requestedBy,
        creadaEn: r.createdAt.toISOString(),
        lineas: propias,
        conFaltante:
          abierta && propias.some((l) => l.faltante > 0 && !l.pedidoId),
        version: r.version,
      };
    });
  }

  /** Filtro de empresa y de obras accesibles (rol obra). */
  private async filtroBase(): Promise<SQL[] | null> {
    const filtros: SQL[] = [
      eq(materialRequests.companyId, this.dbs.getCompanyId()),
    ];
    const obras = await this.dbs.getObrasAccesibles();
    if (obras !== null) {
      if (obras.length === 0) return null;
      filtros.push(inArray(materialRequests.projectId, obras));
    }
    return filtros;
  }

  async listar(q: SolicitudesMaterialQuery): Promise<SolicitudMaterialDto[]> {
    const filtros = await this.filtroBase();
    if (!filtros) return [];
    if (q.estado) filtros.push(eq(materialRequests.status, q.estado));
    if (q.projectId) filtros.push(eq(materialRequests.projectId, q.projectId));
    if (q.almacenId) {
      filtros.push(eq(materialRequests.warehouseId, q.almacenId));
    }
    const todas = await this.dtos(this.dbs.db, filtros);
    return q.conFaltante ? todas.filter((s) => s.conFaltante) : todas;
  }

  async detalle(id: string): Promise<SolicitudMaterialDto> {
    const filtros = await this.filtroBase();
    if (!filtros) throw noEncontrada();
    const [s] = await this.dtos(this.dbs.db, [
      ...filtros,
      eq(materialRequests.id, id),
    ]);
    if (!s) throw noEncontrada();
    return s;
  }

  /** Cabecera bloqueada, de la empresa y accesible, en estado abierto. */
  private async bloquear(
    tx: Tx,
    id: string,
    version: number | undefined,
  ): Promise<MaterialRequest> {
    const filtros = await this.filtroBase();
    if (!filtros) throw noEncontrada();
    const [r] = await tx
      .select()
      .from(materialRequests)
      .where(and(...filtros, eq(materialRequests.id, id)))
      .for('update');
    if (!r) throw noEncontrada();
    verificarVersion(r.version, version);
    if (!ESTADOS_ABIERTOS.includes(r.status as EstadoSolicitudMaterial)) {
      throw new ConflictException({
        code: 'MATERIAL_REQUEST_CLOSED',
        message: `La solicitud ${r.number} está ${r.status}`,
      });
    }
    return r;
  }

  private async lineasBloqueadas(tx: Tx, requestId: string) {
    return tx
      .select()
      .from(materialRequestLines)
      .where(eq(materialRequestLines.requestId, requestId))
      .orderBy(asc(materialRequestLines.articleId))
      .for('update');
  }

  /** Suma `delta` (milésimas, con signo) a la reserva de un saldo bloqueado. */
  private async ajustarReserva(
    tx: Tx,
    item: typeof stockItems.$inferSelect,
    delta: bigint,
  ) {
    if (delta === 0n) return;
    await tx
      .update(stockItems)
      .set({
        reservedQuantity: milTexto(mil(item.reservedQuantity) + delta),
        version: item.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(stockItems.id, item.id));
  }

  /* ───────────────────────────── alta ───────────────────────────── */

  async crear(input: SolicitudMaterialCreateInput) {
    const d = solicitudMaterialCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const id = await this.dbs.db.transaction(async (tx) => {
      const w = await this.almacen.cargarAlmacen(tx, companyId, d.almacenId);
      const obra = await this.almacen.validarObra(tx, companyId, d.projectId);
      this.almacen.exigirAcopioDeLaObra(w, obra.id);
      // Numeración correlativa por empresa, serializada.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`solicitud-material:${companyId}`}))`,
      );
      const [{ ultimo }] = await tx
        .select({
          ultimo: sql<number>`coalesce(max(${materialRequests.seq}), 0)::int`,
        })
        .from(materialRequests)
        .where(eq(materialRequests.companyId, companyId));
      const seq = Number(ultimo) + 1;
      const [r] = await tx
        .insert(materialRequests)
        .values({
          companyId,
          seq,
          number: `SM-${String(seq).padStart(6, '0')}`,
          projectId: obra.id,
          warehouseId: w.id,
          neededBy: d.fechaNecesidad ?? null,
          notes: d.notas ?? null,
          requestedBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      let faltante = 0n;
      const lineas = [...d.lineas].sort((a, b) =>
        a.articuloId.localeCompare(b.articuloId),
      );
      const creadas = [];
      for (const l of lineas) {
        const art = await this.almacen.cargarArticulo(
          tx,
          companyId,
          l.articuloId,
        );
        const item = await this.almacen.bloquearSaldo(
          tx,
          companyId,
          w.id,
          art.id,
        );
        const solicitada = l.cantidad.toFixed(3);
        const plan = planificarReserva({
          solicitada,
          servida: 0,
          reservada: 0,
          disponible: milTexto(mil(item.quantity) - mil(item.reservedQuantity)),
        });
        await this.ajustarReserva(tx, item, mil(plan.reservar));
        faltante += mil(plan.faltante);
        const [linea] = await tx
          .insert(materialRequestLines)
          .values({
            companyId,
            requestId: r.id,
            articleId: art.id,
            quantityRequested: solicitada,
            quantityReserved: plan.reservar,
          })
          .returning();
        creadas.push(linea);
      }
      await this.audit.registrar(tx, {
        entityType: 'material_request',
        entityId: r.id,
        action: 'create',
        newData: { ...r, lineas: creadas },
      });
      if (faltante > 0n) {
        await this.notificaciones.notificar(tx, {
          companyId,
          tipo: 'almacen',
          titulo: `Faltante de material: ${r.number} · obra ${obra.code}`,
          cuerpo: `No hay stock suficiente en ${w.code} para toda la solicitud: queda material por comprar`,
          enlace: '/almacen/solicitudes',
          clave: `almacen:faltante:${r.id}`,
        });
      }
      return r.id;
    });
    return this.detalle(id);
  }

  /* ─────────────────────────── re-reservar ─────────────────────────── */

  /** Intenta reservar el faltante con el stock libre actual (p. ej. tras una entrada). */
  async reservar(id: string, version: number | undefined) {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.bloquear(tx, id, version);
      const lineas = await this.lineasBloqueadas(tx, id);
      const cambios: { lineaId: string; reservado: string }[] = [];
      for (const l of lineas) {
        const item = await this.almacen.bloquearSaldo(
          tx,
          companyId,
          r.warehouseId,
          l.articleId,
        );
        const plan = planificarReserva({
          solicitada: l.quantityRequested,
          servida: l.quantityServed,
          reservada: l.quantityReserved,
          disponible: milTexto(mil(item.quantity) - mil(item.reservedQuantity)),
        });
        if (mil(plan.reservar) === 0n) continue;
        await this.ajustarReserva(tx, item, mil(plan.reservar));
        await tx
          .update(materialRequestLines)
          .set({
            quantityReserved: milTexto(
              mil(l.quantityReserved) + mil(plan.reservar),
            ),
          })
          .where(eq(materialRequestLines.id, l.id));
        cambios.push({ lineaId: l.id, reservado: plan.reservar });
      }
      await tx
        .update(materialRequests)
        .set({ version: r.version + 1, updatedAt: new Date() })
        .where(eq(materialRequests.id, id));
      await this.audit.registrar(tx, {
        entityType: 'material_request',
        entityId: id,
        action: 'update',
        newData: { accion: 'reservar', cambios },
      });
    });
    return this.detalle(id);
  }

  /* ───────────────────────────── servir ───────────────────────────── */

  /**
   * Consume a la obra lo indicado (por defecto, todo lo reservado),
   * liberando primero la reserva. Mismo consumo que el de almacén: PMP,
   * asiento 6100 (obra) a 3000 y control presupuestario de la obra.
   */
  async servir(
    id: string,
    input: ServirSolicitudInput,
    version: number | undefined,
  ): Promise<{
    solicitud: SolicitudMaterialDto;
    movimientos: MovimientoStockDto[];
  }> {
    const d = servirSolicitudSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const ids = await this.dbs.db.transaction(async (tx) => {
      const r = await this.bloquear(tx, id, version);
      const lineas = await this.lineasBloqueadas(tx, id);
      const pedidas = new Map(
        (d.lineas ?? []).map((l) => [l.lineaId, l.cantidad.toFixed(3)]),
      );
      for (const lineaId of pedidas.keys()) {
        if (!lineas.some((l) => l.id === lineaId)) {
          throw new UnprocessableEntityException({
            code: 'MATERIAL_REQUEST_LINE_NOT_FOUND',
            message: 'Una de las líneas no pertenece a la solicitud',
          });
        }
      }
      const planes = lineas
        .map((l) => {
          const cantidad = d.lineas
            ? pedidas.get(l.id)
            : mil(l.quantityReserved) > 0n
              ? l.quantityReserved
              : undefined;
          if (!cantidad) return null;
          const plan = regla(() =>
            planificarServicio({
              solicitada: l.quantityRequested,
              servida: l.quantityServed,
              reservada: l.quantityReserved,
              cantidad,
            }),
          );
          return { l, cantidad, plan };
        })
        .filter((x) => x !== null);
      if (planes.length === 0) {
        throw new UnprocessableEntityException({
          code: 'MATERIAL_REQUEST_NOTHING_TO_SERVE',
          message:
            'No hay nada reservado que servir: indica las cantidades o reserva antes',
        });
      }
      // El consumo va primero: no se escribe en audit_log antes de él (su
      // control presupuestario puede auditar un bloqueo aparte).
      const movimientos = await this.almacen.consumoEnTx(tx, companyId, {
        almacenId: r.warehouseId,
        projectId: r.projectId,
        fecha: d.fecha,
        notas: d.notas ?? `Servicio de la solicitud ${r.number}`,
        lineas: planes.map(({ l, cantidad }) => ({
          articuloId: l.articleId,
          cantidad,
        })),
        liberar: new Map(
          planes.map(({ l, plan }) => [l.articleId, plan.liberar]),
        ),
      });
      for (const { l, plan } of planes) {
        await tx
          .update(materialRequestLines)
          .set({
            quantityServed: plan.servidaTras,
            quantityReserved: plan.reservadaTras,
          })
          .where(eq(materialRequestLines.id, l.id));
      }
      const servidas = new Map(
        planes.map(({ l, plan }) => [l.id, plan.servidaTras]),
      );
      const nuevo = estadoSolicitudMaterial(
        r.status as EstadoSolicitudMaterial,
        lineas.map((l) => ({
          solicitada: l.quantityRequested,
          servida: servidas.get(l.id) ?? l.quantityServed,
        })),
      );
      if (nuevo !== r.status) {
        await cambiarEstado(
          tx,
          materialRequests,
          'material_request',
          id,
          r.status as EstadoSolicitudMaterial,
          nuevo,
        );
      } else {
        await tx
          .update(materialRequests)
          .set({ version: r.version + 1, updatedAt: new Date() })
          .where(eq(materialRequests.id, id));
      }
      await this.audit.registrar(tx, {
        entityType: 'material_request',
        entityId: id,
        action: 'update',
        oldData: { status: r.status },
        newData: {
          accion: 'servir',
          status: nuevo,
          lineas: planes.map(({ l, cantidad }) => ({
            lineaId: l.id,
            cantidad,
          })),
          movimientos,
        },
      });
      return movimientos;
    });
    return {
      solicitud: await this.detalle(id),
      movimientos: await this.almacen.movimientosPorIds(ids),
    };
  }

  /* ──────────────────────────── cancelar ──────────────────────────── */

  async cancelar(
    id: string,
    input: CancelarSolicitudInput,
    version: number | undefined,
  ) {
    const { motivo } = cancelarSolicitudSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.bloquear(tx, id, version);
      const lineas = await this.lineasBloqueadas(tx, id);
      let liberado = 0n;
      for (const l of lineas) {
        const reservada = mil(l.quantityReserved);
        if (reservada === 0n) continue;
        const item = await this.almacen.bloquearSaldo(
          tx,
          companyId,
          r.warehouseId,
          l.articleId,
        );
        await this.ajustarReserva(tx, item, -reservada);
        await tx
          .update(materialRequestLines)
          .set({ quantityReserved: '0' })
          .where(eq(materialRequestLines.id, l.id));
        liberado += reservada;
      }
      await cambiarEstado(
        tx,
        materialRequests,
        'material_request',
        id,
        r.status as EstadoSolicitudMaterial,
        'cancelada',
        { cancelReason: motivo },
      );
      await this.audit.registrar(tx, {
        entityType: 'material_request',
        entityId: id,
        action: 'update',
        oldData: { status: r.status },
        newData: { status: 'cancelada', motivo, liberado: milTexto(liberado) },
      });
    });
    return this.detalle(id);
  }

  /* ───────────────────────── pedido del faltante ───────────────────────── */

  /**
   * Convierte el faltante de las líneas indicadas en un pedido de compra a un
   * proveedor (importe = faltante × coste unitario, exacto al céntimo). El
   * pedido pasa por el control presupuestario y las aprobaciones de compras.
   */
  async pedidoFaltante(id: string, input: PedidoFaltanteInput) {
    const d = pedidoFaltanteSchema.parse(input);
    const s = await this.detalle(id);
    if (!ESTADOS_ABIERTOS.includes(s.estado)) {
      throw new ConflictException({
        code: 'MATERIAL_REQUEST_CLOSED',
        message: `La solicitud ${s.numero} está ${s.estado}`,
      });
    }
    const valores: bigint[] = [];
    const lineas = d.lineas.map((p) => {
      const l = s.lineas.find((x) => x.id === p.lineaId);
      if (!l) {
        throw new UnprocessableEntityException({
          code: 'MATERIAL_REQUEST_LINE_NOT_FOUND',
          message: 'Una de las líneas no pertenece a la solicitud',
        });
      }
      if (l.pedidoId) {
        throw new ConflictException({
          code: 'MATERIAL_REQUEST_LINE_ORDERED',
          message: `El faltante de ${l.articuloCodigo} ya tiene el pedido ${l.pedidoNumero}`,
        });
      }
      if (l.faltante <= 0) {
        throw new UnprocessableEntityException({
          code: 'MATERIAL_REQUEST_NO_SHORTFALL',
          message: `${l.articuloCodigo} no tiene faltante`,
        });
      }
      valores.push(toCents(valorEntradaStock(l.faltante, p.costeUnitario)));
      return l;
    });
    const pedido = await this.pedidos.create({
      projectId: s.projectId,
      contactId: d.contactId,
      orderDate: d.fecha,
      description: `Faltante de ${s.numero}: ${lineas
        .map((l) => `${l.faltante} ${l.unidad} ${l.articuloCodigo}`)
        .join(', ')}`.slice(0, 500),
      amount: fromCents(sumCents(valores)),
    });
    await this.dbs.db.transaction(async (tx) => {
      // Si otra petición ya ligó alguna línea, no se pisa.
      const ligadas = await tx
        .update(materialRequestLines)
        .set({ purchaseOrderId: pedido.id })
        .where(
          and(
            inArray(
              materialRequestLines.id,
              lineas.map((l) => l.id),
            ),
            sql`${materialRequestLines.purchaseOrderId} is null`,
          ),
        )
        .returning({ id: materialRequestLines.id });
      await this.audit.registrar(tx, {
        entityType: 'material_request',
        entityId: id,
        action: 'update',
        newData: {
          accion: 'pedido_faltante',
          pedidoId: pedido.id,
          pedido: pedido.orderNumber,
          importe: centsToNumeric(sumCents(valores)),
          lineas: ligadas.map((l) => l.id),
        },
      });
    });
    return { solicitud: await this.detalle(id), pedido };
  }
}
