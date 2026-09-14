import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  ActaRecepcion,
  ActaRecepcionRepaso,
  NewActaRecepcion,
  actaRecepcionRepasos,
  actasRecepcion,
} from '@erp/db';
import {
  ActaRecepcionCreateInput,
  ActaRecepcionDto,
  ActaRecepcionRepasoDto,
  ActaRecepcionUpdateInput,
  RepasoCreateInput,
  RepasoUpdateInput,
  computeActaEstadoFirma,
  computeRepasosProgreso,
} from '@erp/shared';
import { DbService } from '../../db/db.service';

function toDto(row: ActaRecepcion): ActaRecepcionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    tipo: row.tipo,
    fecha: row.fecha,
    estado: row.estado,
    documentId: row.documentId,
    notas: row.notas,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRepasoDto(row: ActaRecepcionRepaso): ActaRecepcionRepasoDto {
  return {
    id: row.id,
    actaId: row.actaId,
    descripcion: row.descripcion,
    responsable: row.responsable,
    fechaLimite: row.fechaLimite,
    estado: row.estado,
    fechaSubsanacion: row.fechaSubsanacion,
    sortOrder: row.sortOrder,
  };
}

@Injectable()
export class ActasRecepcionService {
  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  private getCompanyId(): string {
    return this.dbs.getCompanyId();
  }

  async list(
    projectId?: string,
    tipo?: ActaRecepcion['tipo'],
  ): Promise<ActaRecepcionDto[]> {
    const companyId = this.getCompanyId();
    const filters = [
      eq(actasRecepcion.companyId, companyId),
      isNull(actasRecepcion.deletedAt),
    ];
    if (projectId) filters.push(eq(actasRecepcion.projectId, projectId));
    if (tipo) filters.push(eq(actasRecepcion.tipo, tipo));

    const rows = await this.db
      .select()
      .from(actasRecepcion)
      .where(and(...filters))
      .orderBy(asc(actasRecepcion.fecha));
    return rows.map(toDto);
  }

  private async getRow(id: string): Promise<ActaRecepcion> {
    const companyId = this.getCompanyId();
    const [row] = await this.db
      .select()
      .from(actasRecepcion)
      .where(
        and(
          eq(actasRecepcion.id, id),
          eq(actasRecepcion.companyId, companyId),
          isNull(actasRecepcion.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Acta de recepción no encontrada');
    return row;
  }

  async get(id: string): Promise<ActaRecepcionDto> {
    return toDto(await this.getRow(id));
  }

  async create(body: ActaRecepcionCreateInput): Promise<ActaRecepcionDto> {
    const companyId = this.getCompanyId();
    const values: NewActaRecepcion = {
      companyId,
      projectId: body.projectId,
      tipo: body.tipo,
      fecha: body.fecha,
      documentId: body.documentId,
      notas: body.notas,
    };
    const [row] = await this.db
      .insert(actasRecepcion)
      .values(values)
      .returning();
    return toDto(row);
  }

  async update(
    id: string,
    body: ActaRecepcionUpdateInput,
  ): Promise<ActaRecepcionDto> {
    await this.getRow(id);
    const [row] = await this.db
      .update(actasRecepcion)
      .set({
        ...(body.tipo !== undefined && { tipo: body.tipo }),
        ...(body.fecha !== undefined && { fecha: body.fecha }),
        ...(body.documentId !== undefined && { documentId: body.documentId }),
        ...(body.notas !== undefined && { notas: body.notas }),
        updatedAt: new Date(),
      })
      .where(eq(actasRecepcion.id, id))
      .returning();
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.getRow(id);
    await this.db
      .update(actasRecepcion)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(actasRecepcion.id, id));
  }

  async listRepasos(actaId: string): Promise<ActaRecepcionRepasoDto[]> {
    await this.getRow(actaId);
    const rows = await this.db
      .select()
      .from(actaRecepcionRepasos)
      .where(eq(actaRecepcionRepasos.actaId, actaId))
      .orderBy(asc(actaRecepcionRepasos.sortOrder));
    return rows.map(toRepasoDto);
  }

  async addRepaso(
    actaId: string,
    body: RepasoCreateInput,
  ): Promise<ActaRecepcionRepasoDto> {
    await this.getRow(actaId);
    const [row] = await this.db
      .insert(actaRecepcionRepasos)
      .values({
        actaId,
        descripcion: body.descripcion,
        responsable: body.responsable,
        fechaLimite: body.fechaLimite,
      })
      .returning();
    return toRepasoDto(row);
  }

  async updateRepaso(
    repasoId: string,
    body: RepasoUpdateInput,
  ): Promise<ActaRecepcionRepasoDto> {
    const [row] = await this.db
      .update(actaRecepcionRepasos)
      .set({
        ...(body.descripcion !== undefined && {
          descripcion: body.descripcion,
        }),
        ...(body.responsable !== undefined && {
          responsable: body.responsable,
        }),
        ...(body.fechaLimite !== undefined && {
          fechaLimite: body.fechaLimite,
        }),
        ...(body.estado !== undefined && { estado: body.estado }),
        ...(body.fechaSubsanacion !== undefined && {
          fechaSubsanacion: body.fechaSubsanacion,
        }),
        updatedAt: new Date(),
      })
      .where(eq(actaRecepcionRepasos.id, repasoId))
      .returning();
    if (!row) throw new NotFoundException('Repaso no encontrado');
    return toRepasoDto(row);
  }

  /**
   * Firma el acta: `firmada_sin_reservas` si no queda ningún repaso
   * pendiente, `firmada_con_reservas` en caso contrario — regla pura de
   * `computeActaEstadoFirma`, no una elección manual del usuario.
   */
  async firmar(actaId: string): Promise<ActaRecepcionDto> {
    await this.getRow(actaId);
    const repasos = await this.listRepasos(actaId);
    const estado = computeActaEstadoFirma(repasos);
    const [row] = await this.db
      .update(actasRecepcion)
      .set({ estado, updatedAt: new Date() })
      .where(eq(actasRecepcion.id, actaId))
      .returning();
    return toDto(row);
  }

  async progresoRepasos(actaId: string) {
    const repasos = await this.listRepasos(actaId);
    return computeRepasosProgreso(repasos);
  }
}
