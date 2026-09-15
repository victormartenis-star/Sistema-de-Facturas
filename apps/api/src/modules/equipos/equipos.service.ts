import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  Equipo,
  MantenimientoEquipo,
  equipos,
  mantenimientosEquipo,
  proveedores,
} from '@erp/db';
import {
  EquipoCreateInput,
  EquipoDto,
  EquipoUpdateInput,
  MantenimientoCreateInput,
  MantenimientoEquipoDto,
  MantenimientoUpdateInput,
  equipoCreateSchema,
  equipoUpdateSchema,
  mantenimientoCreateSchema,
  mantenimientoUpdateSchema,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function equipoToDto(
  row: Equipo,
  proveedorNombre: string | null,
  ultimoMantenimientoFecha: string | null,
  proximaRevisionFecha: string | null,
): EquipoDto {
  return {
    id: row.id,
    nombre: row.nombre,
    matricula: row.matricula,
    tipo: row.tipo,
    ownership: row.ownership,
    proveedorAlquilerId: row.proveedorAlquilerId,
    proveedorAlquilerNombre: proveedorNombre,
    estado: row.estado,
    fechaAlta: row.fechaAlta,
    fechaBaja: row.fechaBaja,
    notas: row.notas,
    ultimoMantenimientoFecha,
    proximaRevisionFecha,
    createdAt: row.createdAt.toISOString(),
  };
}

function mantenimientoToDto(
  row: MantenimientoEquipo,
  proveedorNombre: string | null,
): MantenimientoEquipoDto {
  return {
    id: row.id,
    equipoId: row.equipoId,
    tipo: row.tipo,
    fecha: row.fecha,
    proveedorId: row.proveedorId,
    proveedorNombre,
    coste: row.coste === null ? null : Number(row.coste),
    proximaRevisionFecha: row.proximaRevisionFecha,
    descripcion: row.descripcion,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface EquiposListFilter {
  estado?: string;
  ownership?: string;
}

@Injectable()
export class EquiposService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────── maestro de equipos ────────────────────── */

  async list(filter: EquiposListFilter): Promise<EquipoDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const conditions = [
      eq(equipos.companyId, companyId),
      isNull(equipos.deletedAt),
    ];
    if (filter.estado)
      conditions.push(eq(equipos.estado, filter.estado as Equipo['estado']));
    if (filter.ownership)
      conditions.push(
        eq(equipos.ownership, filter.ownership as Equipo['ownership']),
      );

    const rows = await this.dbs.db
      .select({ equipo: equipos, proveedorNombre: proveedores.razonSocial })
      .from(equipos)
      .leftJoin(proveedores, eq(equipos.proveedorAlquilerId, proveedores.id))
      .where(and(...conditions))
      .orderBy(asc(equipos.nombre));

    return Promise.all(
      rows.map(async (r) => {
        const { ultimo, proxima } = await this.mantenimientoResumen(
          r.equipo.id,
        );
        return equipoToDto(r.equipo, r.proveedorNombre, ultimo, proxima);
      }),
    );
  }

  async get(id: string): Promise<EquipoDto> {
    const row = await this.findEquipo(id);
    const proveedorNombre = row.proveedorAlquilerId
      ? await this.findProveedorNombre(row.proveedorAlquilerId)
      : null;
    const { ultimo, proxima } = await this.mantenimientoResumen(row.id);
    return equipoToDto(row, proveedorNombre, ultimo, proxima);
  }

  async create(input: EquipoCreateInput): Promise<EquipoDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = equipoCreateSchema.parse(input);
    if (data.proveedorAlquilerId)
      await this.findProveedorNombre(data.proveedorAlquilerId);

    const [row] = await this.dbs.db
      .insert(equipos)
      .values({
        companyId,
        nombre: data.nombre,
        matricula: data.matricula ?? null,
        tipo: data.tipo,
        ownership: data.ownership,
        proveedorAlquilerId: data.proveedorAlquilerId ?? null,
        estado: data.estado,
        fechaAlta: data.fechaAlta ?? null,
        fechaBaja: data.fechaBaja ?? null,
        notas: data.notas ?? null,
      })
      .returning();

    void this.audit.log({
      entityType: 'equipo',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    const proveedorNombre = row.proveedorAlquilerId
      ? await this.findProveedorNombre(row.proveedorAlquilerId)
      : null;
    return equipoToDto(row, proveedorNombre, null, null);
  }

  async update(id: string, input: EquipoUpdateInput): Promise<EquipoDto> {
    await this.findEquipo(id);
    const data = equipoUpdateSchema.parse(input);
    if (data.proveedorAlquilerId)
      await this.findProveedorNombre(data.proveedorAlquilerId);

    const [row] = await this.dbs.db
      .update(equipos)
      .set({
        ...(data.nombre !== undefined && { nombre: data.nombre }),
        ...(data.matricula !== undefined && {
          matricula: data.matricula ?? null,
        }),
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.ownership !== undefined && { ownership: data.ownership }),
        ...(data.proveedorAlquilerId !== undefined && {
          proveedorAlquilerId: data.proveedorAlquilerId ?? null,
        }),
        ...(data.estado !== undefined && { estado: data.estado }),
        ...(data.fechaAlta !== undefined && {
          fechaAlta: data.fechaAlta ?? null,
        }),
        ...(data.fechaBaja !== undefined && {
          fechaBaja: data.fechaBaja ?? null,
        }),
        ...(data.notas !== undefined && { notas: data.notas ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(equipos.id, id))
      .returning();

    const proveedorNombre = row.proveedorAlquilerId
      ? await this.findProveedorNombre(row.proveedorAlquilerId)
      : null;
    const { ultimo, proxima } = await this.mantenimientoResumen(row.id);
    return equipoToDto(row, proveedorNombre, ultimo, proxima);
  }

  async remove(id: string): Promise<void> {
    await this.findEquipo(id);
    await this.dbs.db
      .update(equipos)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(equipos.id, id));
  }

  /* ────────────────────── mantenimientos ────────────────────── */

  async listMantenimientos(
    equipoId: string,
  ): Promise<MantenimientoEquipoDto[]> {
    await this.findEquipo(equipoId);
    const rows = await this.dbs.db
      .select({
        mantenimiento: mantenimientosEquipo,
        proveedorNombre: proveedores.razonSocial,
      })
      .from(mantenimientosEquipo)
      .leftJoin(
        proveedores,
        eq(mantenimientosEquipo.proveedorId, proveedores.id),
      )
      .where(
        and(
          eq(mantenimientosEquipo.equipoId, equipoId),
          isNull(mantenimientosEquipo.deletedAt),
        ),
      )
      .orderBy(desc(mantenimientosEquipo.fecha));

    return rows.map((r) =>
      mantenimientoToDto(r.mantenimiento, r.proveedorNombre),
    );
  }

  async createMantenimiento(
    input: MantenimientoCreateInput,
  ): Promise<MantenimientoEquipoDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = mantenimientoCreateSchema.parse(input);
    await this.findEquipo(data.equipoId);
    if (data.proveedorId) await this.findProveedorNombre(data.proveedorId);

    const [row] = await this.dbs.db
      .insert(mantenimientosEquipo)
      .values({
        companyId,
        equipoId: data.equipoId,
        tipo: data.tipo,
        fecha: data.fecha,
        proveedorId: data.proveedorId ?? null,
        coste: data.coste?.toFixed(2) ?? null,
        proximaRevisionFecha: data.proximaRevisionFecha ?? null,
        descripcion: data.descripcion ?? null,
      })
      .returning();

    void this.audit.log({
      entityType: 'mantenimiento_equipo',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    const proveedorNombre = row.proveedorId
      ? await this.findProveedorNombre(row.proveedorId)
      : null;
    return mantenimientoToDto(row, proveedorNombre);
  }

  async updateMantenimiento(
    id: string,
    input: MantenimientoUpdateInput,
  ): Promise<MantenimientoEquipoDto> {
    const existing = await this.findMantenimiento(id);
    const data = mantenimientoUpdateSchema.parse(input);
    if (data.proveedorId) await this.findProveedorNombre(data.proveedorId);

    const [row] = await this.dbs.db
      .update(mantenimientosEquipo)
      .set({
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.fecha !== undefined && { fecha: data.fecha }),
        ...(data.proveedorId !== undefined && {
          proveedorId: data.proveedorId ?? null,
        }),
        ...(data.coste !== undefined && {
          coste: data.coste?.toFixed(2) ?? null,
        }),
        ...(data.proximaRevisionFecha !== undefined && {
          proximaRevisionFecha: data.proximaRevisionFecha ?? null,
        }),
        ...(data.descripcion !== undefined && {
          descripcion: data.descripcion ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(mantenimientosEquipo.id, id))
      .returning();

    void existing;
    const proveedorNombre = row.proveedorId
      ? await this.findProveedorNombre(row.proveedorId)
      : null;
    return mantenimientoToDto(row, proveedorNombre);
  }

  async removeMantenimiento(id: string): Promise<void> {
    await this.findMantenimiento(id);
    await this.dbs.db
      .update(mantenimientosEquipo)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(mantenimientosEquipo.id, id));
  }

  /* ────────────────────── privados ────────────────────── */

  /** Fecha del último mantenimiento cerrado y próxima revisión prevista más cercana. */
  private async mantenimientoResumen(
    equipoId: string,
  ): Promise<{ ultimo: string | null; proxima: string | null }> {
    const rows = await this.dbs.db
      .select({
        fecha: mantenimientosEquipo.fecha,
        proximaRevisionFecha: mantenimientosEquipo.proximaRevisionFecha,
      })
      .from(mantenimientosEquipo)
      .where(
        and(
          eq(mantenimientosEquipo.equipoId, equipoId),
          isNull(mantenimientosEquipo.deletedAt),
        ),
      )
      .orderBy(desc(mantenimientosEquipo.fecha));

    const ultimo = rows[0]?.fecha ?? null;
    const proximas = rows
      .map((r) => r.proximaRevisionFecha)
      .filter((f): f is string => f !== null)
      .sort();
    return { ultimo, proxima: proximas[0] ?? null };
  }

  private async findEquipo(id: string): Promise<Equipo> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(equipos)
      .where(
        and(
          eq(equipos.id, id),
          eq(equipos.companyId, companyId),
          isNull(equipos.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Equipo no encontrado');
    return row;
  }

  private async findMantenimiento(id: string): Promise<MantenimientoEquipo> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ mantenimiento: mantenimientosEquipo })
      .from(mantenimientosEquipo)
      .innerJoin(equipos, eq(mantenimientosEquipo.equipoId, equipos.id))
      .where(
        and(
          eq(mantenimientosEquipo.id, id),
          eq(equipos.companyId, companyId),
          isNull(mantenimientosEquipo.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Mantenimiento no encontrado');
    return row.mantenimiento;
  }

  private async findProveedorNombre(proveedorId: string): Promise<string> {
    const [row] = await this.dbs.db
      .select({ razonSocial: proveedores.razonSocial })
      .from(proveedores)
      .where(
        and(eq(proveedores.id, proveedorId), isNull(proveedores.deletedAt)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Proveedor no encontrado');
    return row.razonSocial;
  }
}
