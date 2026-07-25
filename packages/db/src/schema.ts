import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema inicial: empresas y obras.
 * Sigue 02-base-de-datos.md §2.1–2.2. El resto de tablas (contactos,
 * facturas, documentos…) se añadirán en incrementos posteriores; `client_id`
 * de projects llegará junto con la tabla `contacts`.
 */

export const projectStatusEnum = pgEnum('project_status', [
  'oferta',
  'adjudicada',
  'en_curso',
  'pausada',
  'finalizada',
  'garantia',
  'cerrada',
]);

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  taxId: text('tax_id').notNull(),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: projectStatusEnum('status').notNull().default('en_curso'),
    startDate: date('start_date'),
    expectedEnd: date('expected_end'),
    contractAmount: numeric('contract_amount', { precision: 14, scale: 2 }),
    retentionPct: numeric('retention_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('5.00'),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Único parcial: permite reutilizar el código de una obra borrada lógicamente
  (t) => [
    uniqueIndex('projects_company_code_unique')
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

/** Categorías de gasto (02-base-de-datos.md §2.3). Las 8 de serie llevan is_system. */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique('categories_company_slug_unique').on(t.companyId, t.slug)],
);

export const contactKindEnum = pgEnum('contact_kind', [
  'proveedor',
  'cliente',
  'ambos',
]);

/** Proveedores y clientes unificados (02-base-de-datos.md §2.2). */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: contactKindEnum('kind').notNull(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    taxId: text('tax_id'),
    address: jsonb('address'),
    iban: text('iban'),
    email: text('email'),
    phone: text('phone'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    defaultCategoryId: uuid('default_category_id').references(
      () => categories.id,
    ),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Único parcial: un NIF/CIF activo por empresa (los borrados no bloquean)
  (t) => [
    uniqueIndex('contacts_company_taxid_unique')
      .on(t.companyId, t.taxId)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type Company = typeof companies.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
