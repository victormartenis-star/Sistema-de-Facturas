import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ContractAudit, contacts, contractAudits, documents } from '@erp/db';
import {
  ContractAuditDto,
  ContractAuditFinding,
  ContractAuditRequestInput,
  contractAuditRequestSchema,
  contractAuditResultSchema,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';
import { StorageService } from '../../documents/storage.service';
import { CONTRACT_AI_JSON_SCHEMA } from './contract-ai.schema';

const DEFAULT_MODEL = 'claude-opus-4-8';

const SYSTEM_PROMPT = `Eres el auditor de contratos de una empresa de construcción española. Recibes un contrato de subcontrata, un pliego de condiciones o un anexo, y detectas cláusulas de riesgo antes de que alguien lo firme.

Reglas:
- Responde siempre en español.
- Céntrate en riesgos reales para la constructora que contrata: pagos y plazos de pago, penalizaciones desproporcionadas, cesión de responsabilidad, garantías excesivas o insuficientes, plazos de ejecución poco realistas, cláusulas de jurisdicción desfavorables, condiciones de resolución del contrato unilaterales.
- No sustituyes la revisión legal: dejas constancia de lo detectado en un lenguaje claro para que un humano decida, no das consejo jurídico definitivo.
- Si una cláusula es estándar y no supone riesgo, no la incluyas — solo lo que de verdad merece revisión.
- El riesgo global (\`overallRisk\`) es el del hallazgo más grave, no un promedio.
- Si el texto no parece un contrato o pliego, dilo en el resumen y devuelve \`findings\` vacío con \`overallRisk: "bajo"\`.`;

@Injectable()
export class ContractAiService {
  private client: Anthropic | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  get model(): string {
    return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  }

  async auditar(
    input: ContractAuditRequestInput,
    requestedByUserId: string,
  ): Promise<ContractAuditDto> {
    if (!this.enabled) {
      throw new BadRequestException(
        'La auditoría de contratos no está disponible: configura `ANTHROPIC_API_KEY` en el .env de la API.',
      );
    }
    const data = contractAuditRequestSchema.parse(input);
    const companyId = await this.dbs.getCompanyId();

    if (data.projectId) await this.assertProjectAccessible(data.projectId);

    const content = data.documentId
      ? await this.contentFromDocument(companyId, data.documentId)
      : [{ type: 'text' as const, text: data.text! }];

    const result = await this.callModel(content);

    const [row] = await this.dbs.db
      .insert(contractAudits)
      .values({
        companyId,
        projectId: data.projectId ?? null,
        contactId: data.contactId ?? null,
        documentId: data.documentId ?? null,
        model: this.model,
        overallRisk: result.overallRisk,
        summary: result.summary,
        findings: result.findings,
        requestedByUserId,
      })
      .returning();

    void this.audit.log({
      entityType: 'contract_audit',
      entityId: row.id,
      action: 'create',
      newData: row,
    });

    const contactName = row.contactId
      ? await this.contactName(row.contactId)
      : null;
    return this.toDto(row, contactName);
  }

  async list(projectId?: string): Promise<ContractAuditDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (projectId && !allowed.includes(projectId)) return [];
    }

    const conditions = [eq(contractAudits.companyId, companyId)];
    if (projectId) conditions.push(eq(contractAudits.projectId, projectId));

    const rows = await this.dbs.db
      .select({ audit: contractAudits, contactName: contacts.legalName })
      .from(contractAudits)
      .leftJoin(contacts, eq(contractAudits.contactId, contacts.id))
      .where(and(...conditions))
      .orderBy(desc(contractAudits.createdAt));
    const visible =
      allowed === null
        ? rows
        : rows.filter(
            (r) =>
              r.audit.projectId === null || allowed.includes(r.audit.projectId),
          );
    return visible.map((r) => this.toDto(r.audit, r.contactName ?? null));
  }

  async get(id: string): Promise<ContractAuditDto> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ audit: contractAudits, contactName: contacts.legalName })
      .from(contractAudits)
      .leftJoin(contacts, eq(contractAudits.contactId, contacts.id))
      .where(
        and(eq(contractAudits.id, id), eq(contractAudits.companyId, companyId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Auditoría no encontrada');
    if (row.audit.projectId)
      await this.assertProjectAccessible(row.audit.projectId);
    return this.toDto(row.audit, row.contactName ?? null);
  }

  /* ────────────────────── privados ────────────────────── */

  private async callModel(
    content: Anthropic.Messages.ContentBlockParam[],
  ): Promise<{
    overallRisk: ContractAuditDto['overallRisk'];
    summary: string;
    findings: ContractAuditFinding[];
  }> {
    const response = await this.anthropic().messages.create({
      model: this.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: {
        format: {
          type: 'json_schema',
          schema: CONTRACT_AI_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') {
      throw new BadRequestException(
        'El modelo rechazó auditar este contenido por motivos de seguridad',
      );
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (!text.trim()) {
      throw new BadRequestException(
        `El modelo no devolvió resultado (stop_reason: ${response.stop_reason})`,
      );
    }
    return contractAuditResultSchema.parse(JSON.parse(text));
  }

  private async contentFromDocument(
    companyId: string,
    documentId: string,
  ): Promise<Anthropic.Messages.ContentBlockParam[]> {
    const [doc] = await this.dbs.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.companyId, companyId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!doc) throw new NotFoundException('Documento no encontrado');

    const buffer = await this.storage.readBuffer(doc.storageKey);
    const data = buffer.toString('base64');
    const prompt = {
      type: 'text' as const,
      text: `Audita el contrato/pliego adjunto (archivo "${doc.fileName}"). Detecta cláusulas de riesgo siguiendo las reglas del sistema.`,
    };

    if (doc.mimeType === 'application/pdf') {
      return [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
        },
        prompt,
      ];
    }
    if (
      doc.mimeType === 'image/jpeg' ||
      doc.mimeType === 'image/png' ||
      doc.mimeType === 'image/webp'
    ) {
      return [
        {
          type: 'image',
          source: { type: 'base64', media_type: doc.mimeType, data },
        },
        prompt,
      ];
    }
    throw new BadRequestException(
      `Tipo de archivo no soportado para auditoría: ${doc.mimeType}`,
    );
  }

  private toDto(
    row: ContractAudit,
    contactName: string | null,
  ): ContractAuditDto {
    return {
      id: row.id,
      projectId: row.projectId,
      contactId: row.contactId,
      contactName,
      documentId: row.documentId,
      model: row.model,
      overallRisk: row.overallRisk,
      summary: row.summary,
      findings: (row.findings ?? []) as ContractAuditFinding[],
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async contactName(contactId: string): Promise<string | null> {
    const [row] = await this.dbs.db
      .select({ legalName: contacts.legalName })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    return row?.legalName ?? null;
  }

  private async assertProjectAccessible(projectId: string): Promise<void> {
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
  }

  private anthropic(): Anthropic {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new BadRequestException(
          'Falta ANTHROPIC_API_KEY en el .env: la auditoría de contratos está desactivada',
        );
      }
      this.client = new Anthropic();
    }
    return this.client;
  }
}
