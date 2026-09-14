import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NewPermisoPublico, PermisoPublico, permisosPublicos } from '@erp/db';
import {
  PermisoCreateInput,
  PermisoPublicoDto,
  PermisoUpdateInput,
  computePermisoAlertLevel,
  computePermisoAlerts,
  todayIso,
} from '@erp/shared';
import { DbService } from '../../db/db.service';

function toDto(row: PermisoPublico, today: string): PermisoPublicoDto {
  return {
    id: row.id,
    projectId: row.projectId,
    tipo: row.tipo,
    organismoPublico: row.organismoPublico,
    numeroExpediente: row.numeroExpediente,
    fechaSolicitud: row.fechaSolicitud,
    fechaResolucion: row.fechaResolucion,
    fechaVencimiento: row.fechaVencimiento,
    status: row.status,
    canonImporte: row.canonImporte === null ? null : Number(row.canonImporte),
    documentId: row.documentId,
    notas: row.notas,
    alertLevel: computePermisoAlertLevel(row, today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class PermisosService {
  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  private getCompanyId(): string {
    return this.dbs.getCompanyId();
  }

  /** Lista permisos de una obra, opcionalmente filtrados por estado. */
  async list(
    projectId?: string,
    status?: PermisoPublico['status'],
  ): Promise<PermisoPublicoDto[]> {
    const companyId = this.getCompanyId();
    const filters = [
      eq(permisosPublicos.companyId, companyId),
      isNull(permisosPublicos.deletedAt),
    ];
    if (projectId) filters.push(eq(permisosPublicos.projectId, projectId));
    if (status) filters.push(eq(permisosPublicos.status, status));

    const rows = await this.db
      .select()
      .from(permisosPublicos)
      .where(and(...filters))
      .orderBy(asc(permisosPublicos.fechaVencimiento));
    const today = todayIso();
    return rows.map((r) => toDto(r, today));
  }

  /** Permisos concedidos vencidos o próximos a caducar, para el aviso previo a renovación. */
  async alertas(projectId?: string) {
    const companyId = this.getCompanyId();
    const filters = [
      eq(permisosPublicos.companyId, companyId),
      isNull(permisosPublicos.deletedAt),
    ];
    if (projectId) filters.push(eq(permisosPublicos.projectId, projectId));

    const permisos = await this.db
      .select()
      .from(permisosPublicos)
      .where(and(...filters));
    return computePermisoAlerts(permisos, todayIso());
  }

  private async getRow(id: string): Promise<PermisoPublico> {
    const companyId = this.getCompanyId();
    const [row] = await this.db
      .select()
      .from(permisosPublicos)
      .where(
        and(
          eq(permisosPublicos.id, id),
          eq(permisosPublicos.companyId, companyId),
          isNull(permisosPublicos.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Permiso no encontrado');
    return row;
  }

  async get(id: string): Promise<PermisoPublicoDto> {
    return toDto(await this.getRow(id), todayIso());
  }

  async create(body: PermisoCreateInput): Promise<PermisoPublicoDto> {
    const companyId = this.getCompanyId();
    const values: NewPermisoPublico = {
      companyId,
      projectId: body.projectId,
      tipo: body.tipo,
      organismoPublico: body.organismoPublico,
      numeroExpediente: body.numeroExpediente,
      fechaSolicitud: body.fechaSolicitud,
      fechaResolucion: body.fechaResolucion,
      fechaVencimiento: body.fechaVencimiento,
      status: body.status,
      canonImporte: body.canonImporte?.toFixed(2),
      documentId: body.documentId,
      notas: body.notas,
    };
    const [row] = await this.db
      .insert(permisosPublicos)
      .values(values)
      .returning();
    return toDto(row, todayIso());
  }

  async update(
    id: string,
    body: PermisoUpdateInput,
  ): Promise<PermisoPublicoDto> {
    await this.getRow(id);
    const [row] = await this.db
      .update(permisosPublicos)
      .set({
        ...(body.tipo !== undefined && { tipo: body.tipo }),
        ...(body.organismoPublico !== undefined && {
          organismoPublico: body.organismoPublico,
        }),
        ...(body.numeroExpediente !== undefined && {
          numeroExpediente: body.numeroExpediente,
        }),
        ...(body.fechaSolicitud !== undefined && {
          fechaSolicitud: body.fechaSolicitud,
        }),
        ...(body.fechaResolucion !== undefined && {
          fechaResolucion: body.fechaResolucion,
        }),
        ...(body.fechaVencimiento !== undefined && {
          fechaVencimiento: body.fechaVencimiento,
        }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.canonImporte !== undefined && {
          canonImporte: body.canonImporte?.toFixed(2) ?? null,
        }),
        ...(body.documentId !== undefined && { documentId: body.documentId }),
        ...(body.notas !== undefined && { notas: body.notas }),
        updatedAt: new Date(),
      })
      .where(eq(permisosPublicos.id, id))
      .returning();
    return toDto(row, todayIso());
  }

  async remove(id: string): Promise<void> {
    await this.getRow(id);
    await this.db
      .update(permisosPublicos)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(permisosPublicos.id, id));
  }
}
