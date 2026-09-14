import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { IncidenciaPRL, NewIncidenciaPRL, incidenciasPRL } from '@erp/db';
import {
  IncidenciaPRLCreateInput,
  IncidenciaPRLDto,
  IncidenciaPRLUpdateInput,
  isIncidenciaFueraDePlazo,
  todayIso,
} from '@erp/shared';
import { DbService } from '../../db/db.service';

function toDto(row: IncidenciaPRL, today: string): IncidenciaPRLDto {
  return {
    id: row.id,
    projectId: row.projectId,
    fecha: row.fecha,
    puntoInspeccion: row.puntoInspeccion,
    descripcion: row.descripcion,
    gravedad: row.gravedad,
    estado: row.estado,
    responsableSubsanacion: row.responsableSubsanacion,
    fechaLimiteSubsanacion: row.fechaLimiteSubsanacion,
    fechaCierre: row.fechaCierre,
    documentId: row.documentId,
    notas: row.notas,
    fueraDePlazo: isIncidenciaFueraDePlazo(row, today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class IncidenciasPRLService {
  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  private getCompanyId(): string {
    return this.dbs.getCompanyId();
  }

  async list(
    projectId?: string,
    estado?: IncidenciaPRL['estado'],
  ): Promise<IncidenciaPRLDto[]> {
    const companyId = this.getCompanyId();
    const filters = [
      eq(incidenciasPRL.companyId, companyId),
      isNull(incidenciasPRL.deletedAt),
    ];
    if (projectId) filters.push(eq(incidenciasPRL.projectId, projectId));
    if (estado) filters.push(eq(incidenciasPRL.estado, estado));

    const rows = await this.db
      .select()
      .from(incidenciasPRL)
      .where(and(...filters))
      .orderBy(asc(incidenciasPRL.fecha));
    const today = todayIso();
    return rows.map((r) => toDto(r, today));
  }

  /** Incidencias abiertas o en subsanación cuyo plazo ya venció. */
  async fueraDePlazo(projectId?: string): Promise<IncidenciaPRLDto[]> {
    const todas = await this.list(projectId);
    return todas.filter((i) => i.fueraDePlazo);
  }

  private async getRow(id: string): Promise<IncidenciaPRL> {
    const companyId = this.getCompanyId();
    const [row] = await this.db
      .select()
      .from(incidenciasPRL)
      .where(
        and(
          eq(incidenciasPRL.id, id),
          eq(incidenciasPRL.companyId, companyId),
          isNull(incidenciasPRL.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Incidencia no encontrada');
    return row;
  }

  async get(id: string): Promise<IncidenciaPRLDto> {
    return toDto(await this.getRow(id), todayIso());
  }

  async create(body: IncidenciaPRLCreateInput): Promise<IncidenciaPRLDto> {
    const companyId = this.getCompanyId();
    const values: NewIncidenciaPRL = {
      companyId,
      projectId: body.projectId,
      fecha: body.fecha,
      puntoInspeccion: body.puntoInspeccion,
      descripcion: body.descripcion,
      gravedad: body.gravedad,
      responsableSubsanacion: body.responsableSubsanacion,
      fechaLimiteSubsanacion: body.fechaLimiteSubsanacion,
      documentId: body.documentId,
      notas: body.notas,
    };
    const [row] = await this.db
      .insert(incidenciasPRL)
      .values(values)
      .returning();
    return toDto(row, todayIso());
  }

  async update(
    id: string,
    body: IncidenciaPRLUpdateInput,
  ): Promise<IncidenciaPRLDto> {
    await this.getRow(id);
    // Cerrar la incidencia fija la fecha de cierre a hoy, salvo que venga indicada.
    const fechaCierre =
      body.estado === 'cerrada'
        ? (body.fechaCierre ?? todayIso())
        : body.fechaCierre;

    const [row] = await this.db
      .update(incidenciasPRL)
      .set({
        ...(body.fecha !== undefined && { fecha: body.fecha }),
        ...(body.puntoInspeccion !== undefined && {
          puntoInspeccion: body.puntoInspeccion,
        }),
        ...(body.descripcion !== undefined && {
          descripcion: body.descripcion,
        }),
        ...(body.gravedad !== undefined && { gravedad: body.gravedad }),
        ...(body.estado !== undefined && { estado: body.estado }),
        ...(body.responsableSubsanacion !== undefined && {
          responsableSubsanacion: body.responsableSubsanacion,
        }),
        ...(body.fechaLimiteSubsanacion !== undefined && {
          fechaLimiteSubsanacion: body.fechaLimiteSubsanacion,
        }),
        ...(fechaCierre !== undefined && { fechaCierre }),
        ...(body.documentId !== undefined && { documentId: body.documentId }),
        ...(body.notas !== undefined && { notas: body.notas }),
        updatedAt: new Date(),
      })
      .where(eq(incidenciasPRL.id, id))
      .returning();
    return toDto(row, todayIso());
  }

  async remove(id: string): Promise<void> {
    await this.getRow(id);
    await this.db
      .update(incidenciasPRL)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(incidenciasPRL.id, id));
  }
}
