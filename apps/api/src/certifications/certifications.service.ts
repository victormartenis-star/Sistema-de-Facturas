import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, SQL } from 'drizzle-orm';
import { Certification, certifications, projects } from '@erp/db';
import {
  CertificationCreateInput,
  CertificationDto,
  CertificationInvoiceInput,
  certificationCreateSchema,
  certificationInvoiceSchema,
  computeCertification,
  round2,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { InvoicesService } from '../invoices/invoices.service';

function toDto(row: Certification): CertificationDto {
  const cumulative = Number(row.cumulativeAmount);
  const period = Number(row.periodAmount);
  return {
    id: row.id,
    projectId: row.projectId,
    seq: row.seq,
    certDate: row.certDate,
    cumulativePct: Number(row.cumulativePct),
    cumulativeAmount: cumulative,
    previousAmount: round2(cumulative - period),
    periodAmount: period,
    retentionPct: Number(row.retentionPct),
    retentionAmount: Number(row.retentionAmount),
    status: row.status as CertificationDto['status'],
    invoiceId: row.invoiceId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class CertificationsService {
  constructor(
    private readonly dbs: DbService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async list(projectId?: string): Promise<CertificationDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(certifications.companyId, companyId),
      isNull(certifications.deletedAt),
    ];
    if (projectId) filters.push(eq(certifications.projectId, projectId));
    const rows = await this.dbs.db
      .select()
      .from(certifications)
      .where(and(...filters))
      .orderBy(asc(certifications.projectId), asc(certifications.seq));
    return rows.map(toDto);
  }

  /**
   * Nueva certificación a origen: el importe del periodo es la diferencia
   * entre el acumulado actual (contrato × %) y lo certificado antes.
   */
  async create(input: CertificationCreateInput): Promise<CertificationDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = certificationCreateSchema.parse(input);
    const project = await this.findProject(data.projectId);
    if (project.contractAmount === null) {
      throw new ConflictException(
        'La obra no tiene importe de contrato: es necesario para certificar a origen',
      );
    }

    const [prev] = await this.dbs.db
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.projectId, data.projectId),
          isNull(certifications.deletedAt),
        ),
      )
      .orderBy(desc(certifications.seq))
      .limit(1);

    const prevPct = prev ? Number(prev.cumulativePct) : 0;
    const prevCumulative = prev ? Number(prev.cumulativeAmount) : 0;
    if (data.cumulativePct <= prevPct) {
      throw new ConflictException(
        `El % a origen debe superar el ${prevPct.toFixed(2)} % ya certificado`,
      );
    }

    const retentionPct = data.retentionPct ?? Number(project.retentionPct);
    const { cumulativeAmount, periodAmount, retentionAmount } =
      computeCertification(
        Number(project.contractAmount),
        data.cumulativePct,
        prevCumulative,
        retentionPct,
      );

    const [row] = await this.dbs.db
      .insert(certifications)
      .values({
        companyId,
        projectId: data.projectId,
        seq: prev ? prev.seq + 1 : 1,
        certDate: data.certDate,
        cumulativePct: data.cumulativePct.toFixed(2),
        cumulativeAmount: cumulativeAmount.toFixed(2),
        periodAmount: periodAmount.toFixed(2),
        retentionPct: retentionPct.toFixed(2),
        retentionAmount: retentionAmount.toFixed(2),
        notes: data.notes ?? null,
      })
      .returning();
    return toDto(row);
  }

  /**
   * Emite la factura de venta de la certificación: crea la factura con el
   * desglose a origen, la aprueba (generando vencimientos con la retención
   * de garantía diferida) y deja la certificación como facturada.
   */
  async invoice(
    id: string,
    input: CertificationInvoiceInput,
  ): Promise<CertificationDto> {
    const cert = await this.find(id);
    if (cert.status !== 'borrador') {
      throw new ConflictException('La certificación ya está facturada');
    }
    const data = certificationInvoiceSchema.parse(input);
    const project = await this.findProject(cert.projectId);

    const pct = Number(cert.cumulativePct);
    const description =
      `Certificación nº ${cert.seq} — ${project.name} ` +
      `(${pct.toFixed(2)} % a origen; ` +
      `acumulado ${Number(cert.cumulativeAmount).toFixed(2)} €, ` +
      `anterior ${(Number(cert.cumulativeAmount) - Number(cert.periodAmount)).toFixed(2)} €)`;

    const invoiceDto = await this.invoicesService.create({
      kind: 'venta',
      contactId: data.contactId,
      invoiceNumber: data.invoiceNumber,
      issueDate: data.issueDate,
      dueDate: data.dueDate ?? null,
      isp: data.isp,
      retentionPct: Number(cert.retentionPct),
      retentionReleaseDate: data.retentionReleaseDate ?? null,
      notes: `Generada desde la certificación nº ${cert.seq} de la obra ${project.code}`,
      lines: [
        {
          description,
          baseAmount: Number(cert.periodAmount),
          vatPct: 21,
          projectId: cert.projectId,
        },
      ],
      deliveryNoteIds: [],
    });
    await this.invoicesService.approve(invoiceDto.id);

    const [row] = await this.dbs.db
      .update(certifications)
      .set({
        status: 'facturada',
        invoiceId: invoiceDto.id,
        updatedAt: new Date(),
      })
      .where(eq(certifications.id, id))
      .returning();
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const cert = await this.find(id);
    if (cert.status !== 'borrador') {
      throw new ConflictException(
        'No se puede eliminar una certificación facturada: anula antes su factura',
      );
    }
    const [last] = await this.dbs.db
      .select({ seq: certifications.seq })
      .from(certifications)
      .where(
        and(
          eq(certifications.projectId, cert.projectId),
          isNull(certifications.deletedAt),
        ),
      )
      .orderBy(desc(certifications.seq))
      .limit(1);
    if (last && last.seq !== cert.seq) {
      throw new ConflictException(
        'Solo se puede eliminar la última certificación de la obra',
      );
    }
    await this.dbs.db
      .update(certifications)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(certifications.id, id));
  }

  private async find(id: string): Promise<Certification> {
    const [row] = await this.dbs.db
      .select()
      .from(certifications)
      .where(and(eq(certifications.id, id), isNull(certifications.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Certificación no encontrada');
    }
    return row;
  }

  private async findProject(projectId: string) {
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Obra no encontrada');
    }
    return row;
  }
}
