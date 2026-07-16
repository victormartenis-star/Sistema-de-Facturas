import { sql } from 'drizzle-orm';
import {
  date,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
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

export type Company = typeof companies.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
