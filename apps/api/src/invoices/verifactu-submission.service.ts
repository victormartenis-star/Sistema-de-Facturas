import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { companies, invoices } from '@erp/db';
import {
  RegistroAltaInput,
  VerifactuStatus,
  buildRegistroAltaXml,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { FacturaeService } from './facturae.service';
import { InvoicesService } from './invoices.service';

const SOFTWARE_NAME = 'ERP Dintel';
const SOFTWARE_VERSION = '1.0';

export interface VerifactuSubmissionResultDto {
  status: VerifactuStatus;
  xml: string;
  sentAt: string | null;
}

/**
 * Envío del *Registro de Facturación* VeriFactu real a la AEAT (Fase 14).
 *
 * Mismo patrón "opt-in silencioso" que `ExtractionService.enabled`
 * (`ANTHROPIC_API_KEY`) o `EmailService.enabled` (SMTP): sin
 * `AEAT_CERT_PATH`/`AEAT_CERT_PASSWORD`/`AEAT_ENDPOINT_URL` configurados,
 * `send()` genera el XML y lo deja en `generado_local` — no falla, no
 * intenta ninguna llamada de red. **La rama con las 3 variables
 * configuradas nunca se ha ejercitado**: este entorno no tiene un
 * certificado digital real ni credenciales de la AEAT, así que ese camino
 * (mTLS con el `.p12` vía `pfx`+`passphrase` de Node, `POST` del XML al
 * endpoint) está escrito contra la API de Node documentada, pero no
 * probado contra ningún servidor real — si se usa alguna vez, revisar
 * primero la URL/contrato exacto del servicio de la AEAT vigente entonces.
 */
@Injectable()
export class VerifactuSubmissionService {
  private readonly logger = new Logger(VerifactuSubmissionService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly invoicesService: InvoicesService,
    private readonly facturaeService: FacturaeService,
  ) {}

  get enabled(): boolean {
    return Boolean(
      process.env.AEAT_CERT_PATH &&
      process.env.AEAT_CERT_PASSWORD &&
      process.env.AEAT_ENDPOINT_URL,
    );
  }

  async send(invoiceId: string): Promise<VerifactuSubmissionResultDto> {
    const invoice = await this.invoicesService.get(invoiceId);
    if (invoice.kind !== 'venta') {
      throw new BadRequestException(
        'VeriFactu solo se genera para facturas de venta',
      );
    }
    if (invoice.status === 'borrador' || invoice.status === 'anulada') {
      throw new BadRequestException(
        'La factura debe estar aprobada para generar su registro VeriFactu',
      );
    }

    const companyId = this.dbs.getCompanyId();
    const [company] = await this.dbs.db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!company) throw new NotFoundException('Empresa no encontrada');
    if (!company.taxId?.trim()) {
      throw new BadRequestException(
        'La empresa no tiene NIF/CIF configurado: es obligatorio para VeriFactu',
      );
    }

    const chain = await this.facturaeService.computeVerifactuChain(
      companyId,
      company.taxId,
      invoiceId,
    );

    const registroInput: RegistroAltaInput = {
      issuerTaxId: company.taxId,
      issuerName: company.name,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      vatAmount: invoice.vatAmount,
      totalAmount: invoice.totalAmount,
      hash: chain.hash,
      previousHash: chain.previousHash,
      generatedAt: chain.generatedAt,
      softwareName: SOFTWARE_NAME,
      softwareVersion: SOFTWARE_VERSION,
    };
    const xml = buildRegistroAltaXml(registroInput);

    if (!this.enabled) {
      await this.persistStatus(invoiceId, 'generado_local', null);
      return { status: 'generado_local', xml, sentAt: null };
    }

    try {
      await this.postToAeat(xml);
      const sentAt = new Date();
      await this.persistStatus(invoiceId, 'enviado', sentAt);
      return { status: 'enviado', xml, sentAt: sentAt.toISOString() };
    } catch (err) {
      this.logger.error(
        `Fallo enviando el registro VeriFactu de la factura ${invoiceId}: ${(err as Error).message}`,
      );
      await this.persistStatus(invoiceId, 'error', null);
      return { status: 'error', xml, sentAt: null };
    }
  }

  private async persistStatus(
    invoiceId: string,
    status: VerifactuStatus,
    sentAt: Date | null,
  ): Promise<void> {
    await this.dbs.db
      .update(invoices)
      .set({ verifactuStatus: status, verifactuSentAt: sentAt })
      .where(eq(invoices.id, invoiceId));
  }

  /**
   * mTLS con el certificado configurado, `POST` del XML al endpoint. Nunca
   * ejercitado contra un servidor real (ver cabecera de la clase).
   */
  private postToAeat(xml: string): Promise<void> {
    const pfx = readFileSync(process.env.AEAT_CERT_PATH!);
    const url = new URL(process.env.AEAT_ENDPOINT_URL!);
    const body = Buffer.from(xml, 'utf-8');

    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'POST',
          pfx,
          passphrase: process.env.AEAT_CERT_PASSWORD,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Content-Length': body.length,
          },
        },
        (res) => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`AEAT respondió ${res.statusCode}`));
            res.resume();
            return;
          }
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
