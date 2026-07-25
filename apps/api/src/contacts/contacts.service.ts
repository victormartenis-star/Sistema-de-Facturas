import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ilike, isNull, or, SQL } from 'drizzle-orm';
import { Contact, contacts } from '@erp/db';
import {
  ContactCreateInput,
  ContactDto,
  ContactKind,
  ContactUpdateInput,
  contactCreateSchema,
  contactUpdateSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';

function toDto(row: Contact): ContactDto {
  return {
    id: row.id,
    kind: row.kind as ContactKind,
    legalName: row.legalName,
    tradeName: row.tradeName,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    iban: row.iban,
    paymentTermsDays: row.paymentTermsDays,
    defaultCategoryId: row.defaultCategoryId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ContactsService {
  constructor(private readonly dbs: DbService) {}

  async list(search?: string, kind?: ContactKind): Promise<ContactDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(contacts.companyId, companyId),
      isNull(contacts.deletedAt),
    ];
    if (kind) {
      filters.push(eq(contacts.kind, kind));
    }
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      filters.push(
        or(
          ilike(contacts.legalName, term),
          ilike(contacts.tradeName, term),
          ilike(contacts.taxId, term),
        ) as SQL,
      );
    }
    const rows = await this.dbs.db
      .select()
      .from(contacts)
      .where(and(...filters))
      .orderBy(asc(contacts.legalName));
    return rows.map(toDto);
  }

  async get(id: string): Promise<ContactDto> {
    return toDto(await this.find(id));
  }

  async create(input: ContactCreateInput): Promise<ContactDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = contactCreateSchema.parse(input);
    try {
      const [row] = await this.dbs.db
        .insert(contacts)
        .values({
          companyId,
          kind: data.kind,
          legalName: data.legalName,
          tradeName: data.tradeName ?? null,
          taxId: data.taxId || null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          iban: data.iban || null,
          paymentTermsDays: data.paymentTermsDays,
          defaultCategoryId: data.defaultCategoryId ?? null,
        })
        .returning();
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateTaxId(err, data.taxId ?? '');
    }
  }

  async update(id: string, input: ContactUpdateInput): Promise<ContactDto> {
    await this.find(id);
    const data = contactUpdateSchema.parse(input);
    try {
      const [row] = await this.dbs.db
        .update(contacts)
        .set({
          ...(data.kind !== undefined && { kind: data.kind }),
          ...(data.legalName !== undefined && { legalName: data.legalName }),
          ...(data.tradeName !== undefined && {
            tradeName: data.tradeName ?? null,
          }),
          ...(data.taxId !== undefined && { taxId: data.taxId || null }),
          ...(data.email !== undefined && { email: data.email ?? null }),
          ...(data.phone !== undefined && { phone: data.phone ?? null }),
          ...(data.iban !== undefined && { iban: data.iban || null }),
          ...(data.paymentTermsDays !== undefined && {
            paymentTermsDays: data.paymentTermsDays,
          }),
          ...(data.defaultCategoryId !== undefined && {
            defaultCategoryId: data.defaultCategoryId ?? null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id))
        .returning();
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateTaxId(err, data.taxId ?? '');
    }
  }

  /** Borrado lógico; el histórico de facturas seguirá apuntando al contacto. */
  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.dbs.db
      .update(contacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(contacts.id, id));
  }

  private async find(id: string): Promise<Contact> {
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Contacto no encontrado');
    }
    return row;
  }

  private rethrowDuplicateTaxId(err: unknown, taxId: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException(
        `Ya existe un contacto con el NIF/CIF "${taxId}"`,
      );
    }
    throw err;
  }
}
