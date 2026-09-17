import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { companies, contacts, invoices } from '@erp/db';
import {
  FACTURAE_UNKNOWN_ADDRESS,
  VERIFACTU_GENESIS_HASH,
  buildFacturaeXml,
  verifactuCanonicalString,
  type FacturaeParty,
  type FacturaeVerifactuInfo,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { FacturaeSigningService } from './facturae-signing.service';
import { InvoicesService } from './invoices.service';

export interface FacturaeFileDto {
  xml: string;
  fileName: string;
  /** true si el XML devuelto lleva firma XAdES-BES real (Fase 14) — false = sigue siendo el XML preliminar sin firmar. */
  signed: boolean;
}

/** Solo caracteres seguros para un `Content-Disposition`; el número de factura es texto libre. */
function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

/**
 * Genera el XML Facturae 3.2.2 de una factura de venta, con la huella de
 * encadenamiento VeriFactu incrustada como extensión propia, y lo firma con
 * XAdES-BES si hay certificado configurado (`FacturaeSigningService`, Fase
 * 14) — si no, lo devuelve sin firmar, igual que siempre.
 *
 * Ver la cabecera de `packages/shared/src/facturae.ts` para el resto del
 * alcance deliberadamente preliminar (sin validar contra el XSD oficial,
 * direcciones fiscales con datos de relleno).
 */
@Injectable()
export class FacturaeService {
  constructor(
    private readonly dbs: DbService,
    private readonly invoicesService: InvoicesService,
    private readonly signingService: FacturaeSigningService,
  ) {}

  async generate(invoiceId: string): Promise<FacturaeFileDto> {
    // Reutiliza InvoicesService.get(): aplica el mismo RBAC por obra y el
    // mismo 404 que el resto de la API — no se duplica esa lógica aquí.
    const invoice = await this.invoicesService.get(invoiceId);

    if (invoice.kind !== 'venta') {
      throw new BadRequestException(
        'Facturae solo se genera para facturas de venta (el documento que emite la propia empresa)',
      );
    }
    if (invoice.status === 'borrador') {
      throw new BadRequestException(
        'No se puede generar Facturae de una factura en borrador: apruébala primero',
      );
    }
    if (invoice.status === 'anulada') {
      throw new BadRequestException(
        'No se puede generar Facturae de una factura anulada',
      );
    }

    const companyId = await this.dbs.getCompanyId();
    const [company] = await this.dbs.db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }
    if (!company.taxId?.trim()) {
      throw new BadRequestException(
        'La empresa no tiene NIF/CIF configurado: es obligatorio para Facturae',
      );
    }

    const [contact] = await this.dbs.db
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.id, invoice.contactId), isNull(contacts.deletedAt)),
      )
      .limit(1);
    if (!contact) {
      throw new NotFoundException('Contacto no encontrado');
    }
    if (!contact.taxId?.trim()) {
      throw new BadRequestException(
        `El cliente "${contact.legalName}" no tiene NIF/CIF registrado: es obligatorio para Facturae`,
      );
    }

    const seller: FacturaeParty = {
      taxId: company.taxId,
      name: company.name,
      // El esquema no modela dirección fiscal estructurada (ver facturae.ts).
      address: FACTURAE_UNKNOWN_ADDRESS,
    };
    const buyer: FacturaeParty = {
      taxId: contact.taxId,
      name: contact.legalName,
      address: FACTURAE_UNKNOWN_ADDRESS,
    };

    const verifactu = await this.computeVerifactuChain(
      companyId,
      company.taxId,
      invoiceId,
    );

    const unsignedXml = buildFacturaeXml({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      seller,
      buyer,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        baseAmount: l.baseAmount,
        vatPct: l.vatPct,
      })),
      isp: invoice.isp,
      baseAmount: invoice.baseAmount,
      vatAmount: invoice.vatAmount,
      retentionPct: invoice.retentionPct,
      retentionAmount: invoice.retentionAmount,
      totalAmount: invoice.totalAmount,
      verifactu,
    });

    const signed = this.signingService.enabled;
    const xml = signed ? this.signingService.sign(unsignedXml) : unsignedXml;

    return {
      xml,
      fileName: `facturae-${sanitizeFileName(invoice.invoiceNumber)}.xml`,
      signed,
    };
  }

  /**
   * Recorre todas las facturas de venta de la empresa, de la más antigua a
   * la más reciente, hasta llegar a la factura pedida — pero, a diferencia
   * de la versión original, **reutiliza la huella ya persistida** en
   * `invoices.verifactu_hash` para cada fila que la tenga, en vez de
   * recalcular el SHA-256 de todas las facturas anteriores en cada
   * petición (Fase 11, ver deuda técnica en [[Módulo Facturación]]).
   *
   * Solo se recalcula (y se persiste) a partir de la primera fila cuya
   * huella guardada ya no es válida: o no la tiene todavía (factura nueva,
   * el caso normal — "la cola" de la cadena), o su `verifactuPreviousHash`
   * guardado no coincide con lo que acabamos de calcular para la fila
   * anterior (la cadena por delante de ella cambió — p. ej. se insertó a
   * posteriori una factura con `issueDate` más antigua que rompe el orden;
   * caso raro, pero el chequeo de integridad lo detecta y se autocorrige
   * en vez de servir una huella obsoleta).
   */
  /**
   * Pública porque `VerifactuSubmissionService` (Fase 14) también necesita
   * la huella de una factura concreta para construir el `RegistroAlta` real
   * — reutiliza este cálculo en vez de duplicarlo.
   */
  async computeVerifactuChain(
    companyId: string,
    issuerTaxId: string,
    targetInvoiceId: string,
  ): Promise<FacturaeVerifactuInfo> {
    const rows = await this.dbs.db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        vatAmount: invoices.vatAmount,
        totalAmount: invoices.totalAmount,
        createdAt: invoices.createdAt,
        verifactuHash: invoices.verifactuHash,
        verifactuPreviousHash: invoices.verifactuPreviousHash,
        verifactuGeneratedAt: invoices.verifactuGeneratedAt,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.kind, 'venta'),
          isNull(invoices.deletedAt),
        ),
      )
      .orderBy(asc(invoices.issueDate), asc(invoices.createdAt));

    let previousHash = VERIFACTU_GENESIS_HASH;
    let target: FacturaeVerifactuInfo | undefined;
    for (const row of rows) {
      const cached =
        row.verifactuHash !== null &&
        row.verifactuPreviousHash === previousHash;

      let hash: string;
      let generatedAt: string;
      if (cached) {
        hash = row.verifactuHash!;
        generatedAt = row.verifactuGeneratedAt!.toISOString();
      } else {
        generatedAt = row.createdAt.toISOString();
        const canonical = verifactuCanonicalString(
          {
            issuerTaxId,
            invoiceNumber: row.invoiceNumber,
            issueDate: row.issueDate,
            vatAmount: Number(row.vatAmount),
            totalAmount: Number(row.totalAmount),
            generatedAt,
          },
          previousHash,
        );
        hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
        await this.dbs.db
          .update(invoices)
          .set({
            verifactuHash: hash,
            verifactuPreviousHash: previousHash,
            verifactuGeneratedAt: new Date(generatedAt),
          })
          .where(eq(invoices.id, row.id));
      }

      if (row.id === targetInvoiceId) {
        target = { hash, previousHash, generatedAt };
        break;
      }
      previousHash = hash;
    }
    if (!target) {
      // No debería ocurrir: `generate()` ya comprobó que es una factura de venta.
      throw new NotFoundException(
        'Factura no encontrada al reconstruir la cadena VeriFactu',
      );
    }
    return target;
  }
}
