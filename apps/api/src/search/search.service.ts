import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { contacts, documents, invoiceLines, invoices } from '@erp/db';
import { SEARCH_MIN_QUERY_LENGTH, SearchResultDto } from '@erp/shared';
import { DbService } from '../db/db.service';

/** Umbral de `similarity()` de `pg_trgm` (0-1) — por debajo, ruido. */
const SIMILARITY_THRESHOLD = 0.15;
const MAX_RESULTS_PER_TYPE = 10;

@Injectable()
export class SearchService {
  constructor(private readonly dbs: DbService) {}

  async search(query: string): Promise<SearchResultDto[]> {
    const q = query.trim();
    if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];

    const companyId = this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && allowed.length === 0) return [];

    const [documentResults, invoiceResults] = await Promise.all([
      this.searchDocuments(companyId, allowed, q),
      this.searchInvoices(companyId, allowed, q),
    ]);
    return [...documentResults, ...invoiceResults].sort(
      (a, b) => b.score - a.score,
    );
  }

  private async searchDocuments(
    companyId: string,
    allowed: string[] | null,
    q: string,
  ): Promise<SearchResultDto[]> {
    const score = sql<number>`similarity(${documents.fileName}, ${q})`;
    const filters = [
      eq(documents.companyId, companyId),
      isNull(documents.deletedAt),
      gt(score, SIMILARITY_THRESHOLD),
    ];
    // Un documento sin obra asignada tampoco es visible para el rol `obra`
    // — mismo criterio que `isProjectAllowed` (packages/shared/src/access.ts).
    if (allowed !== null) filters.push(inArray(documents.projectId, allowed));

    const rows = await this.dbs.db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        docType: documents.docType,
        score,
      })
      .from(documents)
      .where(and(...filters))
      .orderBy(desc(score))
      .limit(MAX_RESULTS_PER_TYPE);

    return rows.map((r) => ({
      type: 'documento' as const,
      id: r.id,
      title: r.fileName,
      subtitle: r.docType ?? 'Documento',
      link: '/documentos',
      score: Number(r.score),
    }));
  }

  private async searchInvoices(
    companyId: string,
    allowed: string[] | null,
    q: string,
  ): Promise<SearchResultDto[]> {
    const numberScore = sql<number>`similarity(${invoices.invoiceNumber}, ${q})`;
    const notesScore = sql<number>`similarity(coalesce(${invoices.notes}, ''), ${q})`;
    const contactScore = sql<number>`similarity(${contacts.legalName}, ${q})`;
    const bestScore = sql<number>`greatest(${numberScore}, ${notesScore}, ${contactScore})`;

    const filters = [
      eq(invoices.companyId, companyId),
      isNull(invoices.deletedAt),
      gt(bestScore, SIMILARITY_THRESHOLD),
    ];
    if (allowed !== null) {
      const invoiceIds = await this.invoiceIdsForProjects(allowed);
      if (invoiceIds.length === 0) return [];
      filters.push(inArray(invoices.id, invoiceIds));
    }

    const rows = await this.dbs.db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        kind: invoices.kind,
        contactName: contacts.legalName,
        score: bestScore,
      })
      .from(invoices)
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(and(...filters))
      .orderBy(desc(bestScore))
      .limit(MAX_RESULTS_PER_TYPE);

    return rows.map((r) => ({
      type: 'factura' as const,
      id: r.id,
      title: r.invoiceNumber,
      subtitle: `${r.kind === 'venta' ? 'Venta' : 'Compra'} · ${r.contactName}`,
      link: '/facturas',
      score: Number(r.score),
    }));
  }

  /** Mismo helper que `InvoicesService.invoiceIdsForProjects` — duplicado a propósito: es privado allí y esta es la única otra consumidora. */
  private async invoiceIdsForProjects(projectIds: string[]): Promise<string[]> {
    const rows = await this.dbs.db
      .selectDistinct({ invoiceId: invoiceLines.invoiceId })
      .from(invoiceLines)
      .where(inArray(invoiceLines.projectId, projectIds));
    return rows.map((r) => r.invoiceId);
  }
}
