import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  Contact,
  ContactComplianceDoc,
  ComplianceWaiver,
  complianceWaivers,
  contactComplianceDocs,
  contacts,
} from '@erp/db';
import {
  BLOCKING_COMPLIANCE_DOC_TYPES,
  COMPLIANCE_DOC_TYPE_LABELS,
  COMPLIANCE_WARNING_DAYS,
  ComplianceBlockInput,
  ComplianceDocCreateInput,
  ComplianceDocDto,
  ComplianceDocStatus,
  ComplianceDocType,
  ComplianceDocUpdateInput,
  ComplianceStatus,
  ComplianceSummaryDto,
  ComplianceWaiverDto,
  ComplianceWaiverInput,
  complianceBlockSchema,
  complianceDocCreateSchema,
  complianceDocUpdateSchema,
  complianceWaiverSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';

/** Días naturales entre hoy y una fecha ISO (negativo si ya pasó). */
function daysUntil(iso: string): number {
  const target = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((target - today) / 86_400_000);
}

function docStatus(doc: ContactComplianceDoc): ComplianceDocStatus {
  if (doc.rejected) return 'rechazado';
  // Sin fecha de caducidad el documento se considera permanente
  if (!doc.expiresAt) return 'vigente';
  const days = daysUntil(doc.expiresAt);
  if (days < 0) return 'vencido';
  if (days <= COMPLIANCE_WARNING_DAYS) return 'proximo_vencimiento';
  return 'vigente';
}

function toDocDto(doc: ContactComplianceDoc): ComplianceDocDto {
  return {
    id: doc.id,
    contactId: doc.contactId,
    docType: doc.docType as ComplianceDocType,
    documentId: doc.documentId,
    issuedAt: doc.issuedAt,
    expiresAt: doc.expiresAt,
    status: docStatus(doc),
    daysToExpiry: doc.expiresAt ? daysUntil(doc.expiresAt) : null,
    blocking: BLOCKING_COMPLIANCE_DOC_TYPES.includes(
      doc.docType as ComplianceDocType,
    ),
    notes: doc.notes,
    createdAt: doc.createdAt.toISOString(),
  };
}

function toWaiverDto(waiver: ComplianceWaiver): ComplianceWaiverDto {
  return {
    id: waiver.id,
    contactId: waiver.contactId,
    reason: waiver.reason,
    validUntil: waiver.validUntil,
    active: waiver.revokedAt === null && daysUntil(waiver.validUntil) >= 0,
    createdAt: waiver.createdAt.toISOString(),
  };
}

@Injectable()
export class ComplianceService {
  constructor(private readonly dbs: DbService) {}

  /** Ficha de homologación de todas las subcontratas sujetas a control. */
  async list(onlyRequired = true): Promise<ComplianceSummaryDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const rows = await this.dbs.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.companyId, companyId), isNull(contacts.deletedAt)))
      .orderBy(asc(contacts.legalName));

    const summaries: ComplianceSummaryDto[] = [];
    for (const contact of rows) {
      if (onlyRequired && !contact.requiresCompliance) continue;
      summaries.push(await this.summaryFor(contact));
    }
    return summaries;
  }

  async summary(contactId: string): Promise<ComplianceSummaryDto> {
    return this.summaryFor(await this.findContact(contactId));
  }

  /**
   * Regla de negocio central: lanza 409 si no se puede operar con el contacto.
   * La llaman la aprobación de facturas y la liquidación de vencimientos.
   */
  async assertCanTransact(contactId: string, action: string): Promise<void> {
    const summary = await this.summaryFor(await this.findContact(contactId));
    if (!summary.blocked) return;
    throw new ConflictException(
      `No se puede ${action}: ${summary.legalName} está bloqueado. ` +
        `${summary.reasons.join('; ')}. Aporta la documentación o concede una exención justificada.`,
    );
  }

  async addDoc(
    contactId: string,
    input: ComplianceDocCreateInput,
  ): Promise<ComplianceDocDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    await this.findContact(contactId);
    const data = complianceDocCreateSchema.parse(input);
    const [row] = await this.dbs.db
      .insert(contactComplianceDocs)
      .values({
        companyId,
        contactId,
        docType: data.docType,
        documentId: data.documentId ?? null,
        issuedAt: data.issuedAt ?? null,
        expiresAt: data.expiresAt ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    return toDocDto(row);
  }

  async updateDoc(
    id: string,
    input: ComplianceDocUpdateInput,
  ): Promise<ComplianceDocDto> {
    await this.findDoc(id);
    const data = complianceDocUpdateSchema.parse(input);
    const [row] = await this.dbs.db
      .update(contactComplianceDocs)
      .set({
        ...(data.docType !== undefined && { docType: data.docType }),
        ...(data.documentId !== undefined && {
          documentId: data.documentId ?? null,
        }),
        ...(data.issuedAt !== undefined && { issuedAt: data.issuedAt ?? null }),
        ...(data.expiresAt !== undefined && {
          expiresAt: data.expiresAt ?? null,
        }),
        ...(data.rejected !== undefined && { rejected: data.rejected }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(contactComplianceDocs.id, id))
      .returning();
    return toDocDto(row);
  }

  async removeDoc(id: string): Promise<void> {
    await this.findDoc(id);
    await this.dbs.db
      .update(contactComplianceDocs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(contactComplianceDocs.id, id));
  }

  /** Marca (o desmarca) un contacto como sujeto a homologación. */
  async setRequired(
    contactId: string,
    required: boolean,
  ): Promise<ComplianceSummaryDto> {
    await this.findContact(contactId);
    await this.dbs.db
      .update(contacts)
      .set({ requiresCompliance: required, updatedAt: new Date() })
      .where(eq(contacts.id, contactId));
    return this.summary(contactId);
  }

  async block(
    contactId: string,
    input: ComplianceBlockInput,
  ): Promise<ComplianceSummaryDto> {
    await this.findContact(contactId);
    const data = complianceBlockSchema.parse(input);
    await this.dbs.db
      .update(contacts)
      .set({
        blockedAt: new Date(),
        blockedReason: data.reason,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));
    return this.summary(contactId);
  }

  async unblock(contactId: string): Promise<ComplianceSummaryDto> {
    await this.findContact(contactId);
    await this.dbs.db
      .update(contacts)
      .set({ blockedAt: null, blockedReason: null, updatedAt: new Date() })
      .where(eq(contacts.id, contactId));
    return this.summary(contactId);
  }

  /**
   * Exención temporal: permite seguir operando pese al bloqueo, bajo la
   * responsabilidad de quien la concede. Queda registrada con motivo y plazo.
   */
  async grantWaiver(
    contactId: string,
    input: ComplianceWaiverInput,
  ): Promise<ComplianceWaiverDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    await this.findContact(contactId);
    const data = complianceWaiverSchema.parse(input);
    if (daysUntil(data.validUntil) < 0) {
      throw new ConflictException(
        'La exención debe tener una fecha de caducidad futura',
      );
    }
    // Solo una exención activa por contacto: la nueva revoca la anterior
    await this.dbs.db
      .update(complianceWaivers)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(complianceWaivers.contactId, contactId),
          isNull(complianceWaivers.revokedAt),
        ),
      );
    const [row] = await this.dbs.db
      .insert(complianceWaivers)
      .values({
        companyId,
        contactId,
        reason: data.reason,
        validUntil: data.validUntil,
      })
      .returning();
    return toWaiverDto(row);
  }

  async revokeWaiver(contactId: string): Promise<void> {
    await this.findContact(contactId);
    await this.dbs.db
      .update(complianceWaivers)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(complianceWaivers.contactId, contactId),
          isNull(complianceWaivers.revokedAt),
        ),
      );
  }

  /* ────────────────────────── privados ────────────────────────── */

  /**
   * Calcula el estado de un contacto. El orden importa: el bloqueo manual
   * pesa más que la documentación, y la exención levanta el bloqueo pero
   * deja constancia de que se está operando con ella.
   */
  private async summaryFor(contact: Contact): Promise<ComplianceSummaryDto> {
    const docs = await this.docsOf(contact.id);
    const waiver = await this.activeWaiver(contact.id);
    const reasons: string[] = [];

    let status: ComplianceStatus;
    let blocked: boolean;

    if (contact.blockedAt) {
      status = 'bloqueado_manual';
      blocked = true;
      reasons.push(
        `Bloqueado manualmente: ${contact.blockedReason ?? 'sin motivo indicado'}`,
      );
    } else if (!contact.requiresCompliance) {
      status = 'no_aplica';
      blocked = false;
    } else {
      const missing: string[] = [];
      const expired: string[] = [];
      const warning: string[] = [];

      for (const type of BLOCKING_COMPLIANCE_DOC_TYPES) {
        const best = docs.find((d) => d.docType === type);
        const label = COMPLIANCE_DOC_TYPE_LABELS[type];
        if (!best || best.status === 'rechazado') {
          missing.push(label);
        } else if (best.status === 'vencido') {
          expired.push(`${label} (venció el ${best.expiresAt})`);
        } else if (best.status === 'proximo_vencimiento') {
          warning.push(`${label} vence en ${best.daysToExpiry} días`);
        }
      }

      if (missing.length > 0) {
        reasons.push(`Falta documentación: ${missing.join(', ')}`);
      }
      if (expired.length > 0) {
        reasons.push(`Documentación vencida: ${expired.join(', ')}`);
      }
      if (warning.length > 0) {
        reasons.push(warning.join('; '));
      }

      if (missing.length > 0 || expired.length > 0) {
        status = 'bloqueado';
        blocked = true;
      } else if (warning.length > 0) {
        status = 'con_avisos';
        blocked = false;
      } else {
        status = 'homologado';
        blocked = false;
      }
    }

    if (blocked && waiver) {
      blocked = false;
      status = 'exento';
      reasons.push(
        `Exención vigente hasta el ${waiver.validUntil}: ${waiver.reason}`,
      );
    }

    return {
      contactId: contact.id,
      legalName: contact.legalName,
      taxId: contact.taxId,
      requiresCompliance: contact.requiresCompliance,
      status,
      blocked,
      reasons,
      docs,
      waiver,
    };
  }

  /**
   * Documentos vigentes del contacto, el más reciente primero. Si hay varias
   * copias del mismo tipo (una renovación, por ejemplo) gana la que caduca
   * más tarde, que es la que de verdad determina el estado.
   */
  private async docsOf(contactId: string): Promise<ComplianceDocDto[]> {
    const rows = await this.dbs.db
      .select()
      .from(contactComplianceDocs)
      .where(
        and(
          eq(contactComplianceDocs.contactId, contactId),
          isNull(contactComplianceDocs.deletedAt),
        ),
      )
      .orderBy(desc(contactComplianceDocs.createdAt));

    return rows.map(toDocDto).sort((a, b) => {
      if (a.docType !== b.docType) return a.docType.localeCompare(b.docType);
      // Sin caducidad (permanente) manda sobre cualquier fecha
      if (a.expiresAt === null) return -1;
      if (b.expiresAt === null) return 1;
      return b.expiresAt.localeCompare(a.expiresAt);
    });
  }

  private async activeWaiver(
    contactId: string,
  ): Promise<ComplianceWaiverDto | null> {
    const [row] = await this.dbs.db
      .select()
      .from(complianceWaivers)
      .where(
        and(
          eq(complianceWaivers.contactId, contactId),
          isNull(complianceWaivers.revokedAt),
        ),
      )
      .orderBy(desc(complianceWaivers.createdAt))
      .limit(1);
    if (!row) return null;
    const dto = toWaiverDto(row);
    return dto.active ? dto : null;
  }

  private async findContact(id: string): Promise<Contact> {
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Contacto no encontrado');
    }
    return row;
  }

  private async findDoc(id: string): Promise<ContactComplianceDoc> {
    const [row] = await this.dbs.db
      .select()
      .from(contactComplianceDocs)
      .where(
        and(
          eq(contactComplianceDocs.id, id),
          isNull(contactComplianceDocs.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException('Documento de homologación no encontrado');
    }
    return row;
  }
}
