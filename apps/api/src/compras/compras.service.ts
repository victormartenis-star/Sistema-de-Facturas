import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  contacts,
  deliveryNotes,
  goodsReceiptLines,
  goodsReceipts,
  invoiceLines,
  invoices,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequisitionLines,
  purchaseRequisitions,
  purchaseRfqLines,
  purchaseRfqQuotes,
  purchaseRfqSuppliers,
  purchaseRfqs,
  stockArticles,
  type DbOrTx,
  type PurchaseOrder,
  type PurchaseRequisition,
  type PurchaseRfq,
  type Tx,
} from '@erp/db';
import {
  ErrorCompras,
  adjudicarPeticionSchema,
  centsToNumeric,
  comparativaOfertas,
  convertirEnPedidoSchema,
  convertirEnPeticionSchema,
  diferenciasAuditoria,
  estadoLineaPedido,
  facturaPedidoCreateSchema,
  fromCents,
  importeLinea,
  ofertaRegistrarSchema,
  pedidoLineasCreateSchema,
  recepcionCreateSchema,
  rechazoSchema,
  solicitudCompraCreateSchema,
  sumCents,
  todayIso,
  toCents,
  validarLineasCompra,
  validarRecepcionLinea,
  type AdjudicarPeticionInput,
  type ConvertirEnPedidoInput,
  type ConvertirEnPeticionInput,
  type CuadreFacturaDto,
  type EstadoPeticionOferta,
  type EstadoSolicitudCompra,
  type FacturaPedidoCreateInput,
  type InvoiceDto,
  type OfertaRegistrarInput,
  type PedidoCompraDetalleDto,
  type PedidoLineasCreateInput,
  type PeticionOfertaDto,
  type RecepcionCreateInput,
  type RechazoInput,
  type SolicitudCompraCreateInput,
  type SolicitudCompraDto,
  type SolicitudesCompraQuery,
  type TipoLineaCompra,
} from '@erp/shared';
import { AlmacenService } from '../almacen/almacen.service';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { usuarioPersistible } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { cantidadesPorLinea, cuadreDeFactura } from './cuadre';

/** Traduce el rechazo de una regla pura de compras a RFC 7807 (422). */
function regla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorCompras) {
      throw new UnprocessableEntityException({
        code: e.codigo,
        message: e.message,
      });
    }
    throw e;
  }
}

const noEncontrada = (code: string, message: string) =>
  new NotFoundException({ code, message });

/** Material con recepción; servicio, subcontrata y gasto se facturan contra el pedido. */
const exigeRecepcionPorDefecto = (tipo: TipoLineaCompra) => tipo === 'material';

const numero = (prefijo: string, obra: string, seq: number) =>
  `${prefijo}-${obra}-${String(seq).padStart(4, '0')}`;

/**
 * Procure-to-Pay: solicitud de compra (PR) → petición de ofertas (RFQ) →
 * pedido con líneas (PO) → recepción (GR) → factura con cuadre por línea.
 *  - El jefe de obra crea solicitudes y registra recepciones (en sus obras).
 *  - Aprobar (con segregación: quien solicita no aprueba), pedir ofertas,
 *    adjudicar, emitir pedidos y verificar facturas: admin, gerente y
 *    administración.
 *  - La recepción registra el albarán validado del proveedor y, para el
 *    material de stock, su entrada en almacén con lotes o series.
 */
@Injectable()
export class ComprasService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly pedidos: PurchaseOrdersService,
    private readonly almacen: AlmacenService,
    private readonly facturas: InvoicesService,
  ) {}

  /* ───────────────────────────── acceso ───────────────────────────── */

  private async obra(ex: DbOrTx, projectId: string) {
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null && !accesibles.includes(projectId)) {
      throw noEncontrada('PROJECT_NOT_FOUND', 'Obra no encontrada');
    }
    const [p] = await ex
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, this.dbs.getCompanyId()),
          isNull(projects.deletedAt),
        ),
      );
    if (!p) throw noEncontrada('PROJECT_NOT_FOUND', 'Obra no encontrada');
    return p;
  }

  private async filtroObras(
    col: Parameters<typeof inArray>[0],
  ): Promise<SQL | null | undefined> {
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles === null) return undefined;
    if (accesibles.length === 0) return null;
    return inArray(col, accesibles);
  }

  private async validarArticulos(
    ex: DbOrTx,
    ids: (string | null | undefined)[],
  ) {
    const unicos = [...new Set(ids.filter((x): x is string => !!x))];
    if (unicos.length === 0) return;
    const filas = await ex
      .select({ id: stockArticles.id })
      .from(stockArticles)
      .where(
        and(
          inArray(stockArticles.id, unicos),
          eq(stockArticles.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (filas.length !== unicos.length) {
      throw new UnprocessableEntityException({
        code: 'STOCK_ARTICLE_NOT_FOUND',
        message: 'Algún artículo de almacén no existe',
      });
    }
  }

  private async validarProveedores(ex: DbOrTx, ids: string[]) {
    const unicos = [...new Set(ids)];
    const filas = await ex
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, unicos),
          eq(contacts.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (filas.length !== unicos.length) {
      throw new UnprocessableEntityException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Algún proveedor no existe',
      });
    }
  }

  /** Siguiente correlativo por obra (serializado por un bloqueo consultivo). */
  private async siguiente(
    tx: Tx,
    tabla: typeof purchaseRequisitions | typeof purchaseRfqs,
    projectId: string,
  ): Promise<number> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`p2p:${tabla === purchaseRequisitions ? 'sc' : 'pet'}:${projectId}`}))`,
    );
    const [u] = await tx
      .select({ seq: sql<number>`coalesce(max(${tabla.seq}), 0)` })
      .from(tabla)
      .where(eq(tabla.projectId, projectId));
    return Number(u?.seq ?? 0) + 1;
  }

  /* ─────────────────────── solicitudes de compra ─────────────────────── */

  private async solicitudDto(
    ex: DbOrTx,
    r: PurchaseRequisition,
  ): Promise<SolicitudCompraDto> {
    const [p] = await ex
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, r.projectId));
    const lineas = await ex
      .select()
      .from(purchaseRequisitionLines)
      .where(eq(purchaseRequisitionLines.requisitionId, r.id))
      .orderBy(asc(purchaseRequisitionLines.lineNo));
    const [po] = await ex
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.requisitionId, r.id),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const [rfq] = await ex
      .select({ id: purchaseRfqs.id })
      .from(purchaseRfqs)
      .where(eq(purchaseRfqs.requisitionId, r.id))
      .limit(1);
    return {
      id: r.id,
      numero: r.number,
      projectId: r.projectId,
      projectCode: p?.code ?? '',
      titulo: r.title,
      estado: r.status as EstadoSolicitudCompra,
      necesariaEl: r.neededBy,
      solicitanteId: r.requestedBy,
      aprobadorId: r.approvedBy,
      aprobadaEn: r.approvedAt?.toISOString() ?? null,
      motivoRechazo: r.rejectionReason,
      importeEstimado: fromCents(
        sumCents(
          lineas.map((l) =>
            l.estimatedUnitPrice
              ? importeLinea(l.quantity, l.estimatedUnitPrice)
              : 0n,
          ),
        ),
      ),
      notas: r.notes,
      lineas: lineas.map((l) => ({
        id: l.id,
        tipo: l.kind as TipoLineaCompra,
        articuloId: l.articleId,
        descripcion: l.description,
        unidad: l.unit,
        cantidad: Number(l.quantity),
        precioEstimado:
          l.estimatedUnitPrice === null ? null : Number(l.estimatedUnitPrice),
        phaseId: l.phaseId,
      })),
      pedidoId: po?.id ?? null,
      peticionId: rfq?.id ?? null,
      version: r.version,
      creadaEn: r.createdAt.toISOString(),
    };
  }

  private async cargarSolicitud(ex: DbOrTx, id: string, bloquear = false) {
    const q = ex
      .select()
      .from(purchaseRequisitions)
      .where(
        and(
          eq(purchaseRequisitions.id, id),
          eq(purchaseRequisitions.companyId, this.dbs.getCompanyId()),
        ),
      );
    const [r] = bloquear ? await q.for('update') : await q;
    if (!r)
      throw noEncontrada(
        'P2P_REQUISITION_NOT_FOUND',
        'Solicitud de compra no encontrada',
      );
    await this.obra(ex, r.projectId);
    return r;
  }

  async solicitudes(q: SolicitudesCompraQuery): Promise<SolicitudCompraDto[]> {
    const filtro = await this.filtroObras(purchaseRequisitions.projectId);
    if (filtro === null) return [];
    const f: (SQL | undefined)[] = [
      eq(purchaseRequisitions.companyId, this.dbs.getCompanyId()),
      filtro,
    ];
    if (q.projectId) f.push(eq(purchaseRequisitions.projectId, q.projectId));
    if (q.estado) f.push(eq(purchaseRequisitions.status, q.estado));
    const filas = await this.dbs.db
      .select()
      .from(purchaseRequisitions)
      .where(and(...f))
      .orderBy(desc(purchaseRequisitions.createdAt))
      .limit(200);
    const out: SolicitudCompraDto[] = [];
    for (const r of filas) out.push(await this.solicitudDto(this.dbs.db, r));
    return out;
  }

  async solicitud(id: string): Promise<SolicitudCompraDto> {
    return this.solicitudDto(
      this.dbs.db,
      await this.cargarSolicitud(this.dbs.db, id),
    );
  }

  async crearSolicitud(
    input: SolicitudCompraCreateInput,
  ): Promise<SolicitudCompraDto> {
    const d = solicitudCompraCreateSchema.parse(input);
    regla(() =>
      validarLineasCompra(
        d.lineas.map((l) => ({
          ...l,
          precioUnitario: l.precioEstimado ?? null,
        })),
      ),
    );
    const companyId = this.dbs.getCompanyId();
    const id = await this.dbs.db.transaction(async (tx) => {
      const p = await this.obra(tx, d.projectId);
      await this.validarArticulos(
        tx,
        d.lineas.map((l) => l.articuloId),
      );
      const seq = await this.siguiente(tx, purchaseRequisitions, p.id);
      const [r] = await tx
        .insert(purchaseRequisitions)
        .values({
          companyId,
          projectId: p.id,
          seq,
          number: numero('SC', p.code, seq),
          title: d.titulo,
          status: d.enviar ? 'solicitada' : 'borrador',
          neededBy: d.necesariaEl ?? null,
          requestedBy: usuarioPersistible(),
          notes: d.notas ?? null,
        })
        .returning();
      await tx.insert(purchaseRequisitionLines).values(
        d.lineas.map((l, i) => ({
          companyId,
          requisitionId: r.id,
          lineNo: i + 1,
          kind: l.tipo,
          articleId: l.articuloId ?? null,
          description: l.descripcion,
          unit: l.unidad,
          quantity: l.cantidad.toFixed(3),
          estimatedUnitPrice:
            l.precioEstimado == null ? null : l.precioEstimado.toFixed(4),
          phaseId: l.phaseId ?? null,
        })),
      );
      await this.audit.registrar(tx, {
        entityType: 'purchase_requisition',
        entityId: r.id,
        action: 'create',
        newData: { ...r, lineas: d.lineas },
      });
      return r.id;
    });
    return this.solicitud(id);
  }

  private async transitarSolicitud(
    id: string,
    version: number | undefined,
    de: EstadoSolicitudCompra,
    a: EstadoSolicitudCompra,
    extra: Record<string, unknown> = {},
    comprobar?: (r: PurchaseRequisition) => void,
  ): Promise<SolicitudCompraDto> {
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.cargarSolicitud(tx, id, true);
      verificarVersion(r.version, version);
      if (r.status !== de) {
        throw new ConflictException({
          code: 'TRANSICION_INVALIDA',
          message: `La solicitud ${r.number} está ${r.status}: no puede pasar a ${a}`,
        });
      }
      comprobar?.(r);
      await cambiarEstado(
        tx,
        purchaseRequisitions,
        'purchase_requisition',
        id,
        de,
        a,
        extra,
        r.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'purchase_requisition',
        entityId: id,
        action: 'update',
        oldData: { status: de },
        newData: { status: a, ...extra },
      });
    });
    return this.solicitud(id);
  }

  enviarSolicitud(id: string, version: number | undefined) {
    return this.transitarSolicitud(id, version, 'borrador', 'solicitada');
  }

  /** Aprobación con segregación de funciones: quien solicita no aprueba. */
  aprobarSolicitud(id: string, version: number | undefined) {
    const usuario = usuarioPersistible();
    return this.transitarSolicitud(
      id,
      version,
      'solicitada',
      'aprobada',
      { approvedBy: usuario, approvedAt: new Date() },
      (r) => {
        if (usuario && r.requestedBy === usuario) {
          throw new ForbiddenException({
            code: 'P2P_SOD_SELF_APPROVAL',
            message:
              'Quien solicita la compra no puede aprobarla (segregación de funciones)',
          });
        }
      },
    );
  }

  rechazarSolicitud(
    id: string,
    input: RechazoInput,
    version: number | undefined,
  ) {
    const { motivo } = rechazoSchema.parse(input);
    return this.transitarSolicitud(id, version, 'solicitada', 'rechazada', {
      rejectionReason: motivo,
    });
  }

  /** Solicitud aprobada → pedido directo al proveedor (precios indicados o estimados). */
  async convertirEnPedido(
    id: string,
    input: ConvertirEnPedidoInput,
    version: number | undefined,
  ): Promise<PedidoCompraDetalleDto> {
    const d = convertirEnPedidoSchema.parse(input);
    const pedidoId = await this.dbs.db.transaction(async (tx) => {
      const r = await this.exigirAprobada(tx, id, version);
      const lineas = await tx
        .select()
        .from(purchaseRequisitionLines)
        .where(eq(purchaseRequisitionLines.requisitionId, r.id))
        .orderBy(asc(purchaseRequisitionLines.lineNo));
      const precios = new Map(
        (d.precios ?? []).map((p) => [p.lineaId, p.precioUnitario]),
      );
      const conPrecio = lineas.map((l) => {
        const precio =
          precios.get(l.id) ??
          (l.estimatedUnitPrice === null ? null : Number(l.estimatedUnitPrice));
        if (precio === null) {
          throw new UnprocessableEntityException({
            code: 'P2P_LINE_INVALID',
            message: `Línea ${l.lineNo}: indica el precio unitario (no hay estimado)`,
          });
        }
        return { l, precio };
      });
      const po = await this.crearPedidoEnTx(tx, {
        projectId: r.projectId,
        contactId: d.contactId,
        fecha: d.fecha,
        descripcion: `${r.number} · ${r.title}`,
        entregaPrevista: d.entregaPrevista ?? null,
        requisitionId: r.id,
        lineas: conPrecio.map(({ l, precio }) => ({
          tipo: l.kind as TipoLineaCompra,
          articuloId: l.articleId,
          descripcion: l.description,
          unidad: l.unit,
          cantidad: l.quantity,
          precioUnitario: precio,
          phaseId: l.phaseId,
          requisitionLineId: l.id,
        })),
      });
      await this.cerrarSolicitud(tx, r, { pedidoId: po.id });
      return po.id;
    });
    return this.pedido(pedidoId);
  }

  /** Solicitud aprobada → petición de ofertas a varios proveedores. */
  async convertirEnPeticion(
    id: string,
    input: ConvertirEnPeticionInput,
    version: number | undefined,
  ): Promise<PeticionOfertaDto> {
    const d = convertirEnPeticionSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const rfqId = await this.dbs.db.transaction(async (tx) => {
      const r = await this.exigirAprobada(tx, id, version);
      await this.validarProveedores(tx, d.proveedores);
      const p = await this.obra(tx, r.projectId);
      const seq = await this.siguiente(tx, purchaseRfqs, p.id);
      const [rfq] = await tx
        .insert(purchaseRfqs)
        .values({
          companyId,
          projectId: r.projectId,
          requisitionId: r.id,
          seq,
          number: numero('PET', p.code, seq),
          title: r.title,
          deadline: d.fechaLimite ?? null,
          createdBy: usuarioPersistible(),
        })
        .returning();
      const lineas = await tx
        .select()
        .from(purchaseRequisitionLines)
        .where(eq(purchaseRequisitionLines.requisitionId, r.id))
        .orderBy(asc(purchaseRequisitionLines.lineNo));
      await tx.insert(purchaseRfqLines).values(
        lineas.map((l) => ({
          companyId,
          rfqId: rfq.id,
          requisitionLineId: l.id,
          lineNo: l.lineNo,
          kind: l.kind,
          articleId: l.articleId,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          phaseId: l.phaseId,
        })),
      );
      await tx.insert(purchaseRfqSuppliers).values(
        [...new Set(d.proveedores)].map((contactId) => ({
          companyId,
          rfqId: rfq.id,
          contactId,
        })),
      );
      await this.audit.registrar(tx, {
        entityType: 'purchase_rfq',
        entityId: rfq.id,
        action: 'create',
        newData: { ...rfq, proveedores: d.proveedores },
      });
      await this.cerrarSolicitud(tx, r, { peticionId: rfq.id });
      return rfq.id;
    });
    return this.peticion(rfqId);
  }

  private async exigirAprobada(
    tx: Tx,
    id: string,
    version: number | undefined,
  ) {
    const r = await this.cargarSolicitud(tx, id, true);
    verificarVersion(r.version, version);
    if (r.status !== 'aprobada') {
      throw new ConflictException({
        code: 'P2P_REQUISITION_NOT_APPROVED',
        message: `La solicitud ${r.number} está ${r.status}: solo se convierte una solicitud aprobada`,
      });
    }
    return r;
  }

  private async cerrarSolicitud(
    tx: Tx,
    r: PurchaseRequisition,
    destino: Record<string, string>,
  ) {
    await cambiarEstado(
      tx,
      purchaseRequisitions,
      'purchase_requisition',
      r.id,
      'aprobada',
      'convertida',
      {},
      r.version,
    );
    await this.audit.registrar(tx, {
      entityType: 'purchase_requisition',
      entityId: r.id,
      action: 'update',
      oldData: { status: 'aprobada' },
      newData: { status: 'convertida', ...destino },
    });
  }

  /* ─────────────────────── peticiones de ofertas ─────────────────────── */

  private async cargarPeticion(
    ex: DbOrTx,
    id: string,
    bloquear = false,
  ): Promise<PurchaseRfq> {
    const q = ex
      .select()
      .from(purchaseRfqs)
      .where(
        and(
          eq(purchaseRfqs.id, id),
          eq(purchaseRfqs.companyId, this.dbs.getCompanyId()),
        ),
      );
    const [r] = bloquear ? await q.for('update') : await q;
    if (!r)
      throw noEncontrada(
        'P2P_RFQ_NOT_FOUND',
        'Petición de ofertas no encontrada',
      );
    await this.obra(ex, r.projectId);
    return r;
  }

  private async peticionDto(
    ex: DbOrTx,
    r: PurchaseRfq,
  ): Promise<PeticionOfertaDto> {
    const lineas = await ex
      .select()
      .from(purchaseRfqLines)
      .where(eq(purchaseRfqLines.rfqId, r.id))
      .orderBy(asc(purchaseRfqLines.lineNo));
    const proveedores = await ex
      .select({ s: purchaseRfqSuppliers, nombre: contacts.legalName })
      .from(purchaseRfqSuppliers)
      .innerJoin(contacts, eq(contacts.id, purchaseRfqSuppliers.contactId))
      .where(eq(purchaseRfqSuppliers.rfqId, r.id))
      .orderBy(asc(contacts.legalName));
    const ofertas = lineas.length
      ? await ex
          .select()
          .from(purchaseRfqQuotes)
          .where(
            inArray(
              purchaseRfqQuotes.rfqLineId,
              lineas.map((l) => l.id),
            ),
          )
      : [];
    const pedidos = await ex
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.rfqId, r.id), isNull(purchaseOrders.deletedAt)),
      );
    return {
      id: r.id,
      numero: r.number,
      projectId: r.projectId,
      solicitudId: r.requisitionId,
      titulo: r.title,
      estado: r.status as EstadoPeticionOferta,
      fechaLimite: r.deadline,
      lineas: lineas.map((l) => ({
        id: l.id,
        tipo: l.kind as TipoLineaCompra,
        articuloId: l.articleId,
        descripcion: l.description,
        unidad: l.unit,
        cantidad: Number(l.quantity),
        phaseId: l.phaseId,
      })),
      proveedores: proveedores.map(({ s, nombre }) => ({
        contactId: s.contactId,
        contactName: nombre,
        ofertada: s.quotedAt !== null,
        plazoDias: s.leadTimeDays,
        validaHasta: s.validUntil,
        condiciones: s.terms,
      })),
      comparativa: comparativaOfertas({
        fecha: todayIso(),
        lineas: lineas.map((l) => ({
          id: l.id,
          descripcion: l.description,
          cantidad: l.quantity,
        })),
        proveedores: proveedores.map(({ s, nombre }) => ({
          contactId: s.contactId,
          contactName: nombre,
          plazoDias: s.leadTimeDays,
          validaHasta: s.validUntil,
          precios: ofertas
            .filter((o) => o.contactId === s.contactId)
            .map((o) => ({
              lineaId: o.rfqLineId,
              precioUnitario: o.unitPrice,
            })),
        })),
      }),
      pedidos: pedidos.map((p) => p.id),
      version: r.version,
    };
  }

  async peticiones(projectId?: string): Promise<PeticionOfertaDto[]> {
    const filtro = await this.filtroObras(purchaseRfqs.projectId);
    if (filtro === null) return [];
    const filas = await this.dbs.db
      .select()
      .from(purchaseRfqs)
      .where(
        and(
          eq(purchaseRfqs.companyId, this.dbs.getCompanyId()),
          filtro,
          projectId ? eq(purchaseRfqs.projectId, projectId) : undefined,
        ),
      )
      .orderBy(desc(purchaseRfqs.createdAt))
      .limit(100);
    const out: PeticionOfertaDto[] = [];
    for (const r of filas) out.push(await this.peticionDto(this.dbs.db, r));
    return out;
  }

  async peticion(id: string): Promise<PeticionOfertaDto> {
    return this.peticionDto(
      this.dbs.db,
      await this.cargarPeticion(this.dbs.db, id),
    );
  }

  private exigirAbierta(r: PurchaseRfq) {
    if (r.status !== 'abierta') {
      throw new ConflictException({
        code: 'P2P_RFQ_NOT_OPEN',
        message: `La petición ${r.number} está ${r.status}`,
      });
    }
  }

  /** Oferta de un proveedor invitado: precio por línea, plazo, validez y condiciones. */
  async registrarOferta(
    id: string,
    input: OfertaRegistrarInput,
  ): Promise<PeticionOfertaDto> {
    const d = ofertaRegistrarSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.cargarPeticion(tx, id, true);
      this.exigirAbierta(r);
      const [inv] = await tx
        .select()
        .from(purchaseRfqSuppliers)
        .where(
          and(
            eq(purchaseRfqSuppliers.rfqId, r.id),
            eq(purchaseRfqSuppliers.contactId, d.contactId),
          ),
        );
      if (!inv) {
        throw new UnprocessableEntityException({
          code: 'P2P_RFQ_SUPPLIER_NOT_INVITED',
          message: 'El proveedor no está invitado a esta petición de ofertas',
        });
      }
      const lineas = await tx
        .select({ id: purchaseRfqLines.id })
        .from(purchaseRfqLines)
        .where(eq(purchaseRfqLines.rfqId, r.id));
      const validas = new Set(lineas.map((l) => l.id));
      const vistos = new Set<string>();
      for (const p of d.precios) {
        if (!validas.has(p.lineaId) || vistos.has(p.lineaId)) {
          throw new UnprocessableEntityException({
            code: 'P2P_LINE_NOT_FOUND',
            message:
              'Alguna línea ofertada no es de la petición o está repetida',
          });
        }
        vistos.add(p.lineaId);
      }
      // La nueva oferta sustituye a la anterior del proveedor.
      await tx
        .delete(purchaseRfqQuotes)
        .where(
          and(
            eq(purchaseRfqQuotes.contactId, d.contactId),
            inArray(purchaseRfqQuotes.rfqLineId, [...validas]),
          ),
        );
      await tx.insert(purchaseRfqQuotes).values(
        d.precios.map((p) => ({
          companyId,
          rfqLineId: p.lineaId,
          contactId: d.contactId,
          unitPrice: p.precioUnitario.toFixed(4),
        })),
      );
      const nuevo = {
        leadTimeDays: d.plazoDias ?? null,
        validUntil: d.validaHasta ?? null,
        terms: d.condiciones ?? null,
        quotedAt: new Date(),
      };
      await tx
        .update(purchaseRfqSuppliers)
        .set({ ...nuevo, version: inv.version + 1 })
        .where(eq(purchaseRfqSuppliers.id, inv.id));
      await this.audit.registrar(tx, {
        entityType: 'purchase_rfq',
        entityId: r.id,
        action: 'update',
        oldData: {
          proveedor: d.contactId,
          plazo: inv.leadTimeDays,
          validaHasta: inv.validUntil,
        },
        newData: {
          accion: 'oferta',
          proveedor: d.contactId,
          precios: d.precios,
          plazo: nuevo.leadTimeDays,
          validaHasta: nuevo.validUntil,
        },
      });
    });
    return this.peticion(id);
  }

  /**
   * Adjudica la petición (todo a un proveedor o por línea) y emite un pedido
   * por proveedor adjudicado con sus precios ofertados.
   */
  async adjudicar(
    id: string,
    input: AdjudicarPeticionInput,
    version: number | undefined,
  ): Promise<PeticionOfertaDto> {
    const d = adjudicarPeticionSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.cargarPeticion(tx, id, true);
      verificarVersion(r.version, version);
      this.exigirAbierta(r);
      const lineas = await tx
        .select()
        .from(purchaseRfqLines)
        .where(eq(purchaseRfqLines.rfqId, r.id))
        .orderBy(asc(purchaseRfqLines.lineNo));
      const reparto = d.contactId
        ? lineas.map((l) => ({ lineaId: l.id, contactId: d.contactId! }))
        : d.porLinea!;
      const ofertas = await tx
        .select()
        .from(purchaseRfqQuotes)
        .where(
          inArray(
            purchaseRfqQuotes.rfqLineId,
            lineas.map((l) => l.id),
          ),
        );
      const proveedores = await tx
        .select()
        .from(purchaseRfqSuppliers)
        .where(eq(purchaseRfqSuppliers.rfqId, r.id));
      const porProveedor = new Map<
        string,
        { linea: (typeof lineas)[number]; oferta: (typeof ofertas)[number] }[]
      >();
      for (const a of reparto) {
        const linea = lineas.find((l) => l.id === a.lineaId);
        if (!linea) {
          throw new UnprocessableEntityException({
            code: 'P2P_LINE_NOT_FOUND',
            message: 'Línea de la petición no encontrada',
          });
        }
        const oferta = ofertas.find(
          (o) => o.rfqLineId === a.lineaId && o.contactId === a.contactId,
        );
        if (!oferta) {
          throw new UnprocessableEntityException({
            code: 'P2P_RFQ_QUOTE_MISSING',
            message: `El proveedor no ofertó la línea ${linea.lineNo} (${linea.description})`,
          });
        }
        const prov = proveedores.find((p) => p.contactId === a.contactId)!;
        if (prov.validUntil && prov.validUntil < d.fecha) {
          throw new UnprocessableEntityException({
            code: 'P2P_RFQ_QUOTE_EXPIRED',
            message: `La oferta del proveedor caducó el ${prov.validUntil}`,
          });
        }
        const l = porProveedor.get(a.contactId) ?? [];
        l.push({ linea, oferta });
        porProveedor.set(a.contactId, l);
      }
      const pedidosCreados: string[] = [];
      for (const [contactId, items] of [...porProveedor.entries()].sort(
        (a, b) => a[0].localeCompare(b[0]),
      )) {
        const prov = proveedores.find((p) => p.contactId === contactId)!;
        const po = await this.crearPedidoEnTx(tx, {
          projectId: r.projectId,
          contactId,
          fecha: d.fecha,
          descripcion: `${r.number} · ${r.title}`,
          entregaPrevista:
            prov.leadTimeDays !== null
              ? addDaysIso(d.fecha, prov.leadTimeDays)
              : null,
          requisitionId: r.requisitionId,
          rfqId: r.id,
          lineas: items.map(({ linea, oferta }) => ({
            tipo: linea.kind as TipoLineaCompra,
            articuloId: linea.articleId,
            descripcion: linea.description,
            unidad: linea.unit,
            cantidad: linea.quantity,
            precioUnitario: oferta.unitPrice,
            phaseId: linea.phaseId,
            requisitionLineId: linea.requisitionLineId,
            rfqQuoteId: oferta.id,
          })),
        });
        pedidosCreados.push(po.id);
        await tx
          .update(purchaseRfqQuotes)
          .set({ awarded: true })
          .where(
            inArray(
              purchaseRfqQuotes.id,
              items.map((i) => i.oferta.id),
            ),
          );
      }
      await cambiarEstado(
        tx,
        purchaseRfqs,
        'purchase_rfq',
        r.id,
        'abierta',
        'adjudicada',
        {},
        r.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'purchase_rfq',
        entityId: r.id,
        action: 'update',
        oldData: { status: 'abierta' },
        newData: { status: 'adjudicada', reparto, pedidos: pedidosCreados },
      });
    });
    return this.peticion(id);
  }

  /* ───────────────────────────── pedidos ───────────────────────────── */

  /** Pedido con líneas en la transacción del llamador; el importe es Σ líneas. */
  private async crearPedidoEnTx(
    tx: Tx,
    d: {
      projectId: string;
      contactId: string;
      fecha: string;
      descripcion: string;
      entregaPrevista?: string | null;
      phaseId?: string | null;
      notas?: string | null;
      requisitionId?: string | null;
      rfqId?: string | null;
      tolerancias?: {
        precioPct?: number;
        precioImporte?: number;
        cantidadPct?: number;
      };
      lineas: {
        tipo: TipoLineaCompra;
        articuloId?: string | null;
        descripcion: string;
        unidad?: string;
        cantidad: string | number;
        precioUnitario: string | number;
        phaseId?: string | null;
        exigeRecepcion?: boolean;
        requisitionLineId?: string | null;
        rfqQuoteId?: string | null;
      }[];
    },
  ): Promise<PurchaseOrder> {
    regla(() => validarLineasCompra(d.lineas, { exigirPrecio: true }));
    await this.validarArticulos(
      tx,
      d.lineas.map((l) => l.articuloId),
    );
    const importes = d.lineas.map((l) =>
      importeLinea(l.cantidad, l.precioUnitario),
    );
    const po = await this.pedidos.crearEnTx(tx, {
      projectId: d.projectId,
      contactId: d.contactId,
      orderDate: d.fecha,
      description: d.descripcion,
      amount: centsToNumeric(sumCents(importes)),
      phaseId: d.phaseId ?? null,
      expectedDate: d.entregaPrevista ?? null,
      notes: d.notas ?? null,
      requisitionId: d.requisitionId ?? null,
      rfqId: d.rfqId ?? null,
      tolerancias: d.tolerancias,
    });
    await tx.insert(purchaseOrderLines).values(
      d.lineas.map((l, i) => ({
        companyId: po.companyId,
        orderId: po.id,
        lineNo: i + 1,
        kind: l.tipo,
        articleId: l.articuloId ?? null,
        description: l.descripcion,
        unit: l.unidad ?? 'ud',
        quantity: Number(l.cantidad).toFixed(3),
        unitPrice: Number(l.precioUnitario).toFixed(4),
        amount: centsToNumeric(importes[i]),
        phaseId: l.phaseId ?? d.phaseId ?? null,
        requiresReceipt: l.exigeRecepcion ?? exigeRecepcionPorDefecto(l.tipo),
        requisitionLineId: l.requisitionLineId ?? null,
        rfqQuoteId: l.rfqQuoteId ?? null,
      })),
    );
    await this.audit.registrar(tx, {
      entityType: 'purchase_order',
      entityId: po.id,
      action: 'create',
      newData: { ...po, lineas: d.lineas },
    });
    return po;
  }

  /** Pedido directo con líneas (sin solicitud previa). */
  async crearPedido(
    input: PedidoLineasCreateInput,
  ): Promise<PedidoCompraDetalleDto> {
    const d = pedidoLineasCreateSchema.parse(input);
    const id = await this.dbs.db.transaction(async (tx) => {
      await this.obra(tx, d.projectId);
      const po = await this.crearPedidoEnTx(tx, {
        projectId: d.projectId,
        contactId: d.contactId,
        fecha: d.fecha,
        descripcion: d.descripcion,
        entregaPrevista: d.entregaPrevista ?? null,
        phaseId: d.phaseId ?? null,
        notas: d.notas ?? null,
        tolerancias: {
          precioPct: d.toleranciaPrecioPct,
          precioImporte: d.toleranciaPrecioImporte,
          cantidadPct: d.toleranciaCantidadPct,
        },
        lineas: d.lineas,
      });
      return po.id;
    });
    return this.pedido(id);
  }

  private async cargarPedido(ex: DbOrTx, id: string): Promise<PurchaseOrder> {
    const [po] = await ex
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, this.dbs.getCompanyId()),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    if (!po)
      throw noEncontrada(
        'P2P_ORDER_NOT_FOUND',
        'Pedido de compra no encontrado',
      );
    await this.obra(ex, po.projectId);
    return po;
  }

  async pedido(id: string): Promise<PedidoCompraDetalleDto> {
    const ex = this.dbs.db;
    const po = await this.cargarPedido(ex, id);
    const [c] = await ex
      .select({ nombre: contacts.legalName })
      .from(contacts)
      .where(eq(contacts.id, po.contactId));
    const lineas = await ex
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, id))
      .orderBy(asc(purchaseOrderLines.lineNo));
    const cant = await cantidadesPorLinea(
      ex,
      lineas.map((l) => l.id),
    );
    const recepciones = await ex
      .select({ gr: goodsReceipts, albaran: deliveryNotes.noteNumber })
      .from(goodsReceipts)
      .innerJoin(
        deliveryNotes,
        eq(deliveryNotes.id, goodsReceipts.deliveryNoteId),
      )
      .where(eq(goodsReceipts.orderId, id))
      .orderBy(asc(goodsReceipts.receiptDate), asc(goodsReceipts.createdAt));
    const lineasGr = recepciones.length
      ? await ex
          .select()
          .from(goodsReceiptLines)
          .where(
            inArray(
              goodsReceiptLines.receiptId,
              recepciones.map((r) => r.gr.id),
            ),
          )
      : [];
    const facturas = lineas.length
      ? await ex
          .select({
            id: invoices.id,
            numero: invoices.invoiceNumber,
            estado: invoices.status,
            importe: sql<string>`sum(${invoiceLines.baseAmount})::text`,
          })
          .from(invoiceLines)
          .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
          .where(
            and(
              inArray(
                invoiceLines.purchaseOrderLineId,
                lineas.map((l) => l.id),
              ),
              isNull(invoices.deletedAt),
            ),
          )
          .groupBy(invoices.id, invoices.invoiceNumber, invoices.status)
      : [];
    return {
      id: po.id,
      numero: po.orderNumber,
      projectId: po.projectId,
      contactId: po.contactId,
      contactName: c?.nombre ?? '',
      estado: po.status,
      fecha: po.orderDate,
      importe: fromCents(toCents(po.amount)),
      tolerancias: {
        precioPct: Number(po.priceTolerancePct),
        precioImporte: Number(po.priceToleranceAmount),
        cantidadPct: Number(po.quantityTolerancePct),
      },
      solicitudId: po.requisitionId,
      peticionId: po.rfqId,
      lineas: lineas.map((l) => {
        const q = cant.get(l.id)!;
        return {
          id: l.id,
          numero: l.lineNo,
          tipo: l.kind as TipoLineaCompra,
          articuloId: l.articleId,
          descripcion: l.description,
          unidad: l.unit,
          cantidad: Number(l.quantity),
          precioUnitario: Number(l.unitPrice),
          phaseId: l.phaseId,
          exigeRecepcion: l.requiresReceipt,
          ...estadoLineaPedido({
            cantidad: l.quantity,
            precioUnitario: l.unitPrice,
            recibida: q.recibida,
            facturada: q.facturada,
            importeFacturado: q.importeFacturado,
            exigeRecepcion: l.requiresReceipt,
          }),
        };
      }),
      recepciones: recepciones.map(({ gr, albaran }) => ({
        id: gr.id,
        fecha: gr.receiptDate,
        albaranId: gr.deliveryNoteId,
        albaranNumero: albaran,
        almacenId: gr.warehouseId,
        importe: fromCents(toCents(gr.amount)),
        lineas: lineasGr
          .filter((x) => x.receiptId === gr.id)
          .map((x) => ({
            lineaId: x.orderLineId,
            cantidad: Number(x.quantity),
            importe: fromCents(toCents(x.amount)),
            movimientoStockId: x.stockMovementId,
          })),
      })),
      facturas: facturas.map((f) => ({
        invoiceId: f.id,
        invoiceNumber: f.numero,
        estado: f.estado,
        importe: fromCents(toCents(f.importe)),
      })),
      version: po.version,
    };
  }

  async pedidosConLineas(projectId?: string) {
    const filtro = await this.filtroObras(purchaseOrders.projectId);
    if (filtro === null) return [];
    const filas = await this.dbs.db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, this.dbs.getCompanyId()),
          isNull(purchaseOrders.deletedAt),
          filtro,
          projectId ? eq(purchaseOrders.projectId, projectId) : undefined,
          sql`exists (select 1 from purchase_order_lines pol where pol.order_id = ${purchaseOrders.id})`,
        ),
      )
      .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.seq))
      .limit(100);
    const out: PedidoCompraDetalleDto[] = [];
    for (const f of filas) out.push(await this.pedido(f.id));
    return out;
  }

  /* ───────────────────────────── recepciones ───────────────────────────── */

  /**
   * Recepción (MIGO) de líneas de un pedido: valida lo pendiente, registra el
   * albarán del proveedor ya validado, entra en almacén el material de stock
   * (con lotes o series, al precio del pedido) y recalcula el estado del
   * pedido. Todo en una transacción, con el pedido bloqueado.
   */
  async recibir(
    id: string,
    input: RecepcionCreateInput,
  ): Promise<PedidoCompraDetalleDto> {
    const d = recepcionCreateSchema.parse(input);
    if (d.fecha > todayIso()) {
      throw new UnprocessableEntityException({
        code: 'P2P_RECEIPT_INVALID',
        message: 'La fecha de recepción no puede ser futura',
      });
    }
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      await this.pedidos.bloquearPedidos(tx, [id]);
      const po = await this.cargarPedido(tx, id);
      if (!['emitido', 'servido_parcial', 'servido'].includes(po.status)) {
        throw new ConflictException({
          code: 'P2P_ORDER_NOT_RECEIVABLE',
          message: `El pedido ${po.orderNumber} está ${po.status}: no admite recepciones`,
        });
      }
      const lineas = await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderId, id));
      if (lineas.length === 0) {
        throw new UnprocessableEntityException({
          code: 'P2P_ORDER_WITHOUT_LINES',
          message:
            'El pedido no tiene líneas: registra su albarán en Albaranes',
        });
      }
      const porId = new Map(lineas.map((l) => [l.id, l]));
      const vistas = new Set<string>();
      const cant = await cantidadesPorLinea(
        tx,
        lineas.map((l) => l.id),
      );
      const recibidas = d.lineas.map((r) => {
        const l = porId.get(r.lineaId);
        if (!l || vistas.has(r.lineaId)) {
          throw new UnprocessableEntityException({
            code: 'P2P_LINE_NOT_FOUND',
            message:
              'Alguna línea no es del pedido o está repetida en la recepción',
          });
        }
        vistas.add(r.lineaId);
        if (r.lotes?.length && !(l.articleId && d.almacenId)) {
          throw new UnprocessableEntityException({
            code: 'P2P_RECEIPT_INVALID',
            message:
              'Los lotes o series solo se indican al entrar material de stock en un almacén',
          });
        }
        const importe = regla(() =>
          validarRecepcionLinea({
            cantidadPedida: l.quantity,
            recibidaPrevia: cant.get(l.id)!.recibida,
            cantidad: r.cantidad,
            precioUnitario: l.unitPrice,
          }),
        );
        return { r, l, importe };
      });
      const total = sumCents(recibidas.map((x) => x.importe));
      let albaranId: string;
      try {
        const [dn] = await tx
          .insert(deliveryNotes)
          .values({
            companyId,
            contactId: po.contactId,
            projectId: po.projectId,
            phaseId: po.phaseId,
            orderId: po.id,
            noteNumber: d.albaranNumero,
            noteDate: d.fecha,
            description: `Recepción del pedido ${po.orderNumber}`,
            amount: centsToNumeric(total),
            status: 'validado',
            validatedAt: new Date(),
          })
          .returning();
        albaranId = dn.id;
        await this.audit.registrar(tx, {
          entityType: 'delivery_note',
          entityId: dn.id,
          action: 'create',
          newData: { ...dn, origen: 'recepcion_pedido' },
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          throw new ConflictException({
            code: 'DELIVERY_NOTE_NUMBER_DUPLICATE',
            message: `El albarán ${d.albaranNumero} de este proveedor ya está registrado`,
          });
        }
        throw e;
      }
      const [gr] = await tx
        .insert(goodsReceipts)
        .values({
          companyId,
          orderId: po.id,
          deliveryNoteId: albaranId,
          warehouseId: d.almacenId ?? null,
          receiptDate: d.fecha,
          amount: centsToNumeric(total),
          createdBy: usuarioPersistible(),
        })
        .returning();
      // Entrada en almacén del material de stock (un movimiento por artículo).
      const deStock = recibidas.filter((x) => x.l.articleId && d.almacenId);
      const movimientos = new Map<string, string>();
      if (deStock.length > 0) {
        const ordenadas = [...deStock].sort((a, b) =>
          a.l.articleId!.localeCompare(b.l.articleId!),
        );
        const ids = await this.almacen.entradaEnTx(tx, companyId, {
          almacenId: d.almacenId!,
          fecha: d.fecha,
          albaranId,
          notas: `Recepción ${po.orderNumber}`,
          lineas: ordenadas.map((x) => ({
            articuloId: x.l.articleId!,
            cantidad: x.r.cantidad,
            costeUnitario: Number(x.l.unitPrice),
            ...(x.r.lotes ? { lotes: x.r.lotes } : {}),
          })),
        });
        ordenadas.forEach((x, i) => movimientos.set(x.l.id, ids[i]));
      }
      await tx.insert(goodsReceiptLines).values(
        recibidas.map((x) => ({
          companyId,
          receiptId: gr.id,
          orderLineId: x.l.id,
          quantity: x.r.cantidad.toFixed(3),
          amount: centsToNumeric(x.importe),
          stockMovementId: movimientos.get(x.l.id) ?? null,
        })),
      );
      await this.audit.registrar(tx, {
        entityType: 'goods_receipt',
        entityId: gr.id,
        action: 'create',
        newData: {
          ...gr,
          lineas: recibidas.map((x) => ({
            lineaId: x.l.id,
            cantidad: x.r.cantidad,
            importe: centsToNumeric(x.importe),
          })),
        },
      });
      const antes = po.status;
      await this.pedidos.refreshStatus(po.id, tx);
      const [tras] = await tx
        .select({ status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, po.id));
      if (tras.status !== antes) {
        await this.audit.registrar(tx, {
          entityType: 'purchase_order',
          entityId: po.id,
          action: 'update',
          oldData: { status: antes },
          newData: diferenciasAuditoria(
            { status: antes },
            { status: tras.status },
          ),
        });
      }
    });
    return this.pedido(id);
  }

  /* ──────────────────── verificación de facturas (MIRO) ──────────────────── */

  /**
   * Factura del proveedor contra las líneas del pedido: crea la factura de
   * compra en borrador con cada línea enlazada (cantidad × precio) y devuelve
   * el cuadre a tres bandas previo. La aprobación (`POST /invoices/:id/aprobar`)
   * vuelve a cuadrar con los pedidos bloqueados y rechaza las desviaciones.
   */
  async facturaDePedido(
    id: string,
    input: FacturaPedidoCreateInput,
  ): Promise<{ factura: InvoiceDto; cuadre: CuadreFacturaDto | null }> {
    const d = facturaPedidoCreateSchema.parse(input);
    const po = await this.cargarPedido(this.dbs.db, id);
    const lineas = await this.dbs.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, id));
    const porId = new Map(lineas.map((l) => [l.id, l]));
    const factura = await this.facturas.create({
      kind: 'compra',
      contactId: po.contactId,
      invoiceNumber: d.invoiceNumber,
      issueDate: d.issueDate,
      dueDate: d.dueDate ?? null,
      lines: d.lineas.map((x) => {
        const l = porId.get(x.lineaId);
        if (!l) {
          throw new UnprocessableEntityException({
            code: 'P2P_LINE_NOT_FOUND',
            message: 'Alguna línea no es del pedido',
          });
        }
        return {
          description: `${po.orderNumber} · ${l.description}`,
          baseAmount: fromCents(importeLinea(x.cantidad, x.precioUnitario)),
          vatPct: x.vatPct,
          projectId: po.projectId,
          phaseId: l.phaseId ?? po.phaseId ?? null,
          purchaseOrderLineId: l.id,
          quantity: x.cantidad,
          unitPrice: x.precioUnitario,
        };
      }),
    });
    return { factura, cuadre: await this.cuadre(factura.id) };
  }

  /** Cuadre a tres bandas de una factura (en vivo, sin aprobarla). */
  async cuadre(invoiceId: string): Promise<CuadreFacturaDto | null> {
    const [f] = await this.dbs.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, this.dbs.getCompanyId()),
          isNull(invoices.deletedAt),
        ),
      );
    if (!f) throw noEncontrada('INVOICE_NOT_FOUND', 'Factura no encontrada');
    const c = await cuadreDeFactura(this.dbs.db, f);
    if (c) await this.cargarPedido(this.dbs.db, c.pedidoId);
    return c;
  }
}

function addDaysIso(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
