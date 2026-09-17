import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Trabajador, proveedores, trabajadores } from '@erp/db';
import {
  TrabajadorCreateInput,
  TrabajadorDto,
  TrabajadorUpdateInput,
  trabajadorCreateSchema,
  trabajadorUpdateSchema,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function toDto(row: Trabajador, proveedorNombre: string | null): TrabajadorDto {
  return {
    id: row.id,
    nombre: row.nombre,
    documentoIdentidad: row.documentoIdentidad,
    categoryId: row.categoryId,
    tipo: row.tipo,
    proveedorId: row.proveedorId,
    proveedorNombre,
    ordinaryRateDefault:
      row.ordinaryRateDefault === null ? null : Number(row.ordinaryRateDefault),
    overtimeRateDefault:
      row.overtimeRateDefault === null ? null : Number(row.overtimeRateDefault),
    activo: row.activo,
    fechaAlta: row.fechaAlta,
    fechaBaja: row.fechaBaja,
    notas: row.notas,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface TrabajadoresListFilter {
  activo?: boolean;
  tipo?: string;
}

@Injectable()
export class TrabajadoresService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: TrabajadoresListFilter): Promise<TrabajadorDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const conditions = [
      eq(trabajadores.companyId, companyId),
      isNull(trabajadores.deletedAt),
    ];
    if (filter.activo !== undefined)
      conditions.push(eq(trabajadores.activo, filter.activo));
    if (filter.tipo)
      conditions.push(eq(trabajadores.tipo, filter.tipo as Trabajador['tipo']));

    const rows = await this.dbs.db
      .select({
        trabajador: trabajadores,
        proveedorNombre: proveedores.razonSocial,
      })
      .from(trabajadores)
      .leftJoin(proveedores, eq(trabajadores.proveedorId, proveedores.id))
      .where(and(...conditions))
      .orderBy(asc(trabajadores.nombre));

    return rows.map((r) => toDto(r.trabajador, r.proveedorNombre));
  }

  async get(id: string): Promise<TrabajadorDto> {
    const row = await this.findRow(id);
    const proveedorNombre = row.proveedorId
      ? await this.findProveedorNombre(row.proveedorId)
      : null;
    return toDto(row, proveedorNombre);
  }

  async create(input: TrabajadorCreateInput): Promise<TrabajadorDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = trabajadorCreateSchema.parse(input);
    if (data.proveedorId) await this.findProveedorNombre(data.proveedorId);

    const [row] = await this.dbs.db
      .insert(trabajadores)
      .values({
        companyId,
        nombre: data.nombre,
        documentoIdentidad: data.documentoIdentidad ?? null,
        categoryId: data.categoryId ?? null,
        tipo: data.tipo,
        proveedorId: data.proveedorId ?? null,
        ordinaryRateDefault: data.ordinaryRateDefault?.toFixed(2) ?? null,
        overtimeRateDefault: data.overtimeRateDefault?.toFixed(2) ?? null,
        activo: data.activo,
        fechaAlta: data.fechaAlta ?? null,
        fechaBaja: data.fechaBaja ?? null,
        notas: data.notas ?? null,
      })
      .returning();

    void this.audit.log({
      entityType: 'trabajador',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    const proveedorNombre = row.proveedorId
      ? await this.findProveedorNombre(row.proveedorId)
      : null;
    return toDto(row, proveedorNombre);
  }

  async update(
    id: string,
    input: TrabajadorUpdateInput,
  ): Promise<TrabajadorDto> {
    await this.findRow(id);
    const data = trabajadorUpdateSchema.parse(input);
    if (data.proveedorId) await this.findProveedorNombre(data.proveedorId);

    const [row] = await this.dbs.db
      .update(trabajadores)
      .set({
        ...(data.nombre !== undefined && { nombre: data.nombre }),
        ...(data.documentoIdentidad !== undefined && {
          documentoIdentidad: data.documentoIdentidad ?? null,
        }),
        ...(data.categoryId !== undefined && {
          categoryId: data.categoryId ?? null,
        }),
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.proveedorId !== undefined && {
          proveedorId: data.proveedorId ?? null,
        }),
        ...(data.ordinaryRateDefault !== undefined && {
          ordinaryRateDefault: data.ordinaryRateDefault?.toFixed(2) ?? null,
        }),
        ...(data.overtimeRateDefault !== undefined && {
          overtimeRateDefault: data.overtimeRateDefault?.toFixed(2) ?? null,
        }),
        ...(data.activo !== undefined && { activo: data.activo }),
        ...(data.fechaAlta !== undefined && {
          fechaAlta: data.fechaAlta ?? null,
        }),
        ...(data.fechaBaja !== undefined && {
          fechaBaja: data.fechaBaja ?? null,
        }),
        ...(data.notas !== undefined && { notas: data.notas ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(trabajadores.id, id))
      .returning();

    const proveedorNombre = row.proveedorId
      ? await this.findProveedorNombre(row.proveedorId)
      : null;
    return toDto(row, proveedorNombre);
  }

  async remove(id: string): Promise<void> {
    await this.findRow(id);
    await this.dbs.db
      .update(trabajadores)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(trabajadores.id, id));
  }

  /* ────────────────────── privados ────────────────────── */

  private async findRow(id: string): Promise<Trabajador> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(trabajadores)
      .where(
        and(
          eq(trabajadores.id, id),
          eq(trabajadores.companyId, companyId),
          isNull(trabajadores.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Trabajador no encontrado');
    return row;
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
