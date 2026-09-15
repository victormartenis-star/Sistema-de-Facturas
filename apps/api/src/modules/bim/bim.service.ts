import { ReadStream } from 'node:fs';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  BimElementLink,
  BimModel,
  bimElementLinks,
  bimModels,
  budgetItems,
  budgets,
  certificationLines,
  certifications,
  projects,
} from '@erp/db';
import {
  BimElementLinkDto,
  BimElementLinkUpsertInput,
  BimModelCreateMeta,
  BimModelDto,
  bimElementLinkUpsertSchema,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';
import { StorageService } from '../../documents/storage.service';

/** Archivo recibido por multer (memoria); mismo tipado local que `documents`. */
export interface UploadedBimFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_SIZE_MB = 200;

/**
 * Intenta leer el esquema IFC (`IFC2X3`, `IFC4`…) de la cabecera del
 * fichero sin parsearlo entero: aparece en texto plano en las primeras
 * líneas, en `FILE_SCHEMA(('IFC4'));`. Es solo informativo — si no se
 * encuentra, `ifcSchema` queda `null` y no bloquea la subida.
 */
function sniffIfcSchema(buffer: Buffer): string | null {
  const head = buffer.subarray(0, 4096).toString('latin1');
  const match = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(head);
  return match ? match[1] : null;
}

function modelToDto(row: BimModel, project: { code: string }): BimModelDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode: project.code,
    name: row.name,
    fileName: row.fileName,
    fileSize: row.fileSize,
    ifcSchema: row.ifcSchema,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function linkToDto(
  row: BimElementLink,
  budgetItem: { code: string; name: string } | null,
  certifiedPct: number | null,
): BimElementLinkDto {
  return {
    id: row.id,
    bimModelId: row.bimModelId,
    ifcGlobalId: row.ifcGlobalId,
    ifcElementName: row.ifcElementName,
    ifcElementType: row.ifcElementType,
    budgetItemId: row.budgetItemId,
    budgetItemCode: budgetItem?.code ?? null,
    budgetItemName: budgetItem?.name ?? null,
    certifiedPct,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class BimService {
  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async listModels(projectId?: string): Promise<BimModelDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    const filters = [
      eq(bimModels.companyId, companyId),
      isNull(bimModels.deletedAt),
    ];
    if (projectId) filters.push(eq(bimModels.projectId, projectId));
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      filters.push(inArray(bimModels.projectId, allowed));
    }
    const rows = await this.dbs.db
      .select({ model: bimModels, projectCode: projects.code })
      .from(bimModels)
      .innerJoin(projects, eq(bimModels.projectId, projects.id))
      .where(and(...filters))
      .orderBy(desc(bimModels.createdAt));
    return rows.map((r) => modelToDto(r.model, { code: r.projectCode }));
  }

  async getModel(id: string): Promise<BimModelDto> {
    const row = await this.findModel(id);
    const [project] = await this.dbs.db
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    return modelToDto(row, project);
  }

  async uploadModel(
    file: UploadedBimFile,
    meta: BimModelCreateMeta,
  ): Promise<BimModelDto> {
    const companyId = await this.dbs.getCompanyId();
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (file.buffer.length > MAX_SIZE_MB * 1024 * 1024) {
      throw new BadRequestException(
        `El archivo supera el tamaño máximo permitido (${MAX_SIZE_MB} MB)`,
      );
    }
    const project = await this.ensureProject(companyId, meta.projectId);

    const fileName = file.originalname;
    const storageKey = await this.storage.save(
      companyId,
      fileName,
      file.buffer,
    );
    try {
      const [row] = await this.dbs.db
        .insert(bimModels)
        .values({
          companyId,
          projectId: meta.projectId,
          name: meta.name,
          storageKey,
          fileName,
          fileSize: file.buffer.length,
          ifcSchema: sniffIfcSchema(file.buffer),
        })
        .returning();
      void this.audit.log({
        entityType: 'bim_model',
        entityId: row.id,
        action: 'create',
        newData: row,
      });
      return modelToDto(row, project);
    } catch (err) {
      await this.storage.discard(storageKey);
      throw err;
    }
  }

  async downloadModel(
    id: string,
  ): Promise<{ model: BimModel; stream: ReadStream }> {
    const row = await this.findModel(id);
    if (!(await this.storage.exists(row.storageKey))) {
      throw new NotFoundException(
        'El archivo original no está disponible en el almacenamiento',
      );
    }
    return { model: row, stream: this.storage.read(row.storageKey) };
  }

  async removeModel(id: string): Promise<void> {
    const row = await this.findModel(id);
    await this.dbs.db
      .update(bimModels)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(bimModels.id, id));
    void this.audit.log({
      entityType: 'bim_model',
      entityId: row.id,
      action: 'delete',
    });
  }

  /* ────────────────────── vínculos elemento ↔ partida ────────────────────── */

  async listLinks(bimModelId: string): Promise<BimElementLinkDto[]> {
    const model = await this.findModel(bimModelId);
    const rows = await this.dbs.db
      .select()
      .from(bimElementLinks)
      .where(eq(bimElementLinks.bimModelId, bimModelId));

    const budgetItemIds = Array.from(
      new Set(
        rows
          .map((r) => r.budgetItemId)
          .filter((id): id is string => id !== null),
      ),
    );
    const [items, pctByItem] = await Promise.all([
      this.budgetItemsById(budgetItemIds),
      this.certifiedPctByBudgetItem(model.projectId, budgetItemIds),
    ]);
    return rows.map((row) =>
      linkToDto(
        row,
        row.budgetItemId ? (items.get(row.budgetItemId) ?? null) : null,
        row.budgetItemId ? (pctByItem.get(row.budgetItemId) ?? null) : null,
      ),
    );
  }

  /** Crea o actualiza el vínculo de un elemento IFC (clave natural: modelo + GlobalId). */
  async upsertLink(
    bimModelId: string,
    ifcGlobalId: string,
    input: BimElementLinkUpsertInput,
  ): Promise<BimElementLinkDto> {
    const model = await this.findModel(bimModelId);
    const data = bimElementLinkUpsertSchema.parse(input);
    if (data.budgetItemId) {
      await this.ensureBudgetItemInProject(data.budgetItemId, model.projectId);
    }

    const [existing] = await this.dbs.db
      .select()
      .from(bimElementLinks)
      .where(
        and(
          eq(bimElementLinks.bimModelId, bimModelId),
          eq(bimElementLinks.ifcGlobalId, ifcGlobalId),
        ),
      )
      .limit(1);

    const values = {
      ifcElementName: data.ifcElementName ?? null,
      ifcElementType: data.ifcElementType ?? null,
      budgetItemId: data.budgetItemId ?? null,
      notes: data.notes ?? null,
      updatedAt: new Date(),
    };

    const [row] = existing
      ? await this.dbs.db
          .update(bimElementLinks)
          .set(values)
          .where(eq(bimElementLinks.id, existing.id))
          .returning()
      : await this.dbs.db
          .insert(bimElementLinks)
          .values({ bimModelId, ifcGlobalId, ...values })
          .returning();

    void this.audit.log({
      entityType: 'bim_element_link',
      entityId: row.id,
      action: existing ? 'update' : 'create',
      newData: row,
    });

    const item = row.budgetItemId
      ? ((await this.budgetItemsById([row.budgetItemId])).get(
          row.budgetItemId,
        ) ?? null)
      : null;
    const pct = row.budgetItemId
      ? ((
          await this.certifiedPctByBudgetItem(model.projectId, [
            row.budgetItemId,
          ])
        ).get(row.budgetItemId) ?? null)
      : null;
    return linkToDto(row, item, pct);
  }

  /* ────────────────────── privados ────────────────────── */

  private async budgetItemsById(
    ids: string[],
  ): Promise<Map<string, { code: string; name: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.dbs.db
      .select({
        id: budgetItems.id,
        code: budgetItems.code,
        name: budgetItems.name,
      })
      .from(budgetItems)
      .where(inArray(budgetItems.id, ids));
    return new Map(rows.map((r) => [r.id, { code: r.code, name: r.name }]));
  }

  /**
   * % a origen de cada partida según la última certificación facturada de
   * la obra (la certificación oficial; una en borrador todavía puede
   * cambiar). Sin certificación facturada que la incluya, `null`.
   */
  private async certifiedPctByBudgetItem(
    projectId: string,
    budgetItemIds: string[],
  ): Promise<Map<string, number>> {
    if (budgetItemIds.length === 0) return new Map();
    const rows = await this.dbs.db
      .select({
        budgetItemId: certificationLines.budgetItemId,
        cumulativePct: certificationLines.cumulativePct,
        seq: certifications.seq,
      })
      .from(certificationLines)
      .innerJoin(
        certifications,
        eq(certificationLines.certificationId, certifications.id),
      )
      .where(
        and(
          eq(certifications.projectId, projectId),
          eq(certifications.status, 'facturada'),
          inArray(certificationLines.budgetItemId, budgetItemIds),
        ),
      )
      .orderBy(desc(certifications.seq));

    const result = new Map<string, number>();
    for (const row of rows) {
      // Ya viene ordenado por `seq` descendente: la primera fila de cada
      // partida es la de la certificación facturada más reciente.
      if (!result.has(row.budgetItemId)) {
        result.set(row.budgetItemId, Number(row.cumulativePct));
      }
    }
    return result;
  }

  private async ensureBudgetItemInProject(
    budgetItemId: string,
    projectId: string,
  ): Promise<void> {
    const [row] = await this.dbs.db
      .select({ id: budgetItems.id })
      .from(budgetItems)
      .innerJoin(budgets, eq(budgetItems.budgetId, budgets.id))
      .where(
        and(eq(budgetItems.id, budgetItemId), eq(budgets.projectId, projectId)),
      )
      .limit(1);
    if (!row) {
      throw new BadRequestException(
        'La partida indicada no pertenece al presupuesto de esta obra',
      );
    }
  }

  private async ensureProject(
    companyId: string,
    projectId: string,
  ): Promise<{ code: string }> {
    const [project] = await this.dbs.db
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!project) {
      throw new BadRequestException('La obra indicada no existe');
    }
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new BadRequestException('No tienes acceso a esa obra');
    }
    return project;
  }

  private async findModel(id: string): Promise<BimModel> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(bimModels)
      .where(
        and(
          eq(bimModels.id, id),
          eq(bimModels.companyId, companyId),
          isNull(bimModels.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Modelo BIM no encontrado');
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(row.projectId)) {
      throw new NotFoundException('Modelo BIM no encontrado');
    }
    return row;
  }
}
