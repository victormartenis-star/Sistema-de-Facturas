import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  EsgFactorEmision,
  EsgRegistroEmision,
  RcdVale,
  contacts,
  esgFactoresEmision,
  esgRegistrosEmision,
  rcdVales,
} from '@erp/db';
import {
  EsgFactorCreateInput,
  EsgFactorDto,
  EsgFactorUpdateInput,
  EsgInformeDto,
  EsgRegistroCreateInput,
  EsgRegistroEmisionDto,
  EsgRegistroUpdateInput,
  RcdInformeDto,
  RcdValeCreateInput,
  RcdValeDto,
  RcdValeUpdateInput,
  computeEmisionesKgCo2e,
  esgFactorCreateSchema,
  esgFactorUpdateSchema,
  esgRegistroCreateSchema,
  esgRegistroUpdateSchema,
  rcdValeCreateSchema,
  rcdValeUpdateSchema,
  summarizeEmisiones,
  summarizeRcd,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function factorToDto(row: EsgFactorEmision): EsgFactorDto {
  return {
    id: row.id,
    categoria: row.categoria,
    nombre: row.nombre,
    unidad: row.unidad,
    factorKgCo2e: Number(row.factorKgCo2e),
    fuente: row.fuente,
    activo: row.activo,
    createdAt: row.createdAt.toISOString(),
  };
}

function registroToDto(
  row: EsgRegistroEmision,
  factor: {
    nombre: string;
    categoria: EsgFactorEmision['categoria'];
    unidad: string;
  },
): EsgRegistroEmisionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    phaseId: row.phaseId,
    factorId: row.factorId,
    factorNombre: factor.nombre,
    categoria: factor.categoria,
    unidad: factor.unidad,
    fecha: row.fecha,
    cantidad: Number(row.cantidad),
    emisionesKgCo2e: Number(row.emisionesKgCo2e),
    documentId: row.documentId,
    notas: row.notas,
    createdAt: row.createdAt.toISOString(),
  };
}

function valeToDto(row: RcdVale, managerName: string): RcdValeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    lerCode: row.lerCode,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit as RcdValeDto['unit'],
    treatment: row.treatment,
    managerContactId: row.managerContactId,
    managerName,
    ticketNumber: row.ticketNumber,
    ticketDate: row.ticketDate,
    documentId: row.documentId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class EsgService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────── factores de emisión ────────────────────── */

  async listFactores(activo?: boolean): Promise<EsgFactorDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const conditions = [eq(esgFactoresEmision.companyId, companyId)];
    if (activo !== undefined)
      conditions.push(eq(esgFactoresEmision.activo, activo));
    const rows = await this.dbs.db
      .select()
      .from(esgFactoresEmision)
      .where(and(...conditions))
      .orderBy(
        asc(esgFactoresEmision.categoria),
        asc(esgFactoresEmision.nombre),
      );
    return rows.map(factorToDto);
  }

  async createFactor(input: EsgFactorCreateInput): Promise<EsgFactorDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = esgFactorCreateSchema.parse(input);
    const [row] = await this.dbs.db
      .insert(esgFactoresEmision)
      .values({
        companyId,
        categoria: data.categoria,
        nombre: data.nombre,
        unidad: data.unidad,
        factorKgCo2e: data.factorKgCo2e.toFixed(6),
        fuente: data.fuente ?? null,
        activo: data.activo,
      })
      .returning();
    void this.audit.log({
      entityType: 'esg_factor_emision',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return factorToDto(row);
  }

  async updateFactor(
    id: string,
    input: EsgFactorUpdateInput,
  ): Promise<EsgFactorDto> {
    await this.findFactor(id);
    const data = esgFactorUpdateSchema.parse(input);
    const [row] = await this.dbs.db
      .update(esgFactoresEmision)
      .set({
        ...(data.categoria !== undefined && { categoria: data.categoria }),
        ...(data.nombre !== undefined && { nombre: data.nombre }),
        ...(data.unidad !== undefined && { unidad: data.unidad }),
        ...(data.factorKgCo2e !== undefined && {
          factorKgCo2e: data.factorKgCo2e.toFixed(6),
        }),
        ...(data.fuente !== undefined && { fuente: data.fuente ?? null }),
        ...(data.activo !== undefined && { activo: data.activo }),
        updatedAt: new Date(),
      })
      .where(eq(esgFactoresEmision.id, id))
      .returning();
    return factorToDto(row);
  }

  /* ────────────────────── registros de emisión ────────────────────── */

  async listRegistros(filter: {
    projectId?: string;
    desde?: string;
    hasta?: string;
  }): Promise<EsgRegistroEmisionDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (filter.projectId && !allowed.includes(filter.projectId)) return [];
    }

    const conditions = [
      eq(esgRegistrosEmision.companyId, companyId),
      isNull(esgRegistrosEmision.deletedAt),
    ];
    if (filter.projectId)
      conditions.push(eq(esgRegistrosEmision.projectId, filter.projectId));
    if (filter.desde)
      conditions.push(gte(esgRegistrosEmision.fecha, filter.desde));
    if (filter.hasta)
      conditions.push(lte(esgRegistrosEmision.fecha, filter.hasta));

    const rows = await this.dbs.db
      .select()
      .from(esgRegistrosEmision)
      .where(and(...conditions))
      .orderBy(asc(esgRegistrosEmision.fecha));

    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.projectId));
    return this.attachFactores(visible);
  }

  async createRegistro(
    input: EsgRegistroCreateInput,
  ): Promise<EsgRegistroEmisionDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = esgRegistroCreateSchema.parse(input);
    await this.assertProjectAccessible(data.projectId);
    const factor = await this.findFactor(data.factorId);
    const emisionesKgCo2e = computeEmisionesKgCo2e(
      data.cantidad,
      Number(factor.factorKgCo2e),
    );

    const [row] = await this.dbs.db
      .insert(esgRegistrosEmision)
      .values({
        companyId,
        projectId: data.projectId,
        phaseId: data.phaseId ?? null,
        factorId: data.factorId,
        fecha: data.fecha,
        cantidad: data.cantidad.toFixed(4),
        emisionesKgCo2e: emisionesKgCo2e.toFixed(3),
        documentId: data.documentId ?? null,
        notas: data.notas ?? null,
      })
      .returning();

    void this.audit.log({
      entityType: 'esg_registro_emision',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return registroToDto(row, factor);
  }

  async updateRegistro(
    id: string,
    input: EsgRegistroUpdateInput,
  ): Promise<EsgRegistroEmisionDto> {
    const existing = await this.findRegistro(id);
    const data = esgRegistroUpdateSchema.parse(input);
    const factor = await this.findFactor(existing.factorId);
    const cantidad = data.cantidad ?? Number(existing.cantidad);
    const recompute = data.cantidad !== undefined;

    const [row] = await this.dbs.db
      .update(esgRegistrosEmision)
      .set({
        ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
        ...(data.fecha !== undefined && { fecha: data.fecha }),
        ...(data.cantidad !== undefined && { cantidad: cantidad.toFixed(4) }),
        ...(recompute && {
          emisionesKgCo2e: computeEmisionesKgCo2e(
            cantidad,
            Number(factor.factorKgCo2e),
          ).toFixed(3),
        }),
        ...(data.documentId !== undefined && {
          documentId: data.documentId ?? null,
        }),
        ...(data.notas !== undefined && { notas: data.notas ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(esgRegistrosEmision.id, id))
      .returning();
    return registroToDto(row, factor);
  }

  async removeRegistro(id: string): Promise<void> {
    await this.findRegistro(id);
    await this.dbs.db
      .update(esgRegistrosEmision)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(esgRegistrosEmision.id, id));
  }

  /* ────────────────────── informe (BREEAM/LEED) ────────────────────── */

  async informe(
    projectId: string,
    desde?: string,
    hasta?: string,
  ): Promise<EsgInformeDto> {
    await this.assertProjectAccessible(projectId);
    const registros = await this.listRegistros({ projectId, desde, hasta });
    const { totalKgCo2e, porCategoria } = summarizeEmisiones(registros);
    return {
      projectId,
      desde: desde ?? null,
      hasta: hasta ?? null,
      totalKgCo2e,
      totalToneladasCo2e: Math.round((totalKgCo2e / 1000) * 1000) / 1000,
      porCategoria,
    };
  }

  /* ────────────────────── vales RCD ────────────────────── */

  async listVales(filter: {
    projectId?: string;
    desde?: string;
    hasta?: string;
  }): Promise<RcdValeDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (filter.projectId && !allowed.includes(filter.projectId)) return [];
    }

    const conditions = [
      eq(rcdVales.companyId, companyId),
      isNull(rcdVales.deletedAt),
    ];
    if (filter.projectId)
      conditions.push(eq(rcdVales.projectId, filter.projectId));
    if (filter.desde) conditions.push(gte(rcdVales.ticketDate, filter.desde));
    if (filter.hasta) conditions.push(lte(rcdVales.ticketDate, filter.hasta));

    const rows = await this.dbs.db
      .select({ vale: rcdVales, managerName: contacts.legalName })
      .from(rcdVales)
      .innerJoin(contacts, eq(rcdVales.managerContactId, contacts.id))
      .where(and(...conditions))
      .orderBy(asc(rcdVales.ticketDate));

    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.vale.projectId));
    return visible.map((r) => valeToDto(r.vale, r.managerName));
  }

  async createVale(input: RcdValeCreateInput): Promise<RcdValeDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = rcdValeCreateSchema.parse(input);
    await this.assertProjectAccessible(data.projectId);
    const manager = await this.findManager(data.managerContactId);

    let row: RcdVale;
    try {
      [row] = await this.dbs.db
        .insert(rcdVales)
        .values({
          companyId,
          projectId: data.projectId,
          lerCode: data.lerCode,
          description: data.description,
          quantity: data.quantity.toFixed(3),
          unit: data.unit,
          treatment: data.treatment,
          managerContactId: data.managerContactId,
          ticketNumber: data.ticketNumber,
          ticketDate: data.ticketDate,
          documentId: data.documentId ?? null,
          notes: data.notes ?? null,
        })
        .returning();
    } catch (err) {
      this.rethrowDuplicateVale(err, data.ticketNumber);
    }
    void this.audit.log({
      entityType: 'rcd_vale',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return valeToDto(row, manager.legalName);
  }

  async updateVale(id: string, input: RcdValeUpdateInput): Promise<RcdValeDto> {
    const existing = await this.findVale(id);
    const data = rcdValeUpdateSchema.parse(input);
    const manager = await this.findManager(existing.managerContactId);

    const [row] = await this.dbs.db
      .update(rcdVales)
      .set({
        ...(data.lerCode !== undefined && { lerCode: data.lerCode }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.quantity !== undefined && {
          quantity: data.quantity.toFixed(3),
        }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.treatment !== undefined && { treatment: data.treatment }),
        ...(data.ticketNumber !== undefined && {
          ticketNumber: data.ticketNumber,
        }),
        ...(data.ticketDate !== undefined && { ticketDate: data.ticketDate }),
        ...(data.documentId !== undefined && {
          documentId: data.documentId ?? null,
        }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(rcdVales.id, id))
      .returning();
    return valeToDto(row, manager.legalName);
  }

  async removeVale(id: string): Promise<void> {
    await this.findVale(id);
    await this.dbs.db
      .update(rcdVales)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(rcdVales.id, id));
  }

  /** Informe RCD: totales por LER y % de valorización, para BREEAM/LEED. */
  async informeRcd(
    projectId: string,
    desde?: string,
    hasta?: string,
  ): Promise<RcdInformeDto> {
    await this.assertProjectAccessible(projectId);
    const vales = await this.listVales({ projectId, desde, hasta });
    const { totalToneladas, totalM3, valorizacionPct, porLer } =
      summarizeRcd(vales);
    return {
      projectId,
      desde: desde ?? null,
      hasta: hasta ?? null,
      totalToneladas,
      totalM3,
      valorizacionPct,
      porLer,
    };
  }

  /* ────────────────────── privados ────────────────────── */

  private async findVale(id: string): Promise<RcdVale> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(rcdVales)
      .where(
        and(
          eq(rcdVales.id, id),
          eq(rcdVales.companyId, companyId),
          isNull(rcdVales.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Vale RCD no encontrado');
    return row;
  }

  private async findManager(id: string) {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ id: contacts.id, legalName: contacts.legalName })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, id),
          eq(contacts.companyId, companyId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Gestor no encontrado');
    return row;
  }

  /** El índice único es `(managerContactId, ticketNumber)`: cada gestor numera sus vales por su cuenta. */
  private rethrowDuplicateVale(err: unknown, ticketNumber: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    ) {
      throw new ConflictException(
        `Ya existe un vale con el número "${ticketNumber}" para ese gestor`,
      );
    }
    throw err;
  }

  private async attachFactores(
    rows: EsgRegistroEmision[],
  ): Promise<EsgRegistroEmisionDto[]> {
    const factorIds = Array.from(new Set(rows.map((r) => r.factorId)));
    const factores =
      factorIds.length > 0
        ? await this.dbs.db
            .select()
            .from(esgFactoresEmision)
            .where(inArray(esgFactoresEmision.id, factorIds))
        : [];
    const byId = new Map(factores.map((f) => [f.id, f]));
    return rows.map((row) => {
      const factor = byId.get(row.factorId);
      if (!factor)
        throw new NotFoundException('Factor de emisión no encontrado');
      return registroToDto(row, factor);
    });
  }

  private async findFactor(id: string): Promise<EsgFactorEmision> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(esgFactoresEmision)
      .where(
        and(
          eq(esgFactoresEmision.id, id),
          eq(esgFactoresEmision.companyId, companyId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Factor de emisión no encontrado');
    return row;
  }

  private async findRegistro(id: string): Promise<EsgRegistroEmision> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(esgRegistrosEmision)
      .where(
        and(
          eq(esgRegistrosEmision.id, id),
          eq(esgRegistrosEmision.companyId, companyId),
          isNull(esgRegistrosEmision.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Registro de emisión no encontrado');
    return row;
  }

  private async assertProjectAccessible(projectId: string): Promise<void> {
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
  }
}
