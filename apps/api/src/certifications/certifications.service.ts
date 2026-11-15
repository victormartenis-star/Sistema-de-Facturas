import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, SQL, sql } from 'drizzle-orm';
import { Certification, certifications, projects, Tx } from '@erp/db';
import {
  CertificationCreateInput,
  CertificationDto,
  CertificationInvoiceInput,
  CertificationRectifyInput,
  CertStatus,
  PaginaDto,
  calcularOffset,
  construirPagina,
  certificationCreateSchema,
  certificationInvoiceSchema,
  certificationPctBlockReason,
  certificationRectifySchema,
  computeCertification,
  round2,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import {
  cambiarEstado,
  MENSAJE_ESTADO_CAMBIADO,
} from '../common/cambiar-estado';
import { DbService } from '../db/db.service';
import {
  condicionVersion,
  incrementarVersion,
  verificarVersion,
  falloActualizacion,
} from '../common/version';
import { InvoicesService } from '../invoices/invoices.service';

const UNIQUE_VIOLATION = '23505';

function toDto(
  row: Certification,
  originalSeq: number | null = null,
): CertificationDto {
  const cumulative = Number(row.cumulativeAmount);
  const period = Number(row.periodAmount);
  return {
    id: row.id,
    version: row.version,
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
    rectifiesCertificationId: row.rectifiesCertificationId,
    rectifiesCertificationSeq: row.rectifiesCertificationId
      ? originalSeq
      : null,
    rectificationReason: row.rectificationReason,
    rectificationMotive: row.rectificationMotive,
    rectificationType: row.rectificationType,
    facturaeReasonCode: row.facturaeReasonCode,
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
    private readonly audit: AuditService,
  ) {}

  /** Convierte filas a DTO resolviendo, en una sola consulta, el nº de la certificación original de las rectificativas. */
  private async toDtos(rows: Certification[]): Promise<CertificationDto[]> {
    const ids = [
      ...new Set(
        rows
          .map((r) => r.rectifiesCertificationId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const seqPorId = new Map<string, number>();
    if (ids.length > 0) {
      const originales = await this.dbs.db
        .select({ id: certifications.id, seq: certifications.seq })
        .from(certifications)
        .where(
          and(
            inArray(certifications.id, ids),
            eq(certifications.companyId, this.dbs.getCompanyId()),
          ),
        );
      for (const o of originales) seqPorId.set(o.id, o.seq);
    }
    return rows.map((r) =>
      toDto(
        r,
        r.rectifiesCertificationId
          ? (seqPorId.get(r.rectifiesCertificationId) ?? null)
          : null,
      ),
    );
  }

  async list(
    projectId?: string,
    status?: CertStatus,
    /** Con página, responde `PaginaDto` (lo último primero); sin ella, el array completo. */
    pagina?: { page: number; pageSize: number },
  ): Promise<CertificationDto[] | PaginaDto<CertificationDto>> {
    const companyId = this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters: SQL[] = [
      eq(certifications.companyId, companyId),
      isNull(certifications.deletedAt),
    ];
    if (allowed !== null) {
      if (allowed.length === 0) {
        return pagina
          ? construirPagina([], 0, pagina.page, pagina.pageSize)
          : [];
      }
      filters.push(inArray(certifications.projectId, allowed));
    }
    if (projectId) filters.push(eq(certifications.projectId, projectId));
    if (status) filters.push(eq(certifications.status, status));
    if (!pagina) {
      const rows = await this.dbs.db
        .select()
        .from(certifications)
        .where(and(...filters))
        .orderBy(
          asc(certifications.projectId),
          asc(certifications.seq),
          asc(certifications.id),
        );
      return this.toDtos(rows);
    }
    const [c] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(certifications)
      .where(and(...filters));
    const rows = await this.dbs.db
      .select()
      .from(certifications)
      .where(and(...filters))
      .orderBy(
        asc(certifications.projectId),
        desc(certifications.seq),
        desc(certifications.id),
      )
      .limit(pagina.pageSize)
      .offset(calcularOffset(pagina.page, pagina.pageSize));
    return construirPagina(
      await this.toDtos(rows),
      c?.n ?? 0,
      pagina.page,
      pagina.pageSize,
    );
  }

  /**
   * Nueva certificación a origen: el importe del periodo es la diferencia
   * entre el acumulado actual (contrato × %) y lo certificado antes.
   */
  async create(input: CertificationCreateInput): Promise<CertificationDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = certificationCreateSchema.parse(input);
    const project = await this.findProject(data.projectId);
    if (project.contractAmount === null) {
      throw new ConflictException(
        'La obra no tiene importe de contrato: es necesario para certificar a origen',
      );
    }

    // Se bloquea la fila de la obra: dos altas simultáneas se serializan y la
    // segunda ve la certificación anterior de la primera (seq y acumulado
    // correctos, sin chocar con el índice único).
    let row: Certification;
    try {
      row = await this.dbs.db.transaction(async (tx) => {
        await this.lockProject(tx, data.projectId);
        const [prev] = await tx
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
        const bloqueoPct = certificationPctBlockReason({
          cumulativePct: data.cumulativePct,
          previousPct: prevPct,
          isRectification: false,
        });
        if (bloqueoPct) throw new ConflictException(bloqueoPct);

        const retentionPct = data.retentionPct ?? Number(project.retentionPct);
        const { cumulativeAmount, periodAmount, retentionAmount } =
          computeCertification(
            Number(project.contractAmount),
            data.cumulativePct,
            prevCumulative,
            retentionPct,
          );

        const [created] = await tx
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
        await this.audit.registrar(tx, {
          entityType: 'certification',
          entityId: created.id,
          action: 'create',
          newData: created,
        });
        return created;
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          'Ya existe una certificación con ese número en la obra: reintenta',
        );
      }
      throw err;
    }
    return (await this.toDtos([row]))[0];
  }

  /**
   * Certificación rectificativa: fija un nuevo acumulado a origen (que puede
   * bajar) para corregir una certificación ya facturada. Al facturarla se emite
   * una factura rectificativa por diferencias sobre la factura de la corregida.
   */
  async rectify(
    id: string,
    input: CertificationRectifyInput,
    versionEsperada?: number,
  ): Promise<CertificationDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = certificationRectifySchema.parse(input);
    const orig = await this.find(id);
    verificarVersion(orig.version, versionEsperada);
    if (orig.status !== 'facturada' || !orig.invoiceId) {
      throw new ConflictException(
        'Solo se rectifica una certificación facturada',
      );
    }
    const project = await this.findProject(orig.projectId);
    if (project.contractAmount === null) {
      throw new ConflictException(
        'La obra no tiene importe de contrato: es necesario para certificar a origen',
      );
    }

    let row: Certification;
    try {
      row = await this.dbs.db.transaction(async (tx) => {
        await this.lockProject(tx, orig.projectId);
        const [locked] = await tx
          .select({ status: certifications.status })
          .from(certifications)
          .where(
            and(eq(certifications.id, id), isNull(certifications.deletedAt)),
          )
          .for('update');
        if (!locked || locked.status !== 'facturada') {
          throw new ConflictException(
            'Solo se rectifica una certificación facturada',
          );
        }
        const [prev] = await tx
          .select()
          .from(certifications)
          .where(
            and(
              eq(certifications.projectId, orig.projectId),
              isNull(certifications.deletedAt),
            ),
          )
          .orderBy(desc(certifications.seq))
          .limit(1);
        if (prev.status !== 'facturada') {
          throw new ConflictException(
            `Factura o elimina antes la certificación nº ${prev.seq} (borrador) para poder rectificar`,
          );
        }
        const bloqueoPct = certificationPctBlockReason({
          cumulativePct: data.cumulativePct,
          previousPct: Number(prev.cumulativePct),
          isRectification: true,
        });
        if (bloqueoPct) throw new ConflictException(bloqueoPct);

        const retentionPct = Number(orig.retentionPct);
        const { cumulativeAmount, periodAmount, retentionAmount } =
          computeCertification(
            Number(project.contractAmount),
            data.cumulativePct,
            Number(prev.cumulativeAmount),
            retentionPct,
          );
        const [created] = await tx
          .insert(certifications)
          .values({
            companyId,
            projectId: orig.projectId,
            seq: prev.seq + 1,
            certDate: data.certDate,
            cumulativePct: data.cumulativePct.toFixed(2),
            cumulativeAmount: cumulativeAmount.toFixed(2),
            periodAmount: periodAmount.toFixed(2),
            retentionPct: retentionPct.toFixed(2),
            retentionAmount: retentionAmount.toFixed(2),
            notes: data.notes ?? null,
            rectifiesCertificationId: orig.id,
            rectificationReason: data.motivo,
            rectificationMotive: data.rectificationMotive,
            rectificationType: data.rectificationType,
            facturaeReasonCode: data.facturaeReasonCode,
          })
          .returning();
        await this.audit.registrar(tx, {
          entityType: 'certification',
          entityId: created.id,
          action: 'create',
          newData: created,
        });
        return created;
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          'Ya existe una certificación con ese número en la obra: reintenta',
        );
      }
      throw err;
    }
    return (await this.toDtos([row]))[0];
  }

  /**
   * Factura de una certificación rectificativa: genera una factura
   * rectificativa por diferencias sobre la factura de la certificación
   * corregida, la aprueba y deja la certificación como facturada.
   */
  private async invoiceRectification(
    cert: Certification,
    data: ReturnType<typeof certificationInvoiceSchema.parse>,
    versionEsperada?: number,
  ): Promise<CertificationDto> {
    const id = cert.id;
    const [origCert] = await this.dbs.db
      .select()
      .from(certifications)
      .where(eq(certifications.id, cert.rectifiesCertificationId as string))
      .limit(1);
    if (!origCert?.invoiceId) {
      throw new ConflictException(
        'La certificación corregida ya no tiene factura: rectifica la factura directamente',
      );
    }
    // get() aplica el acceso por obra y el 404 habitual.
    const origInvoice = await this.invoicesService.get(origCert.invoiceId);
    if (data.contactId !== origInvoice.contactId) {
      throw new ConflictException(
        'La rectificativa se emite al mismo cliente que la factura original',
      );
    }
    const period = Number(cert.periodAmount);
    if (period === 0) {
      throw new ConflictException(
        'La certificación rectificativa no cambia el importe: no hay nada que facturar',
      );
    }
    const project = await this.findProject(cert.projectId);
    const description =
      `Rectificación de la certificación nº ${origCert.seq} — ${project.name} ` +
      `(${Number(cert.cumulativePct).toFixed(2)} % a origen; ` +
      `acumulado ${Number(cert.cumulativeAmount).toFixed(2)} €)`;

    const row = await this.dbs.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          status: certifications.status,
          version: certifications.version,
        })
        .from(certifications)
        .where(and(eq(certifications.id, id), isNull(certifications.deletedAt)))
        .for('update');
      if (!locked) throw new NotFoundException('Certificación no encontrada');
      verificarVersion(locked.version, versionEsperada);
      if (locked.status !== 'borrador') {
        throw new ConflictException('La certificación ya está facturada');
      }
      const { row: invoice, contact } =
        await this.invoicesService.crearRectificativaEnTx(
          tx,
          origCert.invoiceId as string,
          {
            clase: 'diferencias',
            issueDate: data.issueDate,
            motivo:
              cert.rectificationReason ?? 'Rectificación de certificación',
            // Se heredan de la certificación rectificativa (validados al crearla).
            rectificationMotive: cert.rectificationMotive,
            rectificationType: cert.rectificationType,
            facturaeReasonCode: cert.facturaeReasonCode,
            lines: [
              {
                description,
                baseAmount: period,
                vatPct: origInvoice.lines[0]?.vatPct ?? 21,
                projectId: cert.projectId,
              },
            ],
          },
        );
      await this.invoicesService.aprobarEnTx(tx, invoice, contact);
      const updated = await cambiarEstado(
        tx,
        certifications,
        'certification',
        id,
        'borrador',
        'facturada',
        { invoiceId: invoice.id },
        versionEsperada,
      );
      await this.audit.registrar(tx, [
        {
          entityType: 'invoice',
          entityId: invoice.id,
          action: 'create',
          newData: {
            invoiceId: invoice.id,
            kind: 'venta',
            rectifies: origCert.invoiceId,
            status: 'aprobada',
          },
        },
        {
          entityType: 'certification',
          entityId: id,
          action: 'update',
          newData: { status: 'facturada', invoiceId: invoice.id },
        },
      ]);
      return updated;
    });
    return (await this.toDtos([row]))[0];
  }

  /**
   * Emite la factura de venta de la certificación: crea la factura con el
   * desglose a origen, la aprueba (generando vencimientos con la retención
   * de garantía diferida) y deja la certificación como facturada.
   */
  async invoice(
    id: string,
    input: CertificationInvoiceInput,
    versionEsperada?: number,
  ): Promise<CertificationDto> {
    const cert = await this.find(id);
    verificarVersion(cert.version, versionEsperada);
    if (cert.status !== 'borrador') {
      throw new ConflictException('La certificación ya está facturada');
    }
    const data = certificationInvoiceSchema.parse(input);
    if (cert.rectifiesCertificationId) {
      return this.invoiceRectification(cert, data, versionEsperada);
    }
    const project = await this.findProject(cert.projectId);

    const pct = Number(cert.cumulativePct);
    const description =
      `Certificación nº ${cert.seq} — ${project.name} ` +
      `(${pct.toFixed(2)} % a origen; ` +
      `acumulado ${Number(cert.cumulativeAmount).toFixed(2)} €, ` +
      `anterior ${(Number(cert.cumulativeAmount) - Number(cert.periodAmount)).toFixed(2)} €)`;

    const prep = await this.invoicesService.prepararCreacion({
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

    // Crear la factura, aprobarla (vencimientos) y marcar la certificación
    // como facturada es una sola operación: o ocurre todo o nada. El bloqueo
    // de la certificación impide facturarla dos veces en paralelo.
    const row = await this.dbs.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          status: certifications.status,
          version: certifications.version,
        })
        .from(certifications)
        .where(and(eq(certifications.id, id), isNull(certifications.deletedAt)))
        .for('update');
      if (!locked) throw new NotFoundException('Certificación no encontrada');
      verificarVersion(locked.version, versionEsperada);
      if (locked.status !== 'borrador') {
        throw new ConflictException('La certificación ya está facturada');
      }
      const invoice = await this.invoicesService.crearEnTx(
        tx,
        prep.companyId,
        prep.data,
        prep.amounts,
      );
      await this.invoicesService.aprobarEnTx(tx, invoice, prep.contact);
      const updated = await cambiarEstado(
        tx,
        certifications,
        'certification',
        id,
        'borrador',
        'facturada',
        { invoiceId: invoice.id },
        versionEsperada,
      );
      // Auditoría dentro de la transacción: una sola llamada, lo último.
      await this.audit.registrar(tx, [
        {
          entityType: 'invoice',
          entityId: invoice.id,
          action: 'create',
          newData: { invoiceId: invoice.id, kind: 'venta', status: 'borrador' },
        },
        {
          entityType: 'invoice',
          entityId: invoice.id,
          action: 'update',
          newData: { status: 'aprobada' },
        },
        {
          entityType: 'certification',
          entityId: id,
          action: 'update',
          newData: { status: 'facturada', invoiceId: invoice.id },
        },
      ]);
      return updated;
    });
    return (await this.toDtos([row]))[0];
  }

  async remove(id: string, versionEsperada?: number): Promise<void> {
    const cert = await this.find(id);
    verificarVersion(cert.version, versionEsperada);
    if (cert.status !== 'borrador') {
      throw new ConflictException(
        'No se puede eliminar una certificación facturada: rectifica antes su factura',
      );
    }
    // Misma exclusión por obra que `create`: sin ella, un alta simultánea
    // puede dejar de ser la "última" justo después de comprobarlo.
    await this.dbs.db.transaction(async (tx) => {
      await this.lockProject(tx, cert.projectId);
      const [last] = await tx
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
      // Solo borradores: la condición va en el UPDATE (una facturación
      // concurrente no deja una certificación facturada borrada).
      const borradas = await tx
        .update(certifications)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: incrementarVersion(certifications),
        })
        .where(
          and(
            eq(certifications.id, id),
            eq(certifications.status, 'borrador'),
            condicionVersion(certifications, versionEsperada),
          ),
        )
        .returning({ id: certifications.id });
      if (borradas.length === 0) {
        await falloActualizacion(
          tx,
          certifications,
          id,
          versionEsperada,
          () => new ConflictException(MENSAJE_ESTADO_CAMBIADO),
          'Certificación no encontrada',
        );
      }
      await this.audit.registrar(tx, {
        entityType: 'certification',
        entityId: id,
        action: 'delete',
        oldData: cert,
      });
    });
  }

  /** Bloquea la fila de la obra hasta el fin de la transacción (serializa altas/bajas). */
  private async lockProject(tx: Tx, projectId: string): Promise<void> {
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
  }

  private async find(id: string): Promise<Certification> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.id, id),
          eq(certifications.companyId, companyId),
          isNull(certifications.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException('Certificación no encontrada');
    }
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(row.projectId)) {
      throw new NotFoundException('Certificación no encontrada');
    }
    return row;
  }

  private async findProject(projectId: string) {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
    const [row] = await this.dbs.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException('Obra no encontrada');
    }
    return row;
  }
}
