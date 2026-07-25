import {
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
  isNull,
  or,
  SQL,
} from 'drizzle-orm';
import {
  Contact,
  Db,
  Invoice,
  certifications,
  contacts,
  deliveryNotes,
  invoiceLines,
  invoices,
  paymentMilestones,
  projectPhases,
  projects,
} from '@erp/db';
import {
  InvoiceCreateInput,
  InvoiceDto,
  InvoiceKind,
  InvoiceLineDto,
  InvoiceStatus,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  InvoiceUpdateInput,
} from '@erp/shared';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';

/** Cliente de transacción de drizzle (el callback de db.transaction). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const round2 = (n: number) => Math.round(n * 100) / 100;
const UNIQUE_VIOLATION = '23505';
/** Tolerancia de cuadre factura ↔ albaranes (céntimos de redondeo). */
const MATCHING_TOLERANCE = 0.01;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface ComputedAmounts {
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  retentionAmount: number;
}

function computeAmounts(
  lines: { baseAmount: number; vatPct: number }[],
  isp: boolean,
  retentionPct: number,
): ComputedAmounts {
  const baseAmount = round2(lines.reduce((s, l) => s + l.baseAmount, 0));
  // ISP: el IVA lo autoliquida el destinatario ⇒ cuota 0 en la factura
  const vatAmount = isp
    ? 0
    : round2(lines.reduce((s, l) => s + (l.baseAmount * l.vatPct) / 100, 0));
  const totalAmount = round2(baseAmount + vatAmount);
  const retentionAmount = round2((baseAmount * retentionPct) / 100);
  return { baseAmount, vatAmount, totalAmount, retentionAmount };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly dbs: DbService,
    private readonly compliance: ComplianceService,
  ) {}

  async list(
    kind?: InvoiceKind,
    status?: InvoiceStatus,
    search?: string,
  ): Promise<InvoiceDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(invoices.companyId, companyId),
      isNull(invoices.deletedAt),
    ];
    if (kind) filters.push(eq(invoices.kind, kind));
    if (status) filters.push(eq(invoices.status, status));
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      filters.push(
        or(
          ilike(invoices.invoiceNumber, term),
          ilike(contacts.legalName, term),
        ) as SQL,
      );
    }
    const rows = await this.dbs.db
      .select({ invoice: invoices, contactName: contacts.legalName })
      .from(invoices)
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(and(...filters))
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));
    return this.toDtos(rows);
  }

  async get(id: string): Promise<InvoiceDto> {
    const row = await this.findWithContact(id);
    const [dto] = await this.toDtos([row]);
    return dto;
  }

  async create(input: InvoiceCreateInput): Promise<InvoiceDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = invoiceCreateSchema.parse(input);
    await this.findContact(data.contactId);
    const amounts = computeAmounts(data.lines, data.isp, data.retentionPct);

    const invoiceId = await this.dbs.db.transaction(async (tx) => {
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
          })
          .returning();
      } catch (err) {
        this.rethrowDuplicateNumber(err, data.invoiceNumber);
      }
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
      return row.id;
    });
    return this.get(invoiceId);
  }

  /** Solo se puede editar una factura en borrador. */
  async update(id: string, input: InvoiceUpdateInput): Promise<InvoiceDto> {
    const { invoice } = await this.findWithContact(id);
    if (invoice.status !== 'borrador') {
      throw new ConflictException(
        'Solo se pueden editar facturas en borrador; anúlala si necesitas corregirla',
      );
    }
    const data = invoiceUpdateSchema.parse(input);

    const lines =
      data.lines ??
      (await this.loadLines([id])).map((l) => ({
        description: l.description,
        baseAmount: l.baseAmount,
        vatPct: l.vatPct,
        projectId: l.projectId,
        phaseId: l.phaseId,
        categoryId: l.categoryId,
      }));
    const isp = data.isp ?? invoice.isp;
    const retentionPct = data.retentionPct ?? Number(invoice.retentionPct);
    const amounts = computeAmounts(
      lines.map((l) => ({
        baseAmount: l.baseAmount,
        vatPct: l.vatPct ?? 21,
      })),
      isp,
      retentionPct,
    );

    await this.dbs.db.transaction(async (tx) => {
      try {
        await tx
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
            isp,
            retentionPct: retentionPct.toFixed(2),
            baseAmount: amounts.baseAmount.toFixed(2),
            vatAmount: amounts.vatAmount.toFixed(2),
            totalAmount: amounts.totalAmount.toFixed(2),
            retentionAmount: amounts.retentionAmount.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, id));
      } catch (err) {
        this.rethrowDuplicateNumber(err, data.invoiceNumber ?? '');
      }
      if (data.lines) {
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
          })),
        );
      }
      if (data.deliveryNoteIds) {
        // Relink completo: soltar los actuales y vincular los nuevos
        await tx
          .update(deliveryNotes)
          .set({ invoiceId: null, updatedAt: new Date() })
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
  async approve(id: string): Promise<InvoiceDto> {
    const { invoice } = await this.findWithContact(id);
    if (invoice.status !== 'borrador') {
      throw new ConflictException('Solo se aprueban facturas en borrador');
    }
    const contact = await this.findContact(invoice.contactId);

    // Homologación PRL: no se aprueba gasto a una subcontrata sin la
    // documentación al día (responsabilidad solidaria del contratista).
    if (invoice.kind === 'compra') {
      await this.compliance.assertCanTransact(
        invoice.contactId,
        'aprobar la factura',
      );
    }

    await this.dbs.db.transaction(async (tx) => {
      if (invoice.kind === 'compra') {
        const notes = await tx
          .select()
          .from(deliveryNotes)
          .where(
            and(
              eq(deliveryNotes.invoiceId, id),
              isNull(deliveryNotes.deletedAt),
            ),
          );
        if (notes.length === 0) {
          throw new ConflictException(
            'No se puede aprobar: la factura de compra no tiene albaranes asociados. Vincula los albaranes validados del proveedor.',
          );
        }
        const notesTotal = round2(
          notes.reduce((s, n) => s + Number(n.amount), 0),
        );
        const base = Number(invoice.baseAmount);
        if (Math.abs(notesTotal - base) > MATCHING_TOLERANCE) {
          throw new ConflictException(
            `No se puede aprobar: la base de la factura (${base.toFixed(2)} €) no cuadra con la suma de los albaranes (${notesTotal.toFixed(2)} €)`,
          );
        }
        await tx
          .update(deliveryNotes)
          .set({ status: 'facturado', updatedAt: new Date() })
          .where(eq(deliveryNotes.invoiceId, id));
      }

      await tx
        .update(invoices)
        .set({ status: 'aprobada', updatedAt: new Date() })
        .where(eq(invoices.id, id));

      await this.insertMilestones(tx, invoice, contact);
    });
    return this.get(id);
  }

  /** Marca la factura como pagada/cobrada y liquida sus vencimientos. */
  async markPaid(id: string): Promise<InvoiceDto> {
    const { invoice } = await this.findWithContact(id);
    if (invoice.status !== 'aprobada') {
      throw new ConflictException(
        'Solo se pueden liquidar facturas aprobadas',
      );
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(invoices)
        .set({ status: 'pagada', updatedAt: new Date() })
        .where(eq(invoices.id, id));
      await tx
        .update(paymentMilestones)
        .set({ status: 'pagado', paidAt: todayIso(), updatedAt: new Date() })
        .where(
          and(
            eq(paymentMilestones.invoiceId, id),
            eq(paymentMilestones.status, 'previsto'),
          ),
        );
    });
    return this.get(id);
  }

  /** Anula la factura: libera albaranes y elimina vencimientos previstos. */
  async cancel(id: string): Promise<InvoiceDto> {
    const { invoice } = await this.findWithContact(id);
    if (invoice.status === 'anulada') {
      return this.get(id);
    }
    const paid = await this.dbs.db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.invoiceId, id),
          eq(paymentMilestones.status, 'pagado'),
        ),
      )
      .limit(1);
    if (paid.length > 0) {
      throw new ConflictException(
        'No se puede anular: tiene vencimientos ya liquidados',
      );
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .delete(paymentMilestones)
        .where(eq(paymentMilestones.invoiceId, id));
      await tx
        .update(deliveryNotes)
        .set({ invoiceId: null, status: 'validado', updatedAt: new Date() })
        .where(eq(deliveryNotes.invoiceId, id));
      await tx
        .update(invoices)
        .set({ status: 'anulada', updatedAt: new Date() })
        .where(eq(invoices.id, id));
    });
    return this.get(id);
  }

  /** Borrado lógico; solo borradores (lo demás se anula, no se borra). */
  async remove(id: string): Promise<void> {
    const { invoice } = await this.findWithContact(id);
    if (invoice.status !== 'borrador') {
      throw new ConflictException('Solo se pueden eliminar borradores');
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(deliveryNotes)
        .set({ invoiceId: null, updatedAt: new Date() })
        .where(eq(deliveryNotes.invoiceId, id));
      await tx
        .update(invoices)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(invoices.id, id));
    });
  }

  /* ────────────────────────── privados ────────────────────────── */

  private async insertMilestones(
    tx: Tx,
    invoice: Invoice,
    contact: Contact,
  ): Promise<void> {
    const direction = invoice.kind === 'compra' ? 'pago' : 'cobro';
    const total = Number(invoice.totalAmount);
    const retention = Number(invoice.retentionAmount);
    const ordinary = round2(total - retention);
    const ordinaryDue =
      invoice.dueDate ?? addDays(invoice.issueDate, contact.paymentTermsDays);

    const values = [];
    if (ordinary !== 0) {
      values.push({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        direction: direction as 'cobro' | 'pago',
        kind: 'ordinario' as const,
        dueDate: ordinaryDue,
        amount: ordinary.toFixed(2),
      });
    }
    if (retention > 0) {
      // La retención de garantía queda como cuenta a cobrar/pagar diferida
      values.push({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        direction: direction as 'cobro' | 'pago',
        kind: 'retencion' as const,
        dueDate:
          invoice.retentionReleaseDate ?? addDays(invoice.issueDate, 365),
        amount: retention.toFixed(2),
      });
    }
    if (values.length > 0) {
      await tx.insert(paymentMilestones).values(values);
    }
  }

  private async linkDeliveryNotes(
    tx: Tx,
    invoiceId: string,
    contactId: string,
    noteIds: string[],
  ): Promise<void> {
    const notes = await tx
      .select()
      .from(deliveryNotes)
      .where(
        and(
          inArray(deliveryNotes.id, noteIds),
          isNull(deliveryNotes.deletedAt),
        ),
      );
    if (notes.length !== noteIds.length) {
      throw new NotFoundException('Algún albarán seleccionado no existe');
    }
    for (const note of notes) {
      if (note.contactId !== contactId) {
        throw new ConflictException(
          `El albarán ${note.noteNumber} pertenece a otro proveedor`,
        );
      }
      if (note.status !== 'validado' || note.invoiceId !== null) {
        throw new ConflictException(
          `El albarán ${note.noteNumber} no está validado y libre: no se puede puntear`,
        );
      }
    }
    await tx
      .update(deliveryNotes)
      .set({ invoiceId, updatedAt: new Date() })
      .where(inArray(deliveryNotes.id, noteIds));
  }

  private async loadLines(invoiceIds: string[]): Promise<
    (InvoiceLineDto & { invoiceId: string })[]
  > {
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

    return rows.map(({ invoice, contactName }) => {
      const total = Number(invoice.totalAmount);
      const retention = Number(invoice.retentionAmount);
      return {
        id: invoice.id,
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
        payableAmount: round2(total - retention),
        retentionReleaseDate: invoice.retentionReleaseDate,
        certificationId: certByInvoice.get(invoice.id) ?? null,
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
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      };
    });
  }

  private async findWithContact(
    id: string,
  ): Promise<{ invoice: Invoice; contactName: string }> {
    const [row] = await this.dbs.db
      .select({ invoice: invoices, contactName: contacts.legalName })
      .from(invoices)
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Factura no encontrada');
    }
    return row;
  }

  private async findContact(contactId: string): Promise<Contact> {
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Contacto no encontrado');
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
        `Ya existe una factura con el número "${num}" para ese contacto`,
      );
    }
    throw err;
  }
}
