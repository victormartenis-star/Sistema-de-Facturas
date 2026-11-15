import { incrementarVersion } from '../common/version';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { companies, contacts, invoices, Tx } from '@erp/db';
import {
  FACTURAE_REASON_CODES,
  FACTURAE_UNKNOWN_ADDRESS,
  VERIFACTU_GENESIS_HASH,
  buildFacturaeXml,
  correctionMethodFromType,
  facturaeTaxPeriodOf,
  verifactuCanonicalString,
  type FacturaeCorrectiveInput,
  type FacturaeParty,
  type FacturaeReasonCode,
  type InvoiceDto,
  type FacturaeVerifactuInfo,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { FacturaeSigningService } from './facturae-signing.service';
import { InvoicesService } from './invoices.service';
import { validarFacturaeXsd } from './facturae-xsd';

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
 *
 * Criterios fiscales aprobados por el titular (documentados, sin efecto en
 * el comportamiento):
 * - Periodo de IVA: liquidación TRIMESTRAL.
 * - Método Facturae: estándar, para facturas NO enviadas previamente
 *   (generación y firma estándar; no se reenvían registros ya notificados).
 * - Rectificativas: la clase (`total` o `diferencias`) se elige de forma
 *   EXPLÍCITA al rectificar (`RECTIFICATION_KINDS`); no existe valor por
 *   defecto. La descarga Facturae de una rectificativa funciona (con código
 *   de motivo Facturae elegido por el titular); el envío VeriFactu de una
 *   rectificativa responde 409 (registros R1-R4 pendientes).
 *
 * Ver la cabecera de `packages/shared/src/facturae.ts` para el resto del
 * alcance deliberadamente preliminar (sin validar contra el XSD oficial,
 * direcciones fiscales con datos de relleno).
 */
@Injectable()
export class FacturaeService {
  private readonly logger = new Logger(FacturaeService.name);

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

    const corrective = invoice.rectifiesInvoiceId
      ? await this.correctiveOf(invoice)
      : undefined;

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
        and(
          eq(contacts.id, invoice.contactId),
          eq(contacts.companyId, companyId),
          isNull(contacts.deletedAt),
        ),
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
      corrective,
    });

    const signed = this.signingService.enabled;
    const xml = signed ? this.signingService.sign(unsignedXml) : unsignedXml;

    await this.persistirValidacionXsd(invoiceId, xml);

    return {
      xml,
      fileName: `facturae-${sanitizeFileName(invoice.invoiceNumber)}.xml`,
      signed,
    };
  }

  /**
   * Valida el XML entregado contra el XSD oficial y guarda el resultado en la
   * factura. Si el validador falla por un motivo técnico (no por un XML
   * inválido) no se bloquea la descarga: el estado queda como estaba. No
   * incrementa `version`: es un metadato derivado, no un cambio editable.
   */
  private async persistirValidacionXsd(
    invoiceId: string,
    xml: string,
  ): Promise<void> {
    try {
      const r = await validarFacturaeXsd(xml);
      await this.dbs.db
        .update(invoices)
        .set({
          facturaeXsdStatus: r.valid ? 'valido' : 'no_valido',
          facturaeXsdErrors: r.valid ? null : r.errors.join('\n'),
        })
        .where(eq(invoices.id, invoiceId));
    } catch (e) {
      this.logger.error(
        `No se pudo validar/persistir el XSD de Facturae de ${invoiceId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Bloque Corrective de una rectificativa. Todo lo que falte es 409: las
   * rectificativas anteriores a la regla del código de motivo y las de
   * certificación no lo tienen (el titular lo elige solo al rectificar una
   * factura vía API).
   */
  private async correctiveOf(
    invoice: InvoiceDto,
  ): Promise<FacturaeCorrectiveInput> {
    const reasonCode = invoice.facturaeReasonCode;
    if (!reasonCode || !Object.hasOwn(FACTURAE_REASON_CODES, reasonCode)) {
      throw new ConflictException(
        'La rectificativa no tiene código de motivo Facturae (rectificativa anterior a esta regla o generada desde una certificación): no se puede generar su Facturae',
      );
    }
    if (!invoice.rectificationType) {
      throw new ConflictException(
        'La rectificativa no tiene tipo de rectificación (S/I): no se puede generar su Facturae',
      );
    }
    const [original] = await this.dbs.db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoice.rectifiesInvoiceId as string),
          eq(invoices.companyId, await this.dbs.getCompanyId()),
        ),
      )
      .limit(1);
    if (!original) {
      throw new ConflictException(
        'No se encuentra la factura original que rectifica: no se puede generar su Facturae',
      );
    }
    if (original.invoiceNumber.length > 20) {
      throw new ConflictException(
        'El número de la factura original supera los 20 caracteres que admite Facturae en el bloque Corrective',
      );
    }
    return {
      originalNumber: original.invoiceNumber,
      originalIssueDate: original.issueDate,
      reasonCode: reasonCode as FacturaeReasonCode,
      correctionMethod: correctionMethodFromType(invoice.rectificationType),
      taxPeriod: facturaeTaxPeriodOf(original.issueDate),
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
    // Cálculo + persistencia en una sola transacción, serializada por
    // empresa: dos peticiones simultáneas no pueden escribir huellas
    // encadenadas sobre una cola distinta. Si algo falla (p. ej. el 409 de
    // integridad) no queda ninguna huella a medias.
    return this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${'verifactu:' + companyId}))`,
      );
      return this.recorrerCadena(tx, companyId, issuerTaxId, targetInvoiceId);
    });
  }

  private async recorrerCadena(
    tx: Tx,
    companyId: string,
    issuerTaxId: string,
    targetInvoiceId: string,
  ): Promise<FacturaeVerifactuInfo> {
    // Solo estados emitidos: un borrador (editable/borrable) o una anulada
    // no pueden formar parte de una cadena que debe ser inmutable.
    const rows = await tx
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        vatAmount: invoices.vatAmount,
        totalAmount: invoices.totalAmount,
        createdAt: invoices.createdAt,
        verifactuStatus: invoices.verifactuStatus,
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
          inArray(invoices.status, ['aprobada', 'pagada', 'rectificada']),
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
        if (row.verifactuStatus === 'enviado') {
          // La huella de un registro ya notificado a la AEAT es inmutable:
          // recalcularla rompería la cadena que la AEAT ya tiene.
          throw new ConflictException(
            `Integridad VeriFactu: la factura ${row.invoiceNumber} ya fue enviada a la AEAT y su huella no coincide con la cadena actual (se añadió o cambió una factura anterior). No se recalcula; revisa la cadena antes de continuar`,
          );
        }
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
        await tx
          .update(invoices)
          .set({
            verifactuHash: hash,
            verifactuPreviousHash: previousHash,
            verifactuGeneratedAt: new Date(generatedAt),
            version: incrementarVersion(invoices),
          })
          .where(
            and(
              eq(invoices.id, row.id),
              ne(invoices.verifactuStatus, 'enviado'),
            ),
          );
      }

      if (row.id === targetInvoiceId) {
        target = { hash, previousHash, generatedAt };
        break;
      }
      previousHash = hash;
    }
    if (!target) {
      throw new NotFoundException(
        'Factura no encontrada al reconstruir la cadena VeriFactu',
      );
    }
    return target;
  }
}
