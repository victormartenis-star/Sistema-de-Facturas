import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  ContratoObra,
  ContratoObraAnexo,
  NewContratoObra,
  contratoObraAnexos,
  contratosObra,
} from '@erp/db';
import {
  ContratoObraAnexoCreateInput,
  ContratoObraAnexoDto,
  ContratoObraCreateInput,
  ContratoObraDto,
  ContratoObraUpdateInput,
  validarFirmaContrato,
} from '@erp/shared';
import { DbService } from '../../db/db.service';
import { ComplianceService } from '../../compliance/compliance.service';

function toDto(row: ContratoObra): ContratoObraDto {
  return {
    id: row.id,
    projectId: row.projectId,
    contactId: row.contactId,
    tipo: row.tipo,
    importe: Number(row.importe),
    fechaFirma: row.fechaFirma,
    documentId: row.documentId,
    estadoFirma: row.estadoFirma,
    retencionPct: Number(row.retencionPct),
    condicionesAbono: row.condicionesAbono,
    notas: row.notas,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAnexoDto(row: ContratoObraAnexo): ContratoObraAnexoDto {
  return {
    id: row.id,
    contratoId: row.contratoId,
    documentId: row.documentId,
    descripcion: row.descripcion,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ContratosObraService {
  constructor(
    private readonly dbs: DbService,
    private readonly compliance: ComplianceService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  private getCompanyId(): string {
    return this.dbs.getCompanyId();
  }

  async list(
    projectId?: string,
    estadoFirma?: ContratoObra['estadoFirma'],
  ): Promise<ContratoObraDto[]> {
    const companyId = this.getCompanyId();
    const filters = [
      eq(contratosObra.companyId, companyId),
      isNull(contratosObra.deletedAt),
    ];
    if (projectId) filters.push(eq(contratosObra.projectId, projectId));
    if (estadoFirma) filters.push(eq(contratosObra.estadoFirma, estadoFirma));

    const rows = await this.db
      .select()
      .from(contratosObra)
      .where(and(...filters))
      .orderBy(asc(contratosObra.createdAt));
    return rows.map(toDto);
  }

  private async getRow(id: string): Promise<ContratoObra> {
    const companyId = this.getCompanyId();
    const [row] = await this.db
      .select()
      .from(contratosObra)
      .where(
        and(
          eq(contratosObra.id, id),
          eq(contratosObra.companyId, companyId),
          isNull(contratosObra.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Contrato no encontrado');
    return row;
  }

  async get(id: string): Promise<ContratoObraDto> {
    return toDto(await this.getRow(id));
  }

  async create(body: ContratoObraCreateInput): Promise<ContratoObraDto> {
    const companyId = this.getCompanyId();
    const values: NewContratoObra = {
      companyId,
      projectId: body.projectId,
      contactId: body.contactId,
      tipo: body.tipo,
      importe: body.importe.toFixed(2),
      fechaFirma: body.fechaFirma,
      documentId: body.documentId,
      retencionPct: body.retencionPct?.toFixed(2),
      condicionesAbono: body.condicionesAbono,
      notas: body.notas,
    };
    const [row] = await this.db
      .insert(contratosObra)
      .values(values)
      .returning();
    return toDto(row);
  }

  /**
   * Actualiza un contrato. Si el body pide pasar a `estadoFirma: 'firmado'`,
   * exige PDF + fecha de firma (`validarFirmaContrato`) y, si el contacto
   * está sujeto a CAE, que esté homologado — reutiliza la regla central de
   * `ComplianceService` en lugar de duplicarla.
   */
  async update(
    id: string,
    body: ContratoObraUpdateInput,
  ): Promise<ContratoObraDto> {
    const current = await this.getRow(id);

    if (body.estadoFirma === 'firmado') {
      const documentId =
        body.documentId !== undefined ? body.documentId : current.documentId;
      const fechaFirma =
        body.fechaFirma !== undefined ? body.fechaFirma : current.fechaFirma;
      const errores = validarFirmaContrato({
        documentId: documentId ?? null,
        fechaFirma: fechaFirma ?? null,
      });
      if (errores.length > 0) {
        throw new BadRequestException({
          message: 'No se puede firmar el contrato',
          errors: errores,
        });
      }
      await this.compliance.assertCanTransact(
        current.contactId,
        'firmar el contrato',
      );
    }

    const [row] = await this.db
      .update(contratosObra)
      .set({
        ...(body.tipo !== undefined && { tipo: body.tipo }),
        ...(body.importe !== undefined && {
          importe: body.importe.toFixed(2),
        }),
        ...(body.fechaFirma !== undefined && { fechaFirma: body.fechaFirma }),
        ...(body.documentId !== undefined && { documentId: body.documentId }),
        ...(body.estadoFirma !== undefined && {
          estadoFirma: body.estadoFirma,
        }),
        ...(body.retencionPct !== undefined && {
          retencionPct: body.retencionPct.toFixed(2),
        }),
        ...(body.condicionesAbono !== undefined && {
          condicionesAbono: body.condicionesAbono,
        }),
        ...(body.notas !== undefined && { notas: body.notas }),
        updatedAt: new Date(),
      })
      .where(eq(contratosObra.id, id))
      .returning();
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.getRow(id);
    await this.db
      .update(contratosObra)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(contratosObra.id, id));
  }

  async listAnexos(contratoId: string): Promise<ContratoObraAnexoDto[]> {
    await this.getRow(contratoId);
    const rows = await this.db
      .select()
      .from(contratoObraAnexos)
      .where(eq(contratoObraAnexos.contratoId, contratoId))
      .orderBy(asc(contratoObraAnexos.createdAt));
    return rows.map(toAnexoDto);
  }

  async addAnexo(
    contratoId: string,
    body: ContratoObraAnexoCreateInput,
  ): Promise<ContratoObraAnexoDto> {
    await this.getRow(contratoId);
    const [row] = await this.db
      .insert(contratoObraAnexos)
      .values({
        contratoId,
        documentId: body.documentId,
        descripcion: body.descripcion,
      })
      .returning();
    return toAnexoDto(row);
  }

  /**
   * Documentación CAE obligatoria del contacto ligado al contrato: reusa
   * `ComplianceService` en vez de duplicar el cálculo de vigencia.
   */
  async validarDocumentacionCAE(contratoId: string) {
    const contrato = await this.getRow(contratoId);
    return this.compliance.summary(contrato.contactId);
  }
}
