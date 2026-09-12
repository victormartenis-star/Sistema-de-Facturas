import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import {
  CertificationLine,
  certificationLines,
  certifications,
  budgetItems,
} from '@erp/db';
import {
  CertificationLineCreateInput,
  CertificationLineDto,
  CertificationLineUpdateInput,
} from '@erp/shared';
import { DbService } from '../db/db.service';

function toDto(row: CertificationLine): CertificationLineDto {
  return {
    id: row.id,
    certificationId: row.certificationId,
    budgetItemId: row.budgetItemId,
    cumulativePct: Number(row.cumulativePct),
    cumulativeAmount: Number(row.cumulativeAmount),
    periodAmount: Number(row.periodAmount),
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class CertificationLinesService {
  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  /** Verifica que la certificación existe y pertenece a la empresa del contexto. */
  private async findCert(certId: string) {
    const companyId = this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters = [
      eq(certifications.id, certId),
      eq(certifications.companyId, companyId),
      isNull(certifications.deletedAt),
    ];
    if (allowed !== null) filters.push(inArray(certifications.projectId, allowed));
    const [cert] = await this.db
      .select({ id: certifications.id })
      .from(certifications)
      .where(and(...filters))
      .limit(1);
    if (!cert)
      throw new NotFoundException(`Certificación ${certId} no encontrada`);
    return cert;
  }

  async list(certId: string): Promise<CertificationLineDto[]> {
    await this.findCert(certId);
    const rows = await this.db
      .select()
      .from(certificationLines)
      .where(eq(certificationLines.certificationId, certId));
    return rows.map(toDto);
  }

  async create(
    certId: string,
    input: CertificationLineCreateInput,
  ): Promise<CertificationLineDto> {
    await this.findCert(certId);

    // Verificar que la partida existe
    const [item] = await this.db
      .select({ id: budgetItems.id })
      .from(budgetItems)
      .where(eq(budgetItems.id, input.budgetItemId))
      .limit(1);
    if (!item)
      throw new NotFoundException(
        `Partida ${input.budgetItemId} no encontrada`,
      );

    try {
      const [row] = await this.db
        .insert(certificationLines)
        .values({
          certificationId: certId,
          budgetItemId: input.budgetItemId,
          cumulativePct: String(input.cumulativePct),
          cumulativeAmount: String(input.cumulativeAmount),
          periodAmount: String(input.periodAmount),
          notes: input.notes ?? null,
        })
        .returning();
      return toDto(row);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '23505')
        throw new ConflictException(
          `Ya existe una línea para la partida ${input.budgetItemId} en esta certificación`,
        );
      throw err;
    }
  }

  async update(
    certId: string,
    lineId: string,
    input: CertificationLineUpdateInput,
  ): Promise<CertificationLineDto> {
    await this.findCert(certId);
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (input.cumulativePct !== undefined)
      values['cumulativePct'] = String(input.cumulativePct);
    if (input.cumulativeAmount !== undefined)
      values['cumulativeAmount'] = String(input.cumulativeAmount);
    if (input.periodAmount !== undefined)
      values['periodAmount'] = String(input.periodAmount);
    if (input.notes !== undefined) values['notes'] = input.notes ?? null;

    const [row] = await this.db
      .update(certificationLines)
      .set(values)
      .where(
        and(
          eq(certificationLines.id, lineId),
          eq(certificationLines.certificationId, certId),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException(`Línea ${lineId} no encontrada`);
    return toDto(row);
  }

  async remove(certId: string, lineId: string): Promise<void> {
    await this.findCert(certId);
    const [row] = await this.db
      .delete(certificationLines)
      .where(
        and(
          eq(certificationLines.id, lineId),
          eq(certificationLines.certificationId, certId),
        ),
      )
      .returning({ id: certificationLines.id });
    if (!row)
      throw new NotFoundException(`Línea ${lineId} no encontrada`);
  }
}
