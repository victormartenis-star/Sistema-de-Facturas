import { createHash } from 'node:crypto';
import { ReadStream } from 'node:fs';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, isNull, SQL } from 'drizzle-orm';
import { Document, documents, projects } from '@erp/db';
import {
  DOCUMENT_ACCEPTED_MIME_TYPES,
  DocStatus,
  DocType,
  DocumentDto,
  DocumentUpdateInput,
  DocumentUploadMeta,
  documentUpdateSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { StorageService } from './storage.service';

/** Archivo recibido por multer (memoria); tipado local para no depender de @types/multer. */
export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function toDto(row: Document): DocumentDto {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    docType: row.docType as DocType | null,
    status: row.status as DocStatus,
    projectId: row.projectId,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * multer entrega originalname decodificado como latin1 aunque el navegador
 * lo envíe en UTF-8 ("Peldaños" llega como "PeldaÃ±os"). Se reinterpreta y,
 * si el resultado no es UTF-8 válido, se conserva el original.
 */
function decodeOriginalName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {}

  async list(filters: {
    search?: string;
    status?: DocStatus;
    docType?: DocType;
    projectId?: string;
  }): Promise<DocumentDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const where: SQL[] = [
      eq(documents.companyId, companyId),
      isNull(documents.deletedAt),
    ];
    if (filters.status) {
      where.push(eq(documents.status, filters.status));
    }
    if (filters.docType) {
      where.push(eq(documents.docType, filters.docType));
    }
    if (filters.projectId) {
      where.push(eq(documents.projectId, filters.projectId));
    }
    if (filters.search?.trim()) {
      where.push(ilike(documents.fileName, `%${filters.search.trim()}%`));
    }
    const rows = await this.dbs.db
      .select()
      .from(documents)
      .where(and(...where))
      .orderBy(desc(documents.createdAt));
    return rows.map(toDto);
  }

  async get(id: string): Promise<DocumentDto> {
    return toDto(await this.find(id));
  }

  async upload(
    file: UploadedDocumentFile,
    meta: DocumentUploadMeta,
  ): Promise<DocumentDto> {
    const companyId = await this.dbs.getDefaultCompanyId();

    if (
      !(DOCUMENT_ACCEPTED_MIME_TYPES as readonly string[]).includes(
        file.mimetype,
      )
    ) {
      throw new BadRequestException(
        `Tipo de archivo no admitido (${file.mimetype}). Se aceptan PDF e imágenes JPG, PNG o WEBP.`,
      );
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (meta.projectId) {
      await this.ensureProject(companyId, meta.projectId);
    }

    const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const [duplicate] = await this.dbs.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.fileSha256, fileSha256),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ConflictException(
        `Este archivo ya está en el sistema como "${duplicate.fileName}"`,
      );
    }

    const fileName = decodeOriginalName(file.originalname);
    const storageKey = await this.storage.save(
      companyId,
      fileName,
      file.buffer,
    );
    try {
      const [row] = await this.dbs.db
        .insert(documents)
        .values({
          companyId,
          projectId: meta.projectId ?? null,
          docType: meta.docType ?? null,
          storageKey,
          fileName,
          mimeType: file.mimetype,
          fileSize: file.buffer.length,
          fileSha256,
          source: 'web',
        })
        .returning();
      return toDto(row);
    } catch (err) {
      // Dos subidas simultáneas del mismo archivo: gana la primera
      await this.storage.discard(storageKey);
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Este archivo ya está en el sistema');
      }
      throw err;
    }
  }

  async update(id: string, input: DocumentUpdateInput): Promise<DocumentDto> {
    await this.find(id);
    const data = documentUpdateSchema.parse(input);
    if (data.projectId) {
      const companyId = await this.dbs.getDefaultCompanyId();
      await this.ensureProject(companyId, data.projectId);
    }
    const [row] = await this.dbs.db
      .update(documents)
      .set({
        ...(data.projectId !== undefined && { projectId: data.projectId }),
        ...(data.docType !== undefined && { docType: data.docType }),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();
    return toDto(row);
  }

  /** Borrado lógico; el original se conserva (retención legal). */
  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.dbs.db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(documents.id, id));
  }

  /** Original para el visor: fila + stream del archivo. */
  async openFile(
    id: string,
  ): Promise<{ document: Document; stream: ReadStream }> {
    const row = await this.find(id);
    if (!(await this.storage.exists(row.storageKey))) {
      throw new NotFoundException(
        'El archivo original no está disponible en el almacenamiento',
      );
    }
    return { document: row, stream: this.storage.read(row.storageKey) };
  }

  private async find(id: string): Promise<Document> {
    const [row] = await this.dbs.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Documento no encontrado');
    }
    return row;
  }

  private async ensureProject(
    companyId: string,
    projectId: string,
  ): Promise<void> {
    const [project] = await this.dbs.db
      .select({ id: projects.id })
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
  }
}
