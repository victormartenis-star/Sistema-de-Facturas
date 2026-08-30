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
    /** Presupuesto de venta: lo que se factura al cliente. */
    contractAmount: numeric('contract_amount', { precision: 14, scale: 2 }),
    /**
     * Coste objetivo: la meta interna de coste, distinta del precio ofertado
     * y con la contingencia de los riesgos detectados dentro. Confundirlo con
     * el presupuesto de venta es lo que hace que una obra parezca ir bien
     * hasta el mes en que deja de ir bien.
     */
    targetCost: numeric('target_cost', { precision: 14, scale: 2 }),
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
    // Homologación PRL: solo las subcontratas y empresas que pisan la obra
    // quedan sujetas a control documental; un proveedor de material no.
    requiresCompliance: boolean('requires_compliance').notNull().default(false),
    // Bloqueo manual (distinto del automático por documentación vencida)
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockedReason: text('blocked_reason'),
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

export const docStatusEnum = pgEnum('doc_status', [
  'subido',
  'procesando',
  'extraido',
  'validado',
  'rechazado',
  'error',
]);

export const docTypeEnum = pgEnum('doc_type', [
  'factura_compra',
  'factura_venta',
  'albaran',
  'presupuesto',
  'certificacion',
  'pedido',
  'contrato',
  'ticket',
  'otro',
]);

/**
 * Archivo documental (02-base-de-datos.md §2.4): original + metadatos +
 * dedupe por hash. Las columnas de extracción (full_text, fts, embedding)
 * y uploaded_by llegarán con el pipeline OCR y la autenticación.
 * file_sha256 se guarda en hexadecimal (64 caracteres) en lugar de bytea.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id').references(() => projects.id),
    docType: docTypeEnum('doc_type'),
    status: docStatusEnum('status').notNull().default('subido'),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    fileSha256: text('file_sha256').notNull(),
    source: text('source').notNull().default('web'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Dedupe exacto por contenido; el borrado lógico permite volver a subir
  (t) => [
    uniqueIndex('documents_dedupe_idx')
      .on(t.companyId, t.fileSha256)
      .where(sql`deleted_at IS NULL`),
  ],
);

/* ─────────────────────────── Módulos económicos ───────────────────────────
 * Partidas, facturas con imputación analítica, certificaciones a origen,
 * albaranes (matching) y vencimientos de tesorería.
 */

/** Partidas/fases de ejecución con presupuesto teórico (desvío por obra). */
export const projectPhases = pgTable(
  'project_phases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    budgetAmount: numeric('budget_amount', { precision: 14, scale: 2 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('project_phases_project_code_unique')
      .on(t.projectId, t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const invoiceKindEnum = pgEnum('invoice_kind', ['compra', 'venta']);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'borrador',
  'aprobada',
  'pagada',
  'anulada',
]);

/**
 * Facturas de compra y venta. Los importes se guardan calculados
 * (base, IVA, total, retención) para que el histórico no cambie si
 * mañana cambian los tipos. ISP ⇒ IVA 0 + leyenda legal en el PDF.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: invoiceKindEnum('kind').notNull(),
    status: invoiceStatusEnum('status').notNull().default('borrador'),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    invoiceNumber: text('invoice_number').notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date'),
    baseAmount: numeric('base_amount', { precision: 14, scale: 2 }).notNull(),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 2 }).notNull(),
    totalAmount: numeric('total_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
    isp: boolean('isp').notNull().default(false),
    retentionPct: numeric('retention_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0.00'),
    retentionAmount: numeric('retention_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0.00'),
    retentionReleaseDate: date('retention_release_date'),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Un mismo proveedor/cliente no puede repetir número de factura activo
  (t) => [
    uniqueIndex('invoices_contact_number_unique')
      .on(t.companyId, t.kind, t.contactId, t.invoiceNumber)
      .where(sql`deleted_at IS NULL`),
  ],
);

/** Líneas de factura: aquí vive la imputación analítica obra/partida. */
export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  baseAmount: numeric('base_amount', { precision: 14, scale: 2 }).notNull(),
  vatPct: numeric('vat_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('21.00'),
  projectId: uuid('project_id').references(() => projects.id),
  phaseId: uuid('phase_id').references(() => projectPhases.id),
  categoryId: uuid('category_id').references(() => categories.id),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const certStatusEnum = pgEnum('cert_status', ['borrador', 'facturada']);

/** Certificaciones de obra: % a origen y facturación por diferencia. */
export const certifications = pgTable(
  'certifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    seq: integer('seq').notNull(),
    certDate: date('cert_date').notNull(),
    cumulativePct: numeric('cumulative_pct', {
      precision: 5,
      scale: 2,
    }).notNull(),
    cumulativeAmount: numeric('cumulative_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
    periodAmount: numeric('period_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
    retentionPct: numeric('retention_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0.00'),
    retentionAmount: numeric('retention_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0.00'),
    status: certStatusEnum('status').notNull().default('borrador'),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('certifications_project_seq_unique')
      .on(t.projectId, t.seq)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const deliveryNoteStatusEnum = pgEnum('delivery_note_status', [
  'pendiente',
  'validado',
  'facturado',
]);

/* ─────────────────────── Pedidos de compra ───────────────────────
 * La pieza sobre la que se apoya la regla de oro del manual de procesos:
 *   sin pedido no hay compra · sin pedido no hay albarán validado
 *   sin pedido + albarán no hay factura aprobada · sin factura no hay pago
 * El pedido es además el documento que fija el coste comprometido de la
 * obra: lo que ya se debe aunque todavía no haya llegado la factura.
 */

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'emitido',
  'servido_parcial',
  'servido',
  'facturado',
  'cerrado',
  'anulado',
]);

/**
 * Pedido a proveedor. El número se compone con el código de la obra y un
 * correlativo propio de esa obra (OBR-045-PED-0032), de forma que cualquiera
 * identifica de inmediato a qué obra pertenece.
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    /** Correlativo dentro de la obra; con el código de obra forma el número. */
    seq: integer('seq').notNull(),
    orderNumber: text('order_number').notNull(),
    orderDate: date('order_date').notNull(),
    /** Capítulo/partida de imputación: sin esto no hay coste por capítulo. */
    phaseId: uuid('phase_id').references(() => projectPhases.id),
    categoryId: uuid('category_id').references(() => categories.id),
    description: text('description').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    /** Fecha de entrega comprometida por el proveedor. */
    expectedDate: date('expected_date'),
    /** Quién pide (jefe de obra). Texto hasta que existan usuarios. */
    requestedBy: text('requested_by'),
    status: purchaseOrderStatusEnum('status').notNull().default('emitido'),
    /**
     * Pedido urgente autorizado verbalmente y regularizado después: es la
     * válvula de escape de la regla de oro. Se marca para poder medir cuánta
     * compra entra por esa vía, que es justo lo que hay que vigilar.
     */
    urgent: boolean('urgent').notNull().default(false),
    notes: text('notes'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('purchase_orders_number_unique')
      .on(t.companyId, t.orderNumber)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex('purchase_orders_project_seq_unique')
      .on(t.projectId, t.seq)
      .where(sql`deleted_at IS NULL`),
  ],
);

/** Albaranes/partes de trabajo para el punteado de facturas de compra. */
export const deliveryNotes = pgTable(
  'delivery_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    projectId: uuid('project_id').references(() => projects.id),
    phaseId: uuid('phase_id').references(() => projectPhases.id),
    /**
     * Pedido al que responde el albarán. Nullable en la base porque los
     * albaranes anteriores a la implantación de la regla no lo tienen; la
     * regla se aplica en la validación, no en el tipo de la columna.
     */
    orderId: uuid('order_id').references(() => purchaseOrders.id),
    noteNumber: text('note_number').notNull(),
    noteDate: date('note_date').notNull(),
    description: text('description'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: deliveryNoteStatusEnum('status').notNull().default('pendiente'),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('delivery_notes_contact_number_unique')
      .on(t.companyId, t.contactId, t.noteNumber)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const milestoneDirectionEnum = pgEnum('milestone_direction', [
  'cobro',
  'pago',
]);

export const milestoneKindEnum = pgEnum('milestone_kind', [
  'ordinario',
  'retencion',
]);

export const milestoneStatusEnum = pgEnum('milestone_status', [
  'previsto',
  'pagado',
]);

/**
 * Vencimientos de cobro/pago. Se generan al aprobar una factura:
 * uno ordinario (total - retención) y, si hay retención de garantía,
 * otro diferido a la fecha de liberación de la garantía.
 */
export const paymentMilestones = pgTable('payment_milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  direction: milestoneDirectionEnum('direction').notNull(),
  kind: milestoneKindEnum('kind').notNull().default('ordinario'),
  dueDate: date('due_date').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  status: milestoneStatusEnum('status').notNull().default('previsto'),
  paidAt: date('paid_at'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ───────────────── Homologación de subcontratas (PRL) ─────────────────
 * En construcción el contratista principal responde solidariamente de las
 * deudas con la Seguridad Social de sus subcontratas, así que la
 * documentación vigente es requisito para aprobar facturas y pagar.
 */

export const complianceDocTypeEnum = pgEnum('compliance_doc_type', [
  'plan_seguridad',
  'seguro_rc',
  'certificado_ss',
  'certificado_aeat',
  'rea',
  'itinerario_formativo',
  'reconocimiento_medico',
  'epi',
  'otro',
]);

/** Documento de homologación aportado por una subcontrata o proveedor. */
export const contactComplianceDocs = pgTable('contact_compliance_docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id),
  docType: complianceDocTypeEnum('doc_type').notNull(),
  // El archivo se reaprovecha del módulo documental (dedupe + almacenamiento)
  documentId: uuid('document_id').references(() => documents.id),
  issuedAt: date('issued_at'),
  // Sin fecha de caducidad el documento se considera permanente
  expiresAt: date('expires_at'),
  rejected: boolean('rejected').notNull().default(false),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Exención temporal: permite operar con un contacto bloqueado bajo la
 * responsabilidad de quien la concede. Exige motivo y fecha de caducidad.
 */
export const complianceWaivers = pgTable('compliance_waivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id),
  reason: text('reason').notNull(),
  validUntil: date('valid_until').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ──────────── Planificación económica y coste probable ────────────
 * Lo que se revisa en la reunión mensual: tres curvas sobre el mismo eje de
 * meses —venta, coste objetivo y coste real—. En cuanto la curva de coste
 * real se separa de la de objetivo hay desviación, y el mes en que se
 * separan dice dónde buscar la causa.
 */

/**
 * Periodificación: reparto por meses de la producción y el coste previstos
 * hasta fin de obra. Sin este reparto no existe el corte mensual y "vamos
 * bien" es una opinión en lugar de una cifra.
 */
export const projectMonthlyPlan = pgTable(
  'project_monthly_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    /** Siempre el día 1 del mes al que corresponde. */
    month: date('month').notNull(),
    plannedProduction: numeric('planned_production', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    plannedCost: numeric('planned_cost', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('project_monthly_plan_unique')
      .on(t.projectId, t.month)
      .where(sql`deleted_at IS NULL`),
  ],
);

/**
 * Estimación mensual del coste que todavía queda por contratar y ejecutar.
 *
 * Es el único sumando del coste probable que no se puede deducir de ningún
 * documento: lo pone el jefe de obra. Se guarda el histórico a propósito, no
 * solo el último valor, porque comparar lo que se estimó cada mes con lo que
 * acabó costando es la única forma de detectar la previsión complaciente.
 */
export const costForecasts = pgTable(
  'cost_forecasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    /** Mes al que se refiere la previsión (día 1). */
    asOfMonth: date('as_of_month').notNull(),
    pendingToContract: numeric('pending_to_contract', {
      precision: 14,
      scale: 2,
    }).notNull(),
    notes: text('notes'),
    /** Quién la firma. Texto hasta que existan usuarios. */
    reportedBy: text('reported_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('cost_forecasts_unique')
      .on(t.projectId, t.asOfMonth)
      .where(sql`deleted_at IS NULL`),
  ],
);

/**
 * Resultado bruto del pipeline OCR/IA (02-base-de-datos.md §2.4).
 * Versionable: cada pasada del modelo deja una fila, la más reciente es la
 * que se muestra en la bandeja de validación. `payload` guarda los campos
 * extraídos, `confidence` la confianza 0-1 por campo y `warnings` los avisos
 * (descuadre, NIF inválido, duplicado…).
 */
export const extractions = pgTable('extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  payload: jsonb('payload').notNull(),
  confidence: jsonb('confidence').notNull(),
  warnings: jsonb('warnings').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type ProjectPhase = typeof projectPhases.$inferSelect;
export type NewProjectPhase = typeof projectPhases.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type NewInvoiceLine = typeof invoiceLines.$inferInsert;
export type Certification = typeof certifications.$inferSelect;
export type NewCertification = typeof certifications.$inferInsert;
export type ProjectMonthlyPlan = typeof projectMonthlyPlan.$inferSelect;
export type NewProjectMonthlyPlan = typeof projectMonthlyPlan.$inferInsert;
export type CostForecast = typeof costForecasts.$inferSelect;
export type NewCostForecast = typeof costForecasts.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type DeliveryNote = typeof deliveryNotes.$inferSelect;
export type NewDeliveryNote = typeof deliveryNotes.$inferInsert;
export type PaymentMilestone = typeof paymentMilestones.$inferSelect;
export type NewPaymentMilestone = typeof paymentMilestones.$inferInsert;
export type Extraction = typeof extractions.$inferSelect;
export type NewExtraction = typeof extractions.$inferInsert;
export type ContactComplianceDoc = typeof contactComplianceDocs.$inferSelect;
export type NewContactComplianceDoc = typeof contactComplianceDocs.$inferInsert;
export type ComplianceWaiver = typeof complianceWaivers.$inferSelect;
