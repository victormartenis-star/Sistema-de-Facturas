import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, SQL } from 'drizzle-orm';
import { DeliveryNote, contacts, deliveryNotes, projects } from '@erp/db';
import {
  DeliveryNoteCreateInput,
  DeliveryNoteDto,
  DeliveryNoteStatus,
  DeliveryNoteUpdateInput,
  deliveryNoteCreateSchema,
  deliveryNoteUpdateSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';

const UNIQUE_VIOLATION = '23505';

type Row = {
  note: DeliveryNote;
  contactName: string;
  projectCode: string | null;
};

function toDto(row: Row): DeliveryNoteDto {
  const { note } = row;
  return {
    id: note.id,
    contactId: note.contactId,
    contactName: row.contactName,
    projectId: note.projectId,
    projectCode: row.projectCode,
    phaseId: note.phaseId,
    noteNumber: note.noteNumber,
    noteDate: note.noteDate,
    description: note.description,
    amount: Number(note.amount),
    status: note.status as DeliveryNoteStatus,
    validatedAt: note.validatedAt?.toISOString() ?? null,
    invoiceId: note.invoiceId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

@Injectable()
export class DeliveryNotesService {
  constructor(private readonly dbs: DbService) {}

  /**
   * Listado con filtros. `availableForContact` devuelve solo los albaranes
   * validados y sin factura de ese proveedor: los candidatos al punteado.
   */
  async list(options: {
    search?: string;
    status?: DeliveryNoteStatus;
    contactId?: string;
    availableForContact?: string;
  }): Promise<DeliveryNoteDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(deliveryNotes.companyId, companyId),
      isNull(deliveryNotes.deletedAt),
    ];
    if (options.status) filters.push(eq(deliveryNotes.status, options.status));
    if (options.contactId) {
      filters.push(eq(deliveryNotes.contactId, options.contactId));
    }
    if (options.availableForContact) {
      filters.push(
        eq(deliveryNotes.contactId, options.availableForContact),
        eq(deliveryNotes.status, 'validado'),
        isNull(deliveryNotes.invoiceId),
      );
    }
    if (options.search?.trim()) {
      const term = `%${options.search.trim()}%`;
      filters.push(
        or(
          ilike(deliveryNotes.noteNumber, term),
          ilike(contacts.legalName, term),
        ) as SQL,
      );
    }
    const rows = await this.dbs.db
      .select({
        note: deliveryNotes,
        contactName: contacts.legalName,
        projectCode: projects.code,
      })
      .from(deliveryNotes)
      .innerJoin(contacts, eq(deliveryNotes.contactId, contacts.id))
      .leftJoin(projects, eq(deliveryNotes.projectId, projects.id))
      .where(and(...filters))
      .orderBy(desc(deliveryNotes.noteDate), desc(deliveryNotes.createdAt));
    return rows.map(toDto);
  }

  async create(input: DeliveryNoteCreateInput): Promise<DeliveryNoteDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = deliveryNoteCreateSchema.parse(input);
    try {
      const [row] = await this.dbs.db
        .insert(deliveryNotes)
        .values({
          companyId,
          contactId: data.contactId,
          projectId: data.projectId ?? null,
          phaseId: data.phaseId ?? null,
          noteNumber: data.noteNumber,
          noteDate: data.noteDate,
          description: data.description ?? null,
          amount: data.amount.toFixed(2),
        })
        .returning();
      return this.get(row.id);
    } catch (err) {
      this.rethrowDuplicateNumber(err, data.noteNumber);
    }
  }

  async update(
    id: string,
    input: DeliveryNoteUpdateInput,
  ): Promise<DeliveryNoteDto> {
    const note = await this.find(id);
    if (note.status === 'facturado') {
      throw new ConflictException('No se puede editar un albarán ya facturado');
    }
    const data = deliveryNoteUpdateSchema.parse(input);
    try {
      await this.dbs.db
        .update(deliveryNotes)
        .set({
          ...(data.contactId !== undefined && { contactId: data.contactId }),
          ...(data.projectId !== undefined && {
            projectId: data.projectId ?? null,
          }),
          ...(data.phaseId !== undefined && { phaseId: data.phaseId ?? null }),
          ...(data.noteNumber !== undefined && {
            noteNumber: data.noteNumber,
          }),
          ...(data.noteDate !== undefined && { noteDate: data.noteDate }),
          ...(data.description !== undefined && {
            description: data.description ?? null,
          }),
          ...(data.amount !== undefined && {
            amount: data.amount.toFixed(2),
          }),
          updatedAt: new Date(),
        })
        .where(eq(deliveryNotes.id, id));
    } catch (err) {
      this.rethrowDuplicateNumber(err, data.noteNumber ?? '');
    }
    return this.get(id);
  }

  /** El jefe de obra da por bueno el albarán: pasa a "validado". */
  async validate(id: string): Promise<DeliveryNoteDto> {
    const note = await this.find(id);
    if (note.status !== 'pendiente') {
      throw new ConflictException('Solo se validan albaranes pendientes');
    }
    await this.dbs.db
      .update(deliveryNotes)
      .set({
        status: 'validado',
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveryNotes.id, id));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const note = await this.find(id);
    if (note.status === 'facturado') {
      throw new ConflictException(
        'No se puede eliminar un albarán facturado: anula antes la factura',
      );
    }
    await this.dbs.db
      .update(deliveryNotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(deliveryNotes.id, id));
  }

  private async get(id: string): Promise<DeliveryNoteDto> {
    const [row] = await this.dbs.db
      .select({
        note: deliveryNotes,
        contactName: contacts.legalName,
        projectCode: projects.code,
      })
      .from(deliveryNotes)
      .innerJoin(contacts, eq(deliveryNotes.contactId, contacts.id))
      .leftJoin(projects, eq(deliveryNotes.projectId, projects.id))
      .where(and(eq(deliveryNotes.id, id), isNull(deliveryNotes.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Albarán no encontrado');
    }
    return toDto(row);
  }

  private async find(id: string): Promise<DeliveryNote> {
    const [row] = await this.dbs.db
      .select()
      .from(deliveryNotes)
      .where(and(eq(deliveryNotes.id, id), isNull(deliveryNotes.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Albarán no encontrado');
    }
    return row;
  }

  private rethrowDuplicateNumber(err: unknown, num: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException(
        `Ya existe un albarán con el número "${num}" para ese proveedor`,
      );
    }
    throw err;
  }
}
