import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { Document, documents, extractions, projects } from '@erp/db';
import {
  DOCUMENT_ACCEPTED_MIME_TYPES,
  ExtractionConfidence,
  ExtractionPayload,
  ExtractionResult,
  extractionResultSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { StorageService } from '../documents/storage.service';
import { EXTRACTION_JSON_SCHEMA } from './extraction.schema';

const DEFAULT_MODEL = 'claude-opus-4-8';
/** Tolerancia de cuadre base + IVA = total (redondeos al céntimo). */
const AMOUNT_TOLERANCE = 0.01;

const SYSTEM_PROMPT = `Eres el lector documental de un ERP de una empresa de construcción española.
Recibes el original de una factura, albarán, ticket o documento similar y extraes sus datos.

Reglas:
- Todos los importes en euros, como número (1210.5), nunca con separador de miles ni símbolo.
- Las fechas siempre en formato AAAA-MM-DD. Ojo: en España el formato habitual es DD/MM/AAAA.
- El NIF/CIF del emisor en mayúsculas, sin espacios ni guiones.
- Si un dato no aparece en el documento, devuelve null. No lo inventes ni lo deduzcas.
- El emisor es quien emite la factura (el proveedor en una factura de compra),
  no la empresa que la recibe.
- En inversión del sujeto pasivo (habitual en construcción) la cuota de IVA es 0
  y suele aparecer una leyenda legal; refléjalo en los avisos.
- La confianza de cada campo es 0-1: usa valores bajos cuando el original esté
  borroso, cortado o el dato sea ambiguo, y 0 en los campos que devuelvas null.
- En los avisos señala en español todo lo que un humano deba revisar: descuadres
  entre base, IVA y total, NIF con formato extraño, fechas improbables,
  documento ilegible o parcialmente cortado.`;

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {}

  /** El pipeline solo está activo si hay clave configurada. */
  get enabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  get model(): string {
    return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  }

  /**
   * Lee un documento con el modelo de visión y guarda el resultado.
   * Mueve el documento a `extraido` (o `error` si la lectura falla).
   */
  async extract(document: Document): Promise<void> {
    await this.setStatus(document.id, 'procesando');
    try {
      const result = await this.callModel(document);
      const warnings = [
        ...result.warnings,
        ...(await this.checkPayload(document, result.payload)),
      ];

      await this.dbs.db.insert(extractions).values({
        documentId: document.id,
        model: this.model,
        payload: result.payload,
        confidence: result.confidence,
        warnings,
      });

      // La extracción propone el tipo documental si el usuario no lo fijó
      await this.dbs.db
        .update(documents)
        .set({
          status: 'extraido',
          ...(document.docType === null && { docType: result.payload.docType }),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, document.id));

      this.logger.log(
        `Documento "${document.fileName}" extraído (${warnings.length} avisos)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Fallo al extraer "${document.fileName}": ${message}`);
      await this.setStatus(document.id, 'error');
      throw err;
    }
  }

  private async callModel(document: Document): Promise<ExtractionResult> {
    const content = await this.storage.readBuffer(document.storageKey);
    const data = content.toString('base64');
    const projectList = await this.projectHintList();

    const response = await this.anthropic().messages.create({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: {
        format: {
          type: 'json_schema',
          schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            document.mimeType === 'application/pdf'
              ? {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data,
                  },
                }
              : {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: this.imageMediaType(document.mimeType),
                    data,
                  },
                },
            {
              type: 'text',
              text: [
                `Extrae los datos de este documento (archivo "${document.fileName}").`,
                projectList
                  ? `Obras abiertas de la empresa, por si el documento menciona alguna:\n${projectList}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        'El modelo rechazó procesar el documento por motivos de seguridad',
      );
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (!text.trim()) {
      throw new Error(
        `El modelo no devolvió datos (stop_reason: ${response.stop_reason})`,
      );
    }
    // La salida estructurada garantiza el esquema; validamos igualmente para
    // no propagar sorpresas al resto del sistema.
    return extractionResultSchema.parse(JSON.parse(text));
  }

  /**
   * Validaciones de negocio sobre lo extraído. Son avisos para el humano que
   * valida, nunca bloquean: el original manda y el usuario corrige en la bandeja.
   */
  private async checkPayload(
    document: Document,
    payload: ExtractionPayload,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const { baseAmount, vatAmount, totalAmount } = payload;

    if (baseAmount !== null && vatAmount !== null && totalAmount !== null) {
      const diff = Math.abs(baseAmount + vatAmount - totalAmount);
      if (diff > AMOUNT_TOLERANCE) {
        warnings.push(
          `Descuadre: base (${baseAmount.toFixed(2)} €) + IVA (${vatAmount.toFixed(2)} €) ` +
            `no suma el total (${totalAmount.toFixed(2)} €); difiere en ${diff.toFixed(2)} €`,
        );
      }
    }
    if (payload.issuerTaxId && !isValidSpanishTaxId(payload.issuerTaxId)) {
      warnings.push(
        `El NIF/CIF "${payload.issuerTaxId}" no supera la validación de dígito de control`,
      );
    }
    if (payload.issueDate) {
      const issued = new Date(`${payload.issueDate}T00:00:00Z`);
      if (Number.isNaN(issued.getTime())) {
        warnings.push(`Fecha de emisión no reconocida: "${payload.issueDate}"`);
      } else if (issued.getTime() > Date.now() + 86_400_000) {
        warnings.push(
          `La fecha de emisión (${payload.issueDate}) está en el futuro`,
        );
      }
    }
    if (payload.invoiceNumber && payload.issuerTaxId) {
      const duplicate = await this.findDuplicate(
        document.id,
        payload.invoiceNumber,
        payload.issuerTaxId,
      );
      if (duplicate) {
        warnings.push(
          `Posible duplicado: la factura "${payload.invoiceNumber}" de este emisor ` +
            `ya se leyó en el documento "${duplicate}"`,
        );
      }
    }
    return warnings;
  }

  /** Misma clave natural (número + emisor) en otro documento ya extraído. */
  private async findDuplicate(
    documentId: string,
    invoiceNumber: string,
    issuerTaxId: string,
  ): Promise<string | null> {
    const rows = await this.dbs.db
      .select({
        documentId: extractions.documentId,
        fileName: documents.fileName,
        payload: extractions.payload,
      })
      .from(extractions)
      .innerJoin(documents, eq(extractions.documentId, documents.id))
      .where(isNull(documents.deletedAt))
      .orderBy(desc(extractions.createdAt))
      .limit(200);

    for (const row of rows) {
      // Se compara por documento, no por nombre: dos facturas distintas
      // pueden llegar ambas como "factura.pdf"
      if (row.documentId === documentId) continue;
      const other = row.payload as ExtractionPayload;
      if (
        other.invoiceNumber === invoiceNumber &&
        other.issuerTaxId === issuerTaxId
      ) {
        return row.fileName;
      }
    }
    return null;
  }

  private async projectHintList(): Promise<string> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const rows = await this.dbs.db
      .select({ code: projects.code, name: projects.name })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), isNull(projects.deletedAt)))
      .orderBy(asc(projects.code))
      .limit(50);
    return rows.map((p) => `- ${p.code}: ${p.name}`).join('\n');
  }

  private async setStatus(
    id: string,
    status: 'procesando' | 'extraido' | 'error',
  ): Promise<void> {
    await this.dbs.db
      .update(documents)
      .set({ status, updatedAt: new Date() })
      .where(eq(documents.id, id));
  }

  private imageMediaType(
    mimeType: string,
  ): 'image/jpeg' | 'image/png' | 'image/webp' {
    if (
      mimeType === 'image/jpeg' ||
      mimeType === 'image/png' ||
      mimeType === 'image/webp'
    ) {
      return mimeType;
    }
    throw new Error(
      `Tipo de archivo no soportado por el pipeline: ${mimeType}. ` +
        `Admitidos: ${DOCUMENT_ACCEPTED_MIME_TYPES.join(', ')}`,
    );
  }

  private anthropic(): Anthropic {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          'Falta ANTHROPIC_API_KEY en el .env: el pipeline OCR/IA está desactivado',
        );
      }
      this.client = new Anthropic();
    }
    return this.client;
  }
}

/** Dígito de control de NIF, NIE y CIF españoles. */
export function isValidSpanishTaxId(raw: string): boolean {
  const id = raw.toUpperCase().replace(/[\s-]/g, '');

  const nif = /^(\d{8})([A-Z])$/.exec(id);
  if (nif) {
    return 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(nif[1]) % 23] === nif[2];
  }

  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(id);
  if (nie) {
    const number = Number(`${'XYZ'.indexOf(nie[1])}${nie[2]}`);
    return 'TRWAGMYFPDXBNJZSQVHLCKE'[number % 23] === nie[3];
  }

  const cif = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(id);
  if (cif) {
    const digits = cif[2];
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      const digit = Number(digits[i]);
      // Posiciones impares (1-indexadas) se duplican y se suman sus cifras
      sum +=
        i % 2 === 0 ? ((digit * 2) % 10) + Math.floor((digit * 2) / 10) : digit;
    }
    const control = (10 - (sum % 10)) % 10;
    return cif[3] === String(control) || cif[3] === 'JABCDEFGHI'[control];
  }

  return false;
}

export type { ExtractionConfidence };
