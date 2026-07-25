import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, SQL } from 'drizzle-orm';
import {
  Document,
  Extraction,
  contacts,
  documents,
  extractions,
  projects,
} from '@erp/db';
import {
  DocStatus,
  ExtractionConfidence,
  ExtractionDto,
  ExtractionPayload,
  ExtractionValidateInput,
  ValidationItemDto,
  ValidationResultDto,
  extractionValidateSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ExtractionService } from './extraction.service';

function toExtractionDto(row: Extraction): ExtractionDto {
  return {
    id: row.id,
    documentId: row.documentId,
    model: row.model,
    payload: row.payload as ExtractionPayload,
    confidence: row.confidence as ExtractionConfidence,
    warnings: (row.warnings as string[]) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ValidationService {
  constructor(
    private readonly dbs: DbService,
    private readonly extraction: ExtractionService,
    private readonly invoices: InvoicesService,
  ) {}

  /**
   * Bandeja de validación: documentos leídos por la IA pendientes de que un
   * humano confirme. Cada fila trae la última extracción y las sugerencias de
   * contacto (por NIF) y obra (por código) para que validar sea un clic.
   */
  async pending(status?: DocStatus): Promise<ValidationItemDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(documents.companyId, companyId),
      isNull(documents.deletedAt),
    ];
    filters.push(
      status
        ? eq(documents.status, status)
        : inArray(documents.status, ['extraido', 'procesando', 'error']),
    );

    const docs = await this.dbs.db
      .select()
      .from(documents)
      .where(and(...filters))
      .orderBy(desc(documents.createdAt));
    if (docs.length === 0) return [];

    const latest = await this.latestByDocument(docs.map((d) => d.id));
    const items: ValidationItemDto[] = [];

    for (const doc of docs) {
      const row = latest.get(doc.id);
      const payload = row ? (row.payload as ExtractionPayload) : null;
      const contact = payload?.issuerTaxId
        ? await this.findContactByTaxId(companyId, payload.issuerTaxId)
        : null;
      const project = payload?.projectHint
        ? await this.findProjectByHint(companyId, payload.projectHint)
        : null;

      items.push({
        documentId: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        status: doc.status,
        projectId: doc.projectId,
        createdAt: doc.createdAt.toISOString(),
        extraction: row ? toExtractionDto(row) : null,
        suggestedContactId: contact?.id ?? null,
        suggestedContactName: contact?.legalName ?? null,
        suggestedProjectId: project?.id ?? null,
        suggestedProjectCode: project?.code ?? null,
      });
    }
    return items;
  }

  /** Relanza la lectura de un documento (por ejemplo tras un error). */
  async reprocess(documentId: string): Promise<void> {
    const doc = await this.findDocument(documentId);
    if (!this.extraction.enabled) {
      throw new BadRequestException(
        'El pipeline OCR/IA está desactivado: falta ANTHROPIC_API_KEY en el .env',
      );
    }
    await this.extraction.extract(doc);
  }

  /**
   * El humano confirma lo leído. Marca el documento como validado y, si se
   * pide, crea la factura de compra en borrador con los datos corregidos.
   */
  async validate(
    documentId: string,
    input: ExtractionValidateInput,
  ): Promise<ValidationResultDto> {
    const doc = await this.findDocument(documentId);
    const data = extractionValidateSchema.parse(input);
    const [latest] = await this.dbs.db
      .select()
      .from(extractions)
      .where(eq(extractions.documentId, documentId))
      .orderBy(desc(extractions.createdAt))
      .limit(1);
    if (!latest) {
      throw new BadRequestException(
        'Este documento todavía no tiene ninguna lectura de la IA',
      );
    }
    const payload = latest.payload as ExtractionPayload;

    let invoiceId: string | null = null;
    if (data.createInvoice) {
      invoiceId = await this.createInvoiceFrom(doc, payload, data);
    }

    await this.dbs.db
      .update(documents)
      .set({
        status: 'validado',
        ...(data.projectId !== undefined && { projectId: data.projectId }),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    return {
      documentId,
      status: 'validado',
      invoiceId,
      message: invoiceId
        ? 'Documento validado y factura creada en borrador'
        : 'Documento validado',
    };
  }

  /** Descarta el documento: no es un gasto contable o la lectura no sirve. */
  async reject(documentId: string): Promise<void> {
    await this.findDocument(documentId);
    await this.dbs.db
      .update(documents)
      .set({ status: 'rechazado', updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  }

  private async createInvoiceFrom(
    doc: Document,
    payload: ExtractionPayload,
    data: ReturnType<typeof extractionValidateSchema.parse>,
  ): Promise<string> {
    const contactId = data.contactId ?? null;
    if (!contactId) {
      throw new BadRequestException(
        'Para crear la factura hay que indicar el proveedor. Si no existe, créalo antes en Contactos.',
      );
    }
    const invoiceNumber = data.invoiceNumber ?? payload.invoiceNumber;
    const issueDate = data.issueDate ?? payload.issueDate;
    const baseAmount = data.baseAmount ?? payload.baseAmount;
    const vatAmount = data.vatAmount ?? payload.vatAmount;
    if (!invoiceNumber || !issueDate || baseAmount === null) {
      throw new BadRequestException(
        'Faltan datos para crear la factura: número, fecha de emisión y base imponible son obligatorios',
      );
    }

    // La base manda: el % de IVA se deduce de la cuota leída para no perder
    // céntimos con tipos poco habituales (4, 5, 10, 21…).
    const vatPct =
      baseAmount > 0 && vatAmount !== null
        ? Math.round(((vatAmount / baseAmount) * 100 + Number.EPSILON) * 100) /
          100
        : 21;

    const invoice = await this.invoices.create({
      kind: payload.docType === 'factura_venta' ? 'venta' : 'compra',
      contactId,
      invoiceNumber,
      issueDate,
      isp: vatAmount === 0,
      retentionPct: 0,
      notes: `Creada desde el documento "${doc.fileName}" leído por IA`,
      lines: [
        {
          description: payload.summary || doc.fileName,
          baseAmount,
          vatPct,
          projectId: data.projectId ?? doc.projectId ?? null,
          categoryId: data.categoryId ?? null,
        },
      ],
      deliveryNoteIds: [],
    });
    return invoice.id;
  }

  private async latestByDocument(
    ids: string[],
  ): Promise<Map<string, Extraction>> {
    const rows = await this.dbs.db
      .select()
      .from(extractions)
      .where(inArray(extractions.documentId, ids))
      .orderBy(desc(extractions.createdAt));
    const map = new Map<string, Extraction>();
    for (const row of rows) {
      if (!map.has(row.documentId)) map.set(row.documentId, row);
    }
    return map;
  }

  private async findContactByTaxId(companyId: string, taxId: string) {
    const [row] = await this.dbs.db
      .select({ id: contacts.id, legalName: contacts.legalName })
      .from(contacts)
      .where(
        and(
          eq(contacts.companyId, companyId),
          eq(contacts.taxId, taxId.toUpperCase().replace(/[\s-]/g, '')),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** La pista puede ser el código exacto o un texto que lo contenga. */
  private async findProjectByHint(companyId: string, hint: string) {
    const rows = await this.dbs.db
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), isNull(projects.deletedAt)));
    const needle = hint.toUpperCase();
    return (
      rows.find((p) => p.code.toUpperCase() === needle) ??
      rows.find((p) => needle.includes(p.code.toUpperCase())) ??
      null
    );
  }

  private async findDocument(id: string): Promise<Document> {
    const [row] = await this.dbs.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Documento no encontrado');
    }
    return row;
  }
}
