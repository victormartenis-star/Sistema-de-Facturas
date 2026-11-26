import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ilike, isNull, or, SQL } from 'drizzle-orm';
import { Contact, contacts, DbOrTx } from '@erp/db';
import {
  ContactCreateInput,
  ContactDto,
  ContactKind,
  ContactUpdateInput,
  contactCreateSchema,
  contactUpdateSchema,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import {
  condicionVersion,
  falloActualizacion,
  incrementarVersion,
  verificarVersion,
} from '../common/version';
import { DbService } from '../db/db.service';

/** 404 de contacto con su código de dominio. */
function contactoNoEncontrado(): NotFoundException {
  return new NotFoundException({
    code: 'CONTACT_NOT_FOUND',
    message: 'Contacto no encontrado',
  });
}

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
    sepaMandateRef: row.sepaMandateRef,
    sepaMandateDate: row.sepaMandateDate,
    paymentTermsDays: row.paymentTermsDays,
    defaultCategoryId: row.defaultCategoryId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ContactsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(search?: string, kind?: ContactKind): Promise<ContactDto[]> {
    const companyId = await this.dbs.getCompanyId();
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
    const companyId = await this.dbs.getCompanyId();
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
          sepaMandateRef: data.sepaMandateRef || null,
          sepaMandateDate: data.sepaMandateDate || null,
          paymentTermsDays: data.paymentTermsDays,
          defaultCategoryId: data.defaultCategoryId ?? null,
        })
        .returning();
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateTaxId(err, data.taxId ?? '');
    }
  }

  async update(
    id: string,
    input: ContactUpdateInput,
    versionEsperada?: number,
  ): Promise<ContactDto> {
    await this.find(id);
    const data = contactUpdateSchema.parse(input);
    const companyId = await this.dbs.getCompanyId();
    try {
      const row = await this.dbs.db.transaction(async (tx) => {
        const actual = await this.bloquearContacto(tx, id, companyId);
        verificarVersion(actual.version, versionEsperada);
        const [actualizado] = await tx
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
            ...(data.sepaMandateRef !== undefined && {
              sepaMandateRef: data.sepaMandateRef || null,
            }),
            ...(data.sepaMandateDate !== undefined && {
              sepaMandateDate: data.sepaMandateDate || null,
            }),
            ...(data.paymentTermsDays !== undefined && {
              paymentTermsDays: data.paymentTermsDays,
            }),
            ...(data.defaultCategoryId !== undefined && {
              defaultCategoryId: data.defaultCategoryId ?? null,
            }),
            version: incrementarVersion(contacts),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(contacts.id, id),
              condicionVersion(contacts, versionEsperada),
            ),
          )
          .returning();
        if (!actualizado) {
          return falloActualizacion(
            tx,
            contacts,
            id,
            versionEsperada,
            () => contactoNoEncontrado(),
            'Contacto no encontrado',
          );
        }
        await this.audit.registrar(tx, {
          entityType: 'contact',
          entityId: id,
          action: 'update',
          newData: actualizado,
        });
        return actualizado;
      });
      return toDto(row);
    } catch (err) {
      this.rethrowDuplicateTaxId(err, data.taxId ?? '');
    }
  }

  /** Borrado lógico (deleted_at); el histórico de facturas sigue apuntando al contacto. Versionado. */
  async remove(id: string, versionEsperada?: number): Promise<void> {
    await this.find(id);
    const companyId = await this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const actual = await this.bloquearContacto(tx, id, companyId);
      verificarVersion(actual.version, versionEsperada);
      const [borrado] = await tx
        .update(contacts)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: incrementarVersion(contacts),
        })
        .where(
          and(eq(contacts.id, id), condicionVersion(contacts, versionEsperada)),
        )
        .returning();
      if (!borrado) {
        await falloActualizacion(
          tx,
          contacts,
          id,
          versionEsperada,
          () => contactoNoEncontrado(),
          'Contacto no encontrado',
        );
      }
      await this.audit.registrar(tx, {
        entityType: 'contact',
        entityId: id,
        action: 'delete',
        oldData: actual,
      });
    });
  }

  /** Lee la fila con bloqueo (FOR UPDATE) dentro de la transacción; 404 si no es de la empresa o está borrada. */
  private async bloquearContacto(
    tx: DbOrTx,
    id: string,
    companyId: string,
  ): Promise<Contact> {
    const [fila] = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.id, id),
          eq(contacts.companyId, companyId),
          isNull(contacts.deletedAt),
        ),
      )
      .for('update')
      .limit(1);
    if (!fila) throw contactoNoEncontrado();
    return fila;
  }

  private async find(id: string): Promise<Contact> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.id, id),
          eq(contacts.companyId, companyId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw contactoNoEncontrado();
    }
    return row;
  }

  private rethrowDuplicateTaxId(err: unknown, taxId: string): never {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new ConflictException({
        code: 'CONTACT_TAX_ID_DUPLICATED',
        message: `Ya existe un contacto con el NIF/CIF "${taxId}"`,
      });
    }
    throw err;
  }
}
