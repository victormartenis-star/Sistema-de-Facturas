import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  like,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import {
  categories,
  Contact,
  Invoice,
  certificacionesSubcontrata,
  certifications,
  contacts,
  deliveryNotes,
  invoiceLines,
  invoices,
  paymentMilestones,
  projectPhases,
  projects,
  Tx,
} from '@erp/db';
import {
  InvoiceCancelInput,
  InvoiceCreateInput,
  InvoiceDto,
  InvoiceKind,
  InvoiceLineDto,
  InvoiceRectifyInput,
  InvoiceStatus,
  PaginaDto,
  calcularOffset,
  construirPagina,
  RectificationKind,
  RectificationMotive,
  RectificationType,
  rectificationClassificationErrors,
  amountsMatch,
  buildRectificationLines,
  canTransitionInvoice,
  computeInvoiceAmounts,
  fromCents,
  hasAllowedProject,
  invoiceCancelBlockReason,
  invoiceCancelSchema,
  invoiceCreateSchema,
  invoiceRectifyBlockReason,
  invoiceRectifySchema,
  invoiceUpdateSchema,
  InvoiceUpdateInput,
  payableAmount,
  planMilestones,
  planRectificationMilestones,
  sumarImportes,
  sumCents,
  todayIso,
  toCents,
} from '@erp/shared';
import { ComplianceService } from '../compliance/compliance.service';
import { ProveedoresService } from '../modules/proveedores/proveedores.service';
import { AprobacionesService } from '../aprobaciones/aprobaciones.service';
import { AuditService } from '../audit/audit.service';
import {
  cambiarEstado,
  cambiarEstadoMasivo,
  MENSAJE_ESTADO_CAMBIADO,
} from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { DbService } from '../db/db.service';
import { liquidarPendiente } from '../treasury/liquidaciones';
import {
  exigirCuadreEnAprobacion,
  validarLineasFacturaCompra,
} from '../compras/cuadre';

/** Columnas del enlace de una línea de factura con su línea de pedido. */
function lineaPedido(l: {
  purchaseOrderLineId?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
}) {
  return l.purchaseOrderLineId
    ? {
        purchaseOrderLineId: l.purchaseOrderLineId,
        quantity: (l.quantity ?? 0).toFixed(3),
        unitPrice: (l.unitPrice ?? 0).toFixed(4),
      }
    : {};
}
import {
  condicionVersion,
  falloActualizacion,
  incrementarVersion,
  verificarVersion,
} from '../common/version';

type InvoiceCreateData = ReturnType<typeof invoiceCreateSchema.parse>;
type InvoiceAmounts = ReturnType<typeof computeInvoiceAmounts>;

interface RectificacionEnlace {
  invoiceId: string;
  kind: RectificationKind;
  reason: string;
  motive: RectificationMotive | null;
  type: RectificationType | null;
  facturaeReasonCode?: string | null;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly dbs: DbService,
    private readonly compliance: ComplianceService,
    private readonly proveedores: ProveedoresService,
    private readonly audit: AuditService,
    private readonly aprobaciones: AprobacionesService,
  ) {}

  async list(
    kind?: InvoiceKind,
    status?: InvoiceStatus,
    search?: string,
    soloRectificativas = false,
    projectId?: string,
    /** Con página, responde `PaginaDto`; sin ella, el array completo. */
    pagina?: { page: number; pageSize: number },
  ): Promise<InvoiceDto[] | PaginaDto<InvoiceDto>> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters: SQL[] = [
      eq(invoices.companyId, companyId),
      isNull(invoices.deletedAt),
    ];
    const vacio = () =>
      pagina ? construirPagina([], 0, pagina.page, pagina.pageSize) : [];
    // Obras por las que filtrar las líneas: la pedida, acotada a las
    // accesibles. Rol obra: solo facturas con alguna línea imputada a sus
    // obras; las facturas sin ninguna línea de obra (gasto general de
    // empresa) quedan fuera, igual que en `hasAllowedProject`. Una factura con
    // líneas en varias obras aparece al filtrar por cualquiera de ellas.
    let obrasFiltro: string[] | null = allowed;
    if (projectId) {
      obrasFiltro =
        allowed === null || allowed.includes(projectId) ? [projectId] : [];
    }
    if (obrasFiltro !== null) {
      if (obrasFiltro.length === 0) return vacio();
      const invoiceIds = await this.invoiceIdsForProjects(obrasFiltro);
      if (invoiceIds.length === 0) return vacio();
      filters.push(inArray(invoices.id, invoiceIds));
    }
    if (kind) filters.push(eq(invoices.kind, kind));
    if (status) filters.push(eq(invoices.status, status));
    if (soloRectificativas)
      filters.push(isNotNull(invoices.rectifiesInvoiceId));
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      filters.push(
        or(
          ilike(invoices.invoiceNumber, term),
          ilike(contacts.legalName, term),
        ) as SQL,
      );
    }
    const query = this.dbs.db
      .select({ invoice: invoices, contactName: contacts.legalName })
      .from(invoices)
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(and(...filters))
      .orderBy(
        desc(invoices.issueDate),
        desc(invoices.createdAt),
        desc(invoices.id),
      );
    if (!pagina) return this.toDtos(await query);
    const [c] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(and(...filters));
    const rows = await query
      .limit(pagina.pageSize)
      .offset(calcularOffset(pagina.page, pagina.pageSize));
    return construirPagina(
      await this.toDtos(rows),
      c?.n ?? 0,
      pagina.page,
      pagina.pageSize,
    );
  }

  async get(id: string): Promise<InvoiceDto> {
    const row = await this.findWithContact(id);
    const [dto] = await this.toDtos([row]);
    return dto;
  }

  async create(input: InvoiceCreateInput): Promise<InvoiceDto> {
    this.rechazarClasificacionRectificativa(input);
    const { companyId, data, amounts } = await this.prepararCreacion(input);
    const invoiceId = await this.dbs.db.transaction(async (tx) => {
      const creada = await this.crearEnTx(tx, companyId, data, amounts);
      await this.audit.registrar(tx, {
        entityType: 'invoice',
        entityId: creada.id,
        action: 'create',
        newData: {
          invoiceId: creada.id,
          kind: creada.kind,
          status: creada.status,
        },
      });
      return creada.id;
    });
    return this.get(invoiceId);
  }

  /** Motivo/tipo de rectificación no se aceptan al crear/editar facturas ordinarias (400). */
  private rechazarClasificacionRectificativa(input: {
    rectificationMotive?: string | null;
    rectificationType?: string | null;
  }): void {
    const errores = rectificationClassificationErrors({
      esRectificativa: false,
      motive: input.rectificationMotive,
      type: input.rectificationType,
    });
    if (errores.length > 0)
      throw new BadRequestException({
        code: 'INVOICE_CLASSIFICATION_INVALID',
        message: errores[0],
      });
  }

  /**
   * Validaciones previas a crear una factura (fuera de transacción): esquema,
   * contacto de la empresa y acceso a las obras de las líneas. Devuelve lo
   * que necesita `crearEnTx`. Lo usa también `CertificationsService` para
   * facturar dentro de su propia transacción.
   */
  async prepararCreacion(input: InvoiceCreateInput): Promise<{
    companyId: string;
    data: InvoiceCreateData;
    amounts: InvoiceAmounts;
    contact: Contact;
  }> {
    const companyId = await this.dbs.getCompanyId();
    const data = invoiceCreateSchema.parse(input);
    const contact = await this.findContact(data.contactId);
    const allowed = await this.dbs.getObrasAccesibles();
    if (
      allowed !== null &&
      !hasAllowedProject(
        allowed,
        data.lines.map((l) => l.projectId ?? null),
      )
    ) {
      // Mismo criterio que `findWithContact`: sin esto, la factura se crea
      // igual (companyId es válido) pero queda huérfana — invisible para el
      // propio usuario `obra` que la creó, porque ninguna de sus líneas
      // pertenece a una obra a la que tiene acceso.
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    }
    await this.validarImputaciones(companyId, data.lines);
    const amounts = computeInvoiceAmounts(
      data.lines,
      data.isp,
      data.retentionPct,
    );
    return { companyId, data, amounts, contact };
  }

  /**
   * Inserta factura, líneas y vínculo con albaranes dentro de la transacción
   * recibida. Solo usa `tx`: no lee por el pool, para poder encadenarse con
   * `aprobarEnTx` en la misma transacción.
   */
  async crearEnTx(
    tx: Tx,
    companyId: string,
    data: InvoiceCreateData,
    amounts: InvoiceAmounts,
    rectificacion?: RectificacionEnlace,
    /** Compra generada desde una certificación de subcontrata. */
    origen?: { certSubcontrataId: string },
  ): Promise<Invoice> {
    let row: Invoice;
    try {
      [row] = await tx
        .insert(invoices)
        .values({
          companyId,
          kind: data.kind,
          contactId: data.contactId,
          invoiceNumber: data.invoiceNumber,
          issueDate: data.issueDate,
          dueDate: data.dueDate ?? null,
          baseAmount: amounts.baseAmount.toFixed(2),
          vatAmount: amounts.vatAmount.toFixed(2),
          totalAmount: amounts.totalAmount.toFixed(2),
          isp: data.isp,
          retentionPct: data.retentionPct.toFixed(2),
          retentionAmount: amounts.retentionAmount.toFixed(2),
          retentionReleaseDate: data.retentionReleaseDate ?? null,
          notes: data.notes ?? null,
          ...(rectificacion && {
            rectifiesInvoiceId: rectificacion.invoiceId,
            rectificationKind: rectificacion.kind,
            rectificationReason: rectificacion.reason,
            rectificationMotive: rectificacion.motive,
            rectificationType: rectificacion.type,
            facturaeReasonCode: rectificacion.facturaeReasonCode ?? null,
          }),
          ...(origen && { certSubcontrataId: origen.certSubcontrataId }),
        })
        .returning();
    } catch (err) {
      this.rethrowDuplicateNumber(err, data.invoiceNumber);
    }
    // Cuadre por línea (P2P): líneas enlazadas a pedido coherentes.
    await validarLineasFacturaCompra(tx, {
      companyId,
      kind: data.kind,
      contactId: data.contactId,
      deliveryNoteIds: data.kind === 'compra' ? data.deliveryNoteIds : [],
      lineas: data.lines,
    });
    await tx.insert(invoiceLines).values(
      data.lines.map((l, i) => ({
        invoiceId: row.id,
        description: l.description,
        baseAmount: l.baseAmount.toFixed(2),
        vatPct: l.vatPct.toFixed(2),
        projectId: l.projectId ?? null,
        phaseId: l.phaseId ?? null,
        categoryId: l.categoryId ?? null,
        sortOrder: i,
        ...lineaPedido(l),
      })),
    );
    if (data.kind === 'compra' && data.deliveryNoteIds.length > 0) {
      await this.linkDeliveryNotes(
        tx,
        row.id,
        data.contactId,
        data.deliveryNoteIds,
      );
    }
    return row;
  }

  /** Solo se puede editar una factura en borrador. */
  async update(
    id: string,
    input: InvoiceUpdateInput,
    versionEsperada?: number,
  ): Promise<InvoiceDto> {
    const { invoice } = await this.findWithContact(id);
    verificarVersion(invoice.version, versionEsperada);
    if (invoice.status !== 'borrador') {
      throw new ConflictException({
        code: 'INVOICE_NOT_EDITABLE',
        message:
          'Solo se pueden editar facturas en borrador; anúlala si necesitas corregirla',
      });
    }
    this.rechazarClasificacionRectificativa(input);
    const data = invoiceUpdateSchema.parse(input);
    this.rechazarEdicionRectificativa(invoice, data);

    // Mismas validaciones que `prepararCreacion`: contacto de la empresa y
    // obras de las líneas accesibles / pertenecientes a la empresa.
    if (data.contactId !== undefined) {
      await this.findContact(data.contactId);
    }
    if (data.lines) {
      const allowed = await this.dbs.getObrasAccesibles();
      if (
        allowed !== null &&
        !hasAllowedProject(
          allowed,
          data.lines.map((l) => l.projectId ?? null),
        )
      ) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Obra no encontrada',
        });
      }
      await this.validarImputaciones(invoice.companyId, data.lines);
    }

    const lines =
      data.lines ??
      (await this.loadLines([id])).map((l) => ({
        description: l.description,
        baseAmount: l.baseAmount,
        vatPct: l.vatPct,
        projectId: l.projectId,
        phaseId: l.phaseId,
        categoryId: l.categoryId,
        purchaseOrderLineId: l.purchaseOrderLineId ?? null,
        quantity: l.quantity ?? null,
        unitPrice: l.unitPrice ?? null,
      }));
    const isp = data.isp ?? invoice.isp;
    const retentionPct = data.retentionPct ?? Number(invoice.retentionPct);
    const amounts = computeInvoiceAmounts(
      lines.map((l) => ({
        baseAmount: l.baseAmount,
        vatPct: l.vatPct ?? 21,
      })),
      isp,
      retentionPct,
    );

    await this.dbs.db.transaction(async (tx) => {
      let editadas: { id: string }[] = [];
      try {
        editadas = await tx
          .update(invoices)
          .set({
            ...(data.contactId !== undefined && { contactId: data.contactId }),
            ...(data.invoiceNumber !== undefined && {
              invoiceNumber: data.invoiceNumber,
            }),
            ...(data.issueDate !== undefined && { issueDate: data.issueDate }),
            ...(data.dueDate !== undefined && {
              dueDate: data.dueDate ?? null,
            }),
            ...(data.retentionReleaseDate !== undefined && {
              retentionReleaseDate: data.retentionReleaseDate ?? null,
            }),
            ...(data.notes !== undefined && { notes: data.notes ?? null }),
            // Un borrador no forma parte de la cadena VeriFactu: si por lo que
            // sea conservara una huella, editarlo la invalida.
            verifactuHash: null,
            verifactuPreviousHash: null,
            verifactuGeneratedAt: null,
            isp,
            retentionPct: retentionPct.toFixed(2),
            baseAmount: amounts.baseAmount.toFixed(2),
            vatAmount: amounts.vatAmount.toFixed(2),
            totalAmount: amounts.totalAmount.toFixed(2),
            retentionAmount: amounts.retentionAmount.toFixed(2),
            updatedAt: new Date(),
            version: incrementarVersion(invoices),
          })
          // Solo un borrador admite edición. La condición va en el propio
          // UPDATE: si una aprobación concurrente ganó la carrera, no se toca
          // ninguna fila y se responde 409 (los importes no cambian).
          .where(
            and(
              eq(invoices.id, id),
              eq(invoices.status, 'borrador'),
              condicionVersion(invoices, versionEsperada),
            ),
          )
          .returning({ id: invoices.id });
      } catch (err) {
        this.rethrowDuplicateNumber(err, data.invoiceNumber ?? '');
      }
      if (editadas.length === 0) {
        await falloActualizacion(
          tx,
          invoices,
          id,
          versionEsperada,
          () => new ConflictException(MENSAJE_ESTADO_CAMBIADO),
          'Factura no encontrada',
        );
      }
      if (data.lines) {
        await validarLineasFacturaCompra(tx, {
          companyId: invoice.companyId,
          kind: invoice.kind,
          contactId: data.contactId ?? invoice.contactId,
          deliveryNoteIds:
            invoice.kind === 'compra' ? (data.deliveryNoteIds ?? []) : [],
          lineas: data.lines,
        });
        await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
        await tx.insert(invoiceLines).values(
          data.lines.map((l, i) => ({
            invoiceId: id,
            description: l.description,
            baseAmount: l.baseAmount.toFixed(2),
            vatPct: (l.vatPct ?? 21).toFixed(2),
            projectId: l.projectId ?? null,
            phaseId: l.phaseId ?? null,
            categoryId: l.categoryId ?? null,
            sortOrder: i,
            ...lineaPedido(l),
          })),
        );
      }
      if (
        invoice.kind === 'compra' &&
        !invoice.rectifiesInvoiceId &&
        !invoice.certSubcontrataId
      ) {
        await this.aprobaciones.invalidarSiProcede(tx, {
          operacion: 'factura_compra',
          entidadId: id,
          importeNuevo: amounts.totalAmount.toFixed(2),
          motivo: 'Factura modificada',
          forzar:
            data.contactId !== undefined &&
            data.contactId !== invoice.contactId,
        });
      }
      if (data.deliveryNoteIds) {
        // Relink completo: soltar los actuales y vincular los nuevos
        await tx
          .update(deliveryNotes)
          .set({
            invoiceId: null,
            updatedAt: new Date(),
            version: incrementarVersion(deliveryNotes),
          })
          .where(eq(deliveryNotes.invoiceId, id));
        if (data.deliveryNoteIds.length > 0) {
          await this.linkDeliveryNotes(
            tx,
            id,
            data.contactId ?? invoice.contactId,
            data.deliveryNoteIds,
          );
        }
      }
    });
    return this.get(id);
  }

  /**
   * Aprobar una factura:
   * - Compra: exige albaranes validados cuyo total cuadre con la base
   *   (punteado / matching a 3 bandas simplificado).
   * - Genera los vencimientos: ordinario (total - retención) y, si hay
   *   retención de garantía, uno diferido a la fecha de liberación.
   */
  async approve(id: string, versionEsperada?: number): Promise<InvoiceDto> {
    const { invoice } = await this.findWithContact(id);
    verificarVersion(invoice.version, versionEsperada);
    if (invoice.status !== 'borrador') {
      throw new ConflictException({
        code: 'INVOICE_NOT_DRAFT',
        message: 'Solo se aprueban facturas en borrador',
      });
    }
    const contact = await this.findContact(invoice.contactId);

    // Homologación PRL: no se aprueba gasto a una subcontrata sin la
    // documentación al día (responsabilidad solidaria del contratista).
    if (invoice.kind === 'compra' && !invoice.rectifiesInvoiceId) {
      await this.compliance.assertCanTransact(
        invoice.contactId,
        'aprobar la factura',
      );
      // Guard adicional (Fase 11): si el contacto tiene ficha extendida de
      // proveedor/subcontrata, sus documentos PRL específicos (plan de
      // seguridad, EPI, itinerario formativo...) también deben estar al
      // día — homologación general (`contacts`) y PRL de obra
      // (`proveedores`) son controles independientes, los dos aplican.
      await this.proveedores.assertAptoParaPago(
        invoice.contactId,
        'aprobar la factura',
      );
    }

    // Flujo de aprobación por umbral (antes de la transacción: el bloqueo
    // se audita aparte). Rectificativas y facturas de subcontrata siguen a
    // su documento de origen.
    if (
      invoice.kind === 'compra' &&
      !invoice.rectifiesInvoiceId &&
      !invoice.certSubcontrataId
    ) {
      await this.aprobaciones.exigir(this.dbs.db, 'factura_compra', id);
    }

    await this.dbs.db.transaction(async (tx) => {
      await this.aprobarEnTx(tx, invoice, contact, versionEsperada);
      await this.audit.registrar(tx, {
        entityType: 'invoice',
        entityId: id,
        action: 'update',
        newData: { status: 'aprobada' },
      });
    });
    return this.get(id);
  }

  /**
   * Aprueba una factura dentro de la transacción recibida: valida y marca los
   * albaranes (compra), pasa la factura a `aprobada` y genera sus
   * vencimientos. Solo usa `tx`. Las comprobaciones de homologación PRL
   * (solo compra) las hace `approve` antes de abrir la transacción.
   */
  async aprobarEnTx(
    tx: Tx,
    invoiceLeida: Invoice,
    contact: Contact,
    versionEsperada?: number,
  ): Promise<void> {
    const id = invoiceLeida.id;
    // Se relee con bloqueo: dos aprobaciones simultáneas se serializan y la
    // segunda ve que ya no es borrador. Se trabaja con la fila bloqueada (no
    // con la leída antes de abrir la transacción): un PATCH que haya ganado la
    // carrera deja importes nuevos y los vencimientos deben salir de ellos.
    const [locked] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)))
      .for('update');
    if (
      !locked ||
      !canTransitionInvoice(locked.status as InvoiceStatus, 'aprobada') ||
      locked.status !== 'borrador'
    ) {
      throw new ConflictException({
        code: 'INVOICE_NOT_DRAFT',
        message: 'Solo se aprueban facturas en borrador',
      });
    }
    verificarVersion(locked.version, versionEsperada);
    const invoice = locked;

    if (invoice.rectifiesInvoiceId) {
      await this.aprobarRectificativaEnTx(tx, invoice, contact);
      return;
    }

    if (invoice.kind === 'compra' && invoice.certSubcontrataId) {
      // Compra de subcontrata: el documento de conformidad es la
      // certificación aprobada, no un albarán. La base debe ser exactamente
      // la producción del periodo certificado.
      const [cert] = await tx
        .select({
          importePeriodo: certificacionesSubcontrata.importePeriodo,
          status: certificacionesSubcontrata.status,
        })
        .from(certificacionesSubcontrata)
        .where(
          and(
            eq(certificacionesSubcontrata.id, invoice.certSubcontrataId),
            eq(certificacionesSubcontrata.companyId, invoice.companyId),
            isNull(certificacionesSubcontrata.deletedAt),
          ),
        );
      if (!cert || !['aprobada', 'pagada'].includes(cert.status)) {
        throw new ConflictException({
          code: 'SUBCONTRACT_CERT_NOT_APPROVED',
          message:
            'No se puede aprobar: la certificación de subcontrata de origen ya no está aprobada',
        });
      }
      const base = Number(invoice.baseAmount);
      if (!amountsMatch(Number(cert.importePeriodo), base)) {
        throw new ConflictException({
          code: 'PURCHASE_INVOICE_BASE_MISMATCH_CERT',
          message: `No se puede aprobar: la base de la factura (${base.toFixed(2)} €) no cuadra con el periodo certificado (${Number(cert.importePeriodo).toFixed(2)} €)`,
        });
      }
    } else if (
      invoice.kind === 'compra' &&
      (await exigirCuadreEnAprobacion(tx, invoice))
    ) {
      // Cuadre a tres bandas por línea (pedido ↔ recepción ↔ factura):
      // sustituye a la regla de albaranes; fuera de tolerancia ya ha lanzado
      // P2P_MATCH_BLOCKED (factura bloqueada para pago).
    } else if (invoice.kind === 'compra') {
      const notes = await tx
        .select()
        .from(deliveryNotes)
        .where(
          and(eq(deliveryNotes.invoiceId, id), isNull(deliveryNotes.deletedAt)),
        );
      if (notes.length === 0) {
        throw new ConflictException({
          code: 'PURCHASE_INVOICE_NO_DELIVERY_NOTES',
          message:
            'No se puede aprobar: la factura de compra no tiene albaranes asociados. Vincula los albaranes validados del proveedor.',
        });
      }
      const notesTotal = sumarImportes(notes.map((n) => Number(n.amount)));
      const base = Number(invoice.baseAmount);
      if (!amountsMatch(notesTotal, base)) {
        throw new ConflictException({
          code: 'PURCHASE_INVOICE_BASE_MISMATCH_NOTES',
          message: `No se puede aprobar: la base de la factura (${base.toFixed(2)} €) no cuadra con la suma de los albaranes (${notesTotal.toFixed(2)} €)`,
        });
      }
      await cambiarEstadoMasivo(
        tx,
        deliveryNotes,
        'delivery_note',
        eq(deliveryNotes.invoiceId, id),
        'validado',
        'facturado',
      );
    }

    await cambiarEstado(
      tx,
      invoices,
      'invoice',
      id,
      'borrador',
      'aprobada',
      {},
      versionEsperada,
    );

    await this.insertMilestones(tx, invoice, contact);
  }

  /**
   * Aprobación de una rectificativa: aplica sus efectos sobre la original
   * dentro de la misma transacción.
   * - total: la original pasa a `rectificada`, se eliminan sus vencimientos
   *   previstos, sus albaranes vuelven a `validado` sin factura y la
   *   certificación de la que procede vuelve a `borrador`. Solo se genera
   *   devolución por lo ya liquidado.
   * - diferencias: la original no cambia; el delta genera sus vencimientos.
   */
  private async aprobarRectificativaEnTx(
    tx: Tx,
    invoice: Invoice,
    contact: Contact,
  ): Promise<void> {
    const kind = invoice.rectificationKind as RectificationKind;
    const [orig] = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoice.rectifiesInvoiceId as string),
          isNull(invoices.deletedAt),
        ),
      )
      .for('update');
    if (!orig) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Factura original no encontrada',
      });
    }
    const bloqueo = invoiceRectifyBlockReason(
      {
        status: orig.status as InvoiceStatus,
        isRectification: orig.rectifiesInvoiceId !== null,
      },
      kind,
    );
    if (bloqueo)
      throw new ConflictException({
        code: 'INVOICE_NOT_RECTIFIABLE',
        message: bloqueo,
      });

    let originalPaid = { ordinario: 0, retencion: 0 };
    if (kind === 'total') {
      // Lo realmente cobrado/pagado es el liquidado acumulado (también el de
      // vencimientos liquidados solo en parte), no los vencimientos cerrados.
      const vencimientos = await tx
        .select({
          id: paymentMilestones.id,
          kind: paymentMilestones.kind,
          amount: paymentMilestones.amount,
          settledAmount: paymentMilestones.settledAmount,
          status: paymentMilestones.status,
          version: paymentMilestones.version,
        })
        .from(paymentMilestones)
        .where(eq(paymentMilestones.invoiceId, orig.id))
        .for('update');
      const suma = (k: string) =>
        fromCents(
          sumCents(
            vencimientos
              .filter((m) => m.kind === k)
              .map((m) => toCents(m.settledAmount)),
          ),
        );
      originalPaid = {
        ordinario: suma('ordinario'),
        retencion: suma('retencion'),
      };

      // Vivos sin liquidar: se borran (la rectificativa cubre su importe).
      // Vivos liquidados en parte: se cierran por lo ya liquidado, para no
      // perder sus liquidaciones; el resto lo cubre la rectificativa.
      for (const m of vencimientos) {
        if (m.status !== 'previsto') continue;
        if (toCents(m.settledAmount) === 0n) {
          await tx
            .delete(paymentMilestones)
            .where(eq(paymentMilestones.id, m.id));
        } else {
          await cambiarEstado(
            tx,
            paymentMilestones,
            'milestone',
            m.id,
            'previsto',
            'pagado',
            { amount: m.settledAmount, paidAt: todayIso() },
            m.version,
          );
        }
      }
      await cambiarEstado(
        tx,
        invoices,
        'invoice',
        orig.id,
        orig.status as InvoiceStatus,
        'rectificada',
      );
      // Los albaranes de una factura aprobada están `facturado`; la
      // certificación de la que procede, `facturada`.
      await cambiarEstadoMasivo(
        tx,
        deliveryNotes,
        'delivery_note',
        eq(deliveryNotes.invoiceId, orig.id),
        'facturado',
        'validado',
        { invoiceId: null },
      );
      await cambiarEstadoMasivo(
        tx,
        certifications,
        'certification',
        eq(certifications.invoiceId, orig.id),
        'facturada',
        'borrador',
        { invoiceId: null },
      );
    }

    const plan = planRectificationMilestones({
      kind: invoice.kind as 'compra' | 'venta',
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: Number(invoice.totalAmount),
      retentionAmount: Number(invoice.retentionAmount),
      retentionReleaseDate: invoice.retentionReleaseDate,
      paymentTermsDays: contact.paymentTermsDays,
      rectificationKind: kind,
      originalPaid,
    });
    // Sin nada pendiente de liquidar, la rectificativa nace liquidada (misma
    // regla que `invoiceStatusFromMilestones`).
    // borrador -> pagada no existe en la máquina de estados: se pasa por
    // `aprobada` (dos transiciones legales en la misma transacción).
    await cambiarEstado(
      tx,
      invoices,
      'invoice',
      invoice.id,
      'borrador',
      'aprobada',
    );
    if (plan.length === 0) {
      await cambiarEstado(
        tx,
        invoices,
        'invoice',
        invoice.id,
        'aprobada',
        'pagada',
      );
    }
    if (plan.length > 0) {
      await tx.insert(paymentMilestones).values(
        plan.map((m) => ({
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          direction: m.direction,
          kind: m.kind,
          dueDate: m.dueDate,
          amount: m.amount.toFixed(2),
        })),
      );
    }
  }

  /**
   * Crea una factura rectificativa en borrador a partir de una aprobada o
   * pagada. Total: líneas derivadas con el signo cambiado. Por diferencias:
   * las líneas del delta que se reciben. Serie automática `R-AAAA-NNNN`.
   */
  async rectify(
    id: string,
    input: InvoiceRectifyInput,
    versionEsperada?: number,
  ): Promise<InvoiceDto> {
    const data = invoiceRectifySchema.parse(input);
    const { invoice } = await this.findWithContact(id);
    verificarVersion(invoice.version, versionEsperada);
    const allowed = await this.dbs.getObrasAccesibles();
    if (
      data.lines &&
      allowed !== null &&
      !hasAllowedProject(
        allowed,
        data.lines.map((l) => l.projectId ?? null),
      )
    ) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    }
    if (data.lines) {
      await this.validarImputaciones(invoice.companyId, data.lines);
    }
    const newId = await this.dbs.db.transaction(async (tx) => {
      const { row } = await this.crearRectificativaEnTx(tx, invoice.id, {
        clase: data.clase,
        issueDate: data.issueDate,
        motivo: data.motivo,
        rectificationMotive: data.rectificationMotive,
        rectificationType: data.rectificationType,
        facturaeReasonCode: data.facturaeReasonCode,
        lines: data.lines,
      });
      await this.audit.registrar(tx, {
        entityType: 'invoice',
        entityId: row.id,
        action: 'create',
        newData: {
          invoiceId: row.id,
          rectifies: id,
          clase: data.clase,
          rectificationMotive: data.rectificationMotive,
          rectificationType: data.rectificationType,
          facturaeReasonCode: data.facturaeReasonCode,
          status: 'borrador',
        },
      });
      return row.id;
    });
    return this.get(newId);
  }

  /**
   * Inserta la rectificativa (borrador) dentro de la transacción recibida.
   * Bloquea la original, comprueba que se puede rectificar y reserva el
   * siguiente número de la serie. Devuelve la fila y el contacto de la
   * original (lo usa `CertificationsService` para aprobarla acto seguido).
   */
  async crearRectificativaEnTx(
    tx: Tx,
    originalId: string,
    p: {
      clase: RectificationKind;
      issueDate: string;
      motivo: string;
      /** Obligatorios al rectificar vía API; null en flujos internos (certificaciones). */
      rectificationMotive?: RectificationMotive | null;
      rectificationType?: RectificationType | null;
      /** Código Facturae: lo elige el titular (API) o lo hereda la certificación; null solo en datos antiguos. */
      facturaeReasonCode?: string | null;
      lines?: InvoiceCreateInput['lines'];
    },
  ): Promise<{ row: Invoice; contact: Contact }> {
    const [orig] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, originalId), isNull(invoices.deletedAt)))
      .for('update');
    if (!orig)
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Factura no encontrada',
      });
    const bloqueo = invoiceRectifyBlockReason(
      {
        status: orig.status as InvoiceStatus,
        isRectification: orig.rectifiesInvoiceId !== null,
      },
      p.clase,
    );
    if (bloqueo)
      throw new ConflictException({
        code: 'INVOICE_NOT_RECTIFIABLE',
        message: bloqueo,
      });

    const existentes = await tx
      .select({
        id: invoices.id,
        status: invoices.status,
        rectificationKind: invoices.rectificationKind,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.rectifiesInvoiceId, orig.id),
          isNull(invoices.deletedAt),
          ne(invoices.status, 'anulada'),
        ),
      );
    if (p.clase === 'total') {
      if (existentes.some((e) => e.rectificationKind === 'total')) {
        throw new ConflictException({
          code: 'INVOICE_ALREADY_RECTIFIED_TOTAL',
          message: 'La factura ya tiene una rectificativa total',
        });
      }
      if (existentes.length > 0) {
        throw new ConflictException({
          code: 'INVOICE_HAS_DIFFERENCE_RECTIFICATIONS',
          message:
            'La factura ya tiene rectificativas por diferencias: no se puede rectificar en total',
        });
      }
    }

    const origLines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, orig.id))
      .orderBy(asc(invoiceLines.sortOrder));
    const lines =
      p.clase === 'total'
        ? buildRectificationLines(
            origLines.map((l) => ({
              description: l.description,
              baseAmount: Number(l.baseAmount),
              vatPct: Number(l.vatPct),
              projectId: l.projectId,
              phaseId: l.phaseId,
              categoryId: l.categoryId,
            })),
          )
        : (p.lines ?? []);

    const invoiceNumber = await this.siguienteNumeroRectificativa(
      tx,
      orig.companyId,
      p.issueDate.slice(0, 4),
    );
    const data = invoiceCreateSchema.parse({
      kind: orig.kind,
      contactId: orig.contactId,
      invoiceNumber,
      issueDate: p.issueDate,
      dueDate: null,
      isp: orig.isp,
      retentionPct: Number(orig.retentionPct),
      retentionReleaseDate: orig.retentionReleaseDate,
      notes:
        `Rectificativa ${p.clase === 'total' ? 'total' : 'por diferencias'} de la factura ${orig.invoiceNumber}: ${p.motivo}`.slice(
          0,
          1000,
        ),
      lines,
      deliveryNoteIds: [],
    });
    const amounts = computeInvoiceAmounts(
      data.lines,
      data.isp,
      data.retentionPct,
    );
    const row = await this.crearEnTx(tx, orig.companyId, data, amounts, {
      invoiceId: orig.id,
      kind: p.clase,
      reason: p.motivo,
      motive: p.rectificationMotive ?? null,
      type: p.rectificationType ?? null,
      facturaeReasonCode: p.facturaeReasonCode ?? null,
    });
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, orig.contactId))
      .limit(1);
    return { row, contact };
  }

  /** Siguiente número libre de la serie `R-AAAA-NNNN` de la empresa. */
  private async siguienteNumeroRectificativa(
    tx: Tx,
    companyId: string,
    year: string,
  ): Promise<string> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${'rectificativa:' + companyId}))`,
    );
    const prefijo = `R-${year}-`;
    // El máximo se calcula en SQL: solo cuentan los números `R-AAAA-<dígitos>`.
    const sufijo = sql`substr(${invoices.invoiceNumber}, ${prefijo.length + 1})`;
    const [fila] = await tx
      .select({ max: sql<string | null>`max((${sufijo})::numeric)` })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          like(invoices.invoiceNumber, `${prefijo}%`),
          sql`${sufijo} ~ '^[0-9]+$'`,
        ),
      );
    const max = fila?.max ? Number(fila.max) : 0;
    return `${prefijo}${String(max + 1).padStart(4, '0')}`;
  }

  /** Marca la factura como pagada/cobrada y liquida sus vencimientos. */
  async markPaid(id: string, versionEsperada?: number): Promise<InvoiceDto> {
    const { invoice } = await this.findWithContact(id);
    verificarVersion(invoice.version, versionEsperada);
    if (invoice.status !== 'aprobada') {
      throw new ConflictException({
        code: 'INVOICE_NOT_APPROVED',
        message: 'Solo se pueden liquidar facturas aprobadas',
      });
    }
    // Igual que pagar un vencimiento desde tesorería: no se paga a un
    // proveedor o subcontrata bloqueado por PRL.
    if (invoice.kind === 'compra') {
      await this.compliance.assertCanTransact(
        invoice.contactId,
        'liquidar el pago',
      );
    }
    await this.dbs.db.transaction(async (tx) => {
      // Bloqueo y revalidación: si una anulación concurrente ganó, 409.
      const [actual] = await tx
        .select({ status: invoices.status, version: invoices.version })
        .from(invoices)
        .where(eq(invoices.id, id))
        .for('update');
      verificarVersion(actual.version, versionEsperada);
      if (actual.status !== 'aprobada') {
        throw new ConflictException(MENSAJE_ESTADO_CAMBIADO);
      }
      const vivos = await tx
        .select({ id: paymentMilestones.id })
        .from(paymentMilestones)
        .where(
          and(
            eq(paymentMilestones.invoiceId, id),
            eq(paymentMilestones.status, 'previsto'),
          ),
        );
      if (vivos.length === 0) {
        await cambiarEstado(tx, invoices, 'invoice', id, 'aprobada', 'pagada');
        return;
      }
      // Cada vencimiento vivo se liquida por su saldo pendiente (con su
      // historial y auditoría); la última liquidación deja la factura pagada.
      const ctx = {
        tx,
        audit: this.audit,
        companyId: this.dbs.getCompanyId(),
        userId: getRequestContext()?.userId ?? null,
      };
      for (const v of vivos) {
        await liquidarPendiente(ctx, v.id, { fecha: todayIso() });
      }
    });
    return this.get(id);
  }

  /**
   * Anula la factura: libera albaranes y elimina vencimientos previstos.
   * Fuera de borrador exige motivo. Una venta aprobada no se anula (se
   * rectifica); una compra aprobada sin pagos sí, con motivo.
   */
  async cancel(
    id: string,
    input: InvoiceCancelInput = {},
    versionEsperada?: number,
  ): Promise<InvoiceDto> {
    const data = invoiceCancelSchema.parse(input ?? {});
    const { invoice } = await this.findWithContact(id);
    verificarVersion(invoice.version, versionEsperada);
    if (invoice.status === 'anulada') {
      return this.get(id);
    }
    if (invoice.rectifiesInvoiceId && invoice.status !== 'borrador') {
      throw new ConflictException({
        code: 'RECTIFICATION_NOT_CANCELLABLE',
        message:
          'Una factura rectificativa aprobada no se anula: emite otra rectificativa por diferencias',
      });
    }
    const paid = await this.dbs.db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.invoiceId, id),
          // Cualquier cobro o pago, también parcial, impide anular.
          sql`${paymentMilestones.settledAmount} <> 0`,
        ),
      )
      .limit(1);
    const bloqueo = invoiceCancelBlockReason({
      kind: invoice.kind as InvoiceKind,
      status: invoice.status as InvoiceStatus,
      hasPaidMilestones: paid.length > 0,
    });
    if (bloqueo)
      throw new ConflictException({
        code: 'INVOICE_NOT_CANCELLABLE',
        message: bloqueo,
      });
    if (invoice.status !== 'borrador' && !data.motivo) {
      throw new BadRequestException({
        code: 'CANCELLATION_REASON_REQUIRED',
        message: 'El motivo de anulación es obligatorio fuera de borrador',
      });
    }
    await this.dbs.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: invoices.status, version: invoices.version })
        .from(invoices)
        .where(eq(invoices.id, id))
        .for('update');
      if (locked) verificarVersion(locked.version, versionEsperada);
      if (!locked || locked.status !== invoice.status) {
        throw new ConflictException({
          code: 'INVOICE_STATE_CHANGED',
          message:
            'La factura ha cambiado de estado: recarga e inténtalo de nuevo',
        });
      }
      await tx
        .delete(paymentMilestones)
        .where(eq(paymentMilestones.invoiceId, id));
      // Albaranes de una factura aprobada (`facturado`) vuelven a `validado`;
      // los de un borrador ya estaban `validado` y solo se desvinculan.
      await cambiarEstadoMasivo(
        tx,
        deliveryNotes,
        'delivery_note',
        eq(deliveryNotes.invoiceId, id),
        'facturado',
        'validado',
        { invoiceId: null },
      );
      await tx
        .update(deliveryNotes)
        .set({
          invoiceId: null,
          updatedAt: new Date(),
          version: incrementarVersion(deliveryNotes),
        })
        .where(eq(deliveryNotes.invoiceId, id));
      await cambiarEstado(
        tx,
        invoices,
        'invoice',
        id,
        locked.status as InvoiceStatus,
        'anulada',
        { cancelReason: data.motivo ?? null },
        versionEsperada,
      );
      await this.audit.registrar(tx, {
        entityType: 'invoice',
        entityId: id,
        action: 'update',
        newData: { status: 'anulada', motivo: data.motivo ?? null },
      });
    });
    return this.get(id);
  }

  /** Borrado lógico; solo borradores (lo demás se anula, no se borra). */
  async remove(id: string, versionEsperada?: number): Promise<void> {
    const { invoice } = await this.findWithContact(id);
    verificarVersion(invoice.version, versionEsperada);
    if (invoice.status !== 'borrador') {
      throw new ConflictException({
        code: 'INVOICE_NOT_DRAFT',
        message: 'Solo se pueden eliminar borradores',
      });
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(deliveryNotes)
        .set({
          invoiceId: null,
          updatedAt: new Date(),
          version: incrementarVersion(deliveryNotes),
        })
        .where(eq(deliveryNotes.invoiceId, id));
      // Borrado lógico solo de borradores: la condición va en el UPDATE para
      // que una aprobación concurrente no deje una factura aprobada borrada.
      const borradas = await tx
        .update(invoices)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: incrementarVersion(invoices),
        })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.status, 'borrador'),
            condicionVersion(invoices, versionEsperada),
          ),
        )
        .returning({ id: invoices.id });
      if (borradas.length === 0) {
        await falloActualizacion(
          tx,
          invoices,
          id,
          versionEsperada,
          () => new ConflictException(MENSAJE_ESTADO_CAMBIADO),
          'Factura no encontrada',
        );
      }
    });
  }

  /* ────────────────────────── privados ────────────────────────── */

  private async insertMilestones(
    tx: Tx,
    invoice: Invoice,
    contact: Contact,
  ): Promise<void> {
    // El reparto (ordinario + retención diferida) vive en @erp/shared para
    // poder comprobarlo con tests sin base de datos.
    const plan = planMilestones({
      kind: invoice.kind as 'compra' | 'venta',
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: Number(invoice.totalAmount),
      retentionAmount: Number(invoice.retentionAmount),
      retentionReleaseDate: invoice.retentionReleaseDate,
      paymentTermsDays: contact.paymentTermsDays,
    });
    if (plan.length > 0) {
      await tx.insert(paymentMilestones).values(
        plan.map((m) => ({
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          direction: m.direction,
          kind: m.kind,
          dueDate: m.dueDate,
          amount: m.amount.toFixed(2),
        })),
      );
    }
  }

  /**
   * Una rectificativa en borrador no se reescribe a mano: contacto, número,
   * ISP y retención se heredan de la original, y en las totales las líneas
   * son el espejo de la original (solo las de diferencias admiten líneas).
   */
  private rechazarEdicionRectificativa(
    invoice: Invoice,
    data: ReturnType<typeof invoiceUpdateSchema.parse>,
  ): void {
    if (!invoice.rectifiesInvoiceId) return;
    const prohibidos: string[] = [];
    if (data.contactId !== undefined) prohibidos.push('el contacto');
    if (data.invoiceNumber !== undefined) prohibidos.push('el número');
    if (data.isp !== undefined)
      prohibidos.push('la inversión del sujeto pasivo');
    if (data.retentionPct !== undefined) prohibidos.push('la retención');
    if (data.lines !== undefined && invoice.rectificationKind === 'total') {
      prohibidos.push('las líneas de una rectificativa total');
    }
    if (prohibidos.length > 0) {
      throw new BadRequestException({
        code: 'RECTIFICATION_INHERITED_FIELDS',
        message: `En una factura rectificativa no se puede modificar ${prohibidos.join(', ')}: se heredan de la original`,
      });
    }
  }

  /**
   * Obra, fase y categoría de las líneas deben ser de la empresa (404 si
   * alguna no existe en ella). Las FK solas no distinguen empresas.
   */
  private async validarImputaciones(
    companyId: string,
    lines: ReadonlyArray<{
      projectId?: string | null;
      phaseId?: string | null;
      categoryId?: string | null;
    }>,
  ): Promise<void> {
    const unicos = (xs: Array<string | null | undefined>) => [
      ...new Set(xs.filter((x): x is string => !!x)),
    ];
    const obras = unicos(lines.map((l) => l.projectId));
    const fases = unicos(lines.map((l) => l.phaseId));
    const cats = unicos(lines.map((l) => l.categoryId));
    if (obras.length > 0) {
      const found = await this.dbs.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            inArray(projects.id, obras),
            eq(projects.companyId, companyId),
            isNull(projects.deletedAt),
          ),
        );
      if (found.length !== obras.length) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Obra no encontrada',
        });
      }
    }
    if (fases.length > 0) {
      const found = await this.dbs.db
        .select({ id: projectPhases.id })
        .from(projectPhases)
        .where(
          and(
            inArray(projectPhases.id, fases),
            eq(projectPhases.companyId, companyId),
            isNull(projectPhases.deletedAt),
          ),
        );
      if (found.length !== fases.length) {
        throw new NotFoundException({
          code: 'PHASE_NOT_FOUND',
          message: 'Fase no encontrada',
        });
      }
    }
    if (cats.length > 0) {
      const found = await this.dbs.db
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            inArray(categories.id, cats),
            eq(categories.companyId, companyId),
          ),
        );
      if (found.length !== cats.length) {
        throw new NotFoundException({
          code: 'CATEGORY_NOT_FOUND',
          message: 'Categoría no encontrada',
        });
      }
    }
  }

  private async linkDeliveryNotes(
    tx: Tx,
    invoiceId: string,
    contactId: string,
    noteIds: string[],
  ): Promise<void> {
    const companyId = await this.dbs.getCompanyId();
    const notes = await tx
      .select()
      .from(deliveryNotes)
      .where(
        and(
          inArray(deliveryNotes.id, noteIds),
          eq(deliveryNotes.companyId, companyId),
          isNull(deliveryNotes.deletedAt),
        ),
      );
    if (notes.length !== noteIds.length) {
      throw new NotFoundException({
        code: 'DELIVERY_NOTE_NOT_FOUND',
        message: 'Algún albarán seleccionado no existe',
      });
    }
    for (const note of notes) {
      if (note.contactId !== contactId) {
        throw new ConflictException({
          code: 'DELIVERY_NOTE_OTHER_SUPPLIER',
          message: `El albarán ${note.noteNumber} pertenece a otro proveedor`,
        });
      }
      if (note.status !== 'validado' || note.invoiceId !== null) {
        throw new ConflictException({
          code: 'DELIVERY_NOTE_NOT_AVAILABLE',
          message: `El albarán ${note.noteNumber} no está validado y libre: no se puede puntear`,
        });
      }
    }
    await tx
      .update(deliveryNotes)
      .set({
        invoiceId,
        updatedAt: new Date(),
        version: incrementarVersion(deliveryNotes),
      })
      .where(inArray(deliveryNotes.id, noteIds));
  }

  private async loadLines(
    invoiceIds: string[],
  ): Promise<(InvoiceLineDto & { invoiceId: string })[]> {
    if (invoiceIds.length === 0) return [];
    const rows = await this.dbs.db
      .select({
        line: invoiceLines,
        projectCode: projects.code,
        phaseCode: projectPhases.code,
      })
      .from(invoiceLines)
      .leftJoin(projects, eq(invoiceLines.projectId, projects.id))
      .leftJoin(projectPhases, eq(invoiceLines.phaseId, projectPhases.id))
      .where(inArray(invoiceLines.invoiceId, invoiceIds))
      .orderBy(asc(invoiceLines.sortOrder));
    return rows.map(({ line, projectCode, phaseCode }) => ({
      invoiceId: line.invoiceId,
      id: line.id,
      description: line.description,
      baseAmount: Number(line.baseAmount),
      vatPct: Number(line.vatPct),
      projectId: line.projectId,
      projectCode,
      phaseId: line.phaseId,
      phaseCode,
      categoryId: line.categoryId,
      purchaseOrderLineId: line.purchaseOrderLineId,
      quantity: line.quantity === null ? null : Number(line.quantity),
      unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
    }));
  }

  private async toDtos(
    rows: { invoice: Invoice; contactName: string }[],
  ): Promise<InvoiceDto[]> {
    const ids = rows.map((r) => r.invoice.id);
    const lines = await this.loadLines(ids);

    const noteRows =
      ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              id: deliveryNotes.id,
              noteNumber: deliveryNotes.noteNumber,
              amount: deliveryNotes.amount,
              invoiceId: deliveryNotes.invoiceId,
            })
            .from(deliveryNotes)
            .where(
              and(
                inArray(deliveryNotes.invoiceId, ids),
                isNull(deliveryNotes.deletedAt),
              ),
            );

    const certRows =
      ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              id: certifications.id,
              invoiceId: certifications.invoiceId,
            })
            .from(certifications)
            .where(
              and(
                inArray(certifications.invoiceId, ids),
                isNull(certifications.deletedAt),
              ),
            );
    const certByInvoice = new Map(certRows.map((c) => [c.invoiceId, c.id]));

    const rectifiedByRows =
      ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              id: invoices.id,
              rectifiesInvoiceId: invoices.rectifiesInvoiceId,
            })
            .from(invoices)
            .where(
              and(
                inArray(invoices.rectifiesInvoiceId, ids),
                isNull(invoices.deletedAt),
                ne(invoices.status, 'anulada'),
              ),
            );
    const originalIds = [
      ...new Set(
        rows
          .map((r) => r.invoice.rectifiesInvoiceId)
          .filter((x): x is string => x !== null),
      ),
    ];
    const originalRows =
      originalIds.length === 0
        ? []
        : await this.dbs.db
            .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
            .from(invoices)
            .where(inArray(invoices.id, originalIds));
    const numberById = new Map(
      originalRows.map((o) => [o.id, o.invoiceNumber]),
    );

    return rows.map(({ invoice, contactName }) => {
      const total = Number(invoice.totalAmount);
      const retention = Number(invoice.retentionAmount);
      return {
        id: invoice.id,
        version: invoice.version,
        kind: invoice.kind as InvoiceDto['kind'],
        status: invoice.status as InvoiceDto['status'],
        contactId: invoice.contactId,
        contactName,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        baseAmount: Number(invoice.baseAmount),
        vatAmount: Number(invoice.vatAmount),
        totalAmount: total,
        isp: invoice.isp,
        retentionPct: Number(invoice.retentionPct),
        retentionAmount: retention,
        payableAmount: payableAmount(total, retention),
        retentionReleaseDate: invoice.retentionReleaseDate,
        certificationId: certByInvoice.get(invoice.id) ?? null,
        rectifiesInvoiceId: invoice.rectifiesInvoiceId,
        rectifiesInvoiceNumber: invoice.rectifiesInvoiceId
          ? (numberById.get(invoice.rectifiesInvoiceId) ?? null)
          : null,
        rectificationKind:
          invoice.rectificationKind as InvoiceDto['rectificationKind'],
        rectificationReason: invoice.rectificationReason,
        rectificationMotive:
          invoice.rectificationMotive as InvoiceDto['rectificationMotive'],
        rectificationType:
          invoice.rectificationType as InvoiceDto['rectificationType'],
        facturaeReasonCode: invoice.facturaeReasonCode,
        rectifiedByInvoiceIds: rectifiedByRows
          .filter((r) => r.rectifiesInvoiceId === invoice.id)
          .map((r) => r.id),
        cancelReason: invoice.cancelReason,
        notes: invoice.notes,
        lines: lines
          .filter((l) => l.invoiceId === invoice.id)
          .map(({ invoiceId: _invoiceId, ...rest }) => rest),
        deliveryNotes: noteRows
          .filter((n) => n.invoiceId === invoice.id)
          .map((n) => ({
            id: n.id,
            noteNumber: n.noteNumber,
            amount: Number(n.amount),
          })),
        verifactuStatus:
          invoice.verifactuStatus as InvoiceDto['verifactuStatus'],
        facturaeXsdStatus:
          invoice.facturaeXsdStatus as InvoiceDto['facturaeXsdStatus'],
        certSubcontrataId: invoice.certSubcontrataId,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      };
    });
  }

  private async findWithContact(
    id: string,
  ): Promise<{ invoice: Invoice; contactName: string }> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ invoice: invoices, contactName: contacts.legalName })
      .from(invoices)
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.companyId, companyId),
          isNull(invoices.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Factura no encontrada',
      });
    }
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      const lines = await this.dbs.db
        .select({ projectId: invoiceLines.projectId })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, id));
      if (
        !hasAllowedProject(
          allowed,
          lines.map((l) => l.projectId),
        )
      ) {
        throw new NotFoundException({
          code: 'INVOICE_NOT_FOUND',
          message: 'Factura no encontrada',
        });
      }
    }
    return row;
  }

  /** IDs de factura con al menos una línea imputada a una de las obras dadas. */
  private async invoiceIdsForProjects(projectIds: string[]): Promise<string[]> {
    const rows = await this.dbs.db
      .selectDistinct({ invoiceId: invoiceLines.invoiceId })
      .from(invoiceLines)
      .where(inArray(invoiceLines.projectId, projectIds));
    return rows.map((r) => r.invoiceId);
  }

  private async findContact(contactId: string): Promise<Contact> {
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
    if (!row) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contacto no encontrado',
      });
    }
    return row;
  }

  private rethrowDuplicateNumber(err: unknown, num: string): never {
    if (
      err instanceof Error &&
      'constraint' in err &&
      (err as { constraint?: string }).constraint ===
        'invoices_rectifies_total_unique'
    ) {
      throw new ConflictException({
        code: 'INVOICE_ALREADY_RECTIFIED_TOTAL',
        message: 'La factura ya tiene una rectificativa total',
      });
    }
    if (
      err instanceof Error &&
      'constraint' in err &&
      (err as { constraint?: string }).constraint ===
        'invoices_cert_subcontrata_activa_unique'
    ) {
      throw new ConflictException({
        code: 'SUBCONTRACT_CERT_ALREADY_INVOICED',
        message:
          'La certificación de subcontrata ya tiene una factura de compra activa',
      });
    }
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException({
        code: 'INVOICE_NUMBER_DUPLICATED',
        message: `Ya existe una factura con el número "${num}" para ese contacto`,
      });
    }
    throw err;
  }
}
