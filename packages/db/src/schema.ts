import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
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
    version: integer('version').notNull().default(1),
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
    version: integer('version').notNull().default(1),
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
 *
 * **Buscador full-text v1 (Fase 15, trigramas — no `fts`/`embedding`
 * todavía)**: `file_name` (aquí) y, en `invoices`, `invoice_number`/`notes`,
 * y en `contacts`, `legal_name`, tienen un índice GIN de trigramas
 * (`pg_trgm`) para tolerar errores tipográficos en `GET /search`
 * (`apps/api/src/search/`). Deliberadamente **no modelado en este
 * fichero**: la extensión + los índices viven solo en la migración
 * `0026_search_trgm.sql`, a mano — `drizzle-kit generate` diff-a
 * `schema.ts` contra el snapshot anterior, así que declararlos aquí sin
 * que el snapshot los conozca haría que el siguiente `generate` intentara
 * "recrearlos" innecesariamente. Si se cambia alguna de estas 4 columnas,
 * revisar antes si el índice de esa migración sigue teniendo sentido.
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
    index('documents_project_id_idx').on(t.projectId),
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
    /**
     * Cronograma planificado (no inferido de fechas reales): la base para
     * `buildCurvaPlanificada()` en `@erp/shared/cost-control.ts` — distribuye
     * `budgetAmount` linealmente entre estas dos fechas para obtener el
     * Valor Planificado (PV) mensual, en vez de fabricar una curva a partir
     * del avance real ya ejecutado.
     */
    plannedStartDate: date('planned_start_date'),
    plannedEndDate: date('planned_end_date'),
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

/** Clase de factura rectificativa: total (anula el efecto) o por diferencias. */
export const rectificationKindEnum = pgEnum('rectification_kind', [
  'total',
  'diferencias',
]);

/** Motivo oficial de rectificación: R1 derecho, R2 concurso, R3 incobrables, R4 resto. */
export const rectificationMotiveEnum = pgEnum('rectification_motive', [
  'R1',
  'R2',
  'R3',
  'R4',
]);

/** Tipo oficial de rectificativa: S sustitución, I diferencias. */
export const rectificationTypeEnum = pgEnum('rectification_type', ['S', 'I']);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'borrador',
  'aprobada',
  'pagada',
  'rectificada',
  'anulada',
]);

/**
 * Estado del *Registro de Facturación* VeriFactu real (Fase 14), no
 * confundir con la huella interna `verifactu_hash` (Fase 11, siempre se
 * calcula). `generado_local` = XML construido pero no enviado (sin
 * `AEAT_CERT_PATH` configurado, el caso de hoy); `enviado` exige un
 * certificado real, nunca ejercitado en esta sesión.
 */
export const verifactuStatusEnum = pgEnum('verifactu_status', [
  'no_generado',
  'generado_local',
  'enviado',
  'error',
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
    /** Versión optimista: +1 en cada mutación; el cliente la devuelve en If-Match. */
    version: integer('version').notNull().default(1),
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
    // Huella VeriFactu persistida (Fase 11): antes se recalculaba la cadena
    // entera desde la primera factura de venta en cada `GET .../facturae`.
    // `verifactuHash` cachea el resultado ya calculado para esta factura;
    // `verifactuPreviousHash` guarda con qué huella anterior se calculó, así
    // `FacturaeService` puede detectar si la cadena por delante de esta fila
    // cambió (p. ej. una factura anterior insertada a posteriori con fecha
    // más antigua) y solo recalcular desde ahí, no desde el origen. Ver
    // `apps/api/src/invoices/facturae.service.ts` y [[Módulo Facturación]].
    verifactuHash: varchar('verifactu_hash', { length: 64 }),
    verifactuPreviousHash: varchar('verifactu_previous_hash', { length: 64 }),
    verifactuGeneratedAt: timestamp('verifactu_generated_at', {
      withTimezone: true,
    }),
    /** Envío real a la AEAT (Fase 14) — ver `verifactuStatusEnum`. */
    verifactuStatus: verifactuStatusEnum('verifactu_status')
      .notNull()
      .default('no_generado'),
    verifactuSentAt: timestamp('verifactu_sent_at', { withTimezone: true }),
    /** Factura que rectifica esta (null si no es rectificativa). */
    rectifiesInvoiceId: uuid('rectifies_invoice_id').references(
      (): AnyPgColumn => invoices.id,
    ),
    rectificationKind: rectificationKindEnum('rectification_kind'),
    rectificationReason: text('rectification_reason'),
    /** Motivo oficial R1-R4 (null en rectificativas legadas). */
    rectificationMotive: rectificationMotiveEnum('rectification_motive'),
    /** Tipo oficial S/I (null en rectificativas legadas). */
    rectificationType: rectificationTypeEnum('rectification_type'),
    /** Código de motivo Facturae (ReasonCode) elegido por el titular; null en rectificativas legadas y de certificación. */
    facturaeReasonCode: varchar('facturae_reason_code', { length: 2 }),
    /** Motivo de anulación (obligatorio fuera de borrador). */
    cancelReason: text('cancel_reason'),
    /** Resultado de validar el último Facturae generado contra el XSD oficial: 'valido' | 'no_valido'; null = no evaluado. */
    facturaeXsdStatus: varchar('facturae_xsd_status', { length: 10 }),
    /** Errores del XSD (uno por línea) cuando `facturaeXsdStatus` es 'no_valido'. */
    facturaeXsdErrors: text('facturae_xsd_errors'),
    /**
     * Certificación de subcontrata de la que procede esta factura de compra
     * (generada con `POST /subcontratas/certificaciones/:id/factura-compra`).
     * La certificación sustituye a los albaranes como documento de conformidad.
     */
    certSubcontrataId: uuid('cert_subcontrata_id').references(
      (): AnyPgColumn => certificacionesSubcontrata.id,
      { onDelete: 'restrict' },
    ),
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
    check(
      'invoices_rectification_coherence',
      sql`(${t.rectifiesInvoiceId} IS NULL AND ${t.rectificationKind} IS NULL AND ${t.rectificationReason} IS NULL) OR (${t.rectifiesInvoiceId} IS NOT NULL AND ${t.rectificationKind} IS NOT NULL AND ${t.rectificationReason} IS NOT NULL)`,
    ),
    index('invoices_rectifies_invoice_id_idx').on(t.rectifiesInvoiceId),
    uniqueIndex('invoices_rectifies_total_unique')
      .on(t.rectifiesInvoiceId)
      .where(
        sql`rectification_kind = 'total' AND deleted_at IS NULL AND status <> 'anulada'`,
      ),
    index('invoices_company_status_issue_date_idx').on(
      t.companyId,
      t.status,
      t.issueDate,
    ),
    index('invoices_contact_id_idx').on(t.contactId),
    // Listado sin filtro de estado: orden real (fecha de emisión, alta, id).
    index('invoices_company_issue_date_idx')
      .on(
        t.companyId,
        t.issueDate.desc().nullsFirst(),
        t.createdAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`deleted_at IS NULL`),
    uniqueIndex('invoices_contact_number_unique')
      .on(t.companyId, t.kind, t.contactId, t.invoiceNumber)
      .where(sql`deleted_at IS NULL`),
    // La numeración de venta es de la empresa (la emite ella): un número no
    // puede repetirse aunque cambie el cliente.
    uniqueIndex('invoices_company_venta_number_unique')
      .on(t.companyId, t.invoiceNumber)
      .where(sql`kind = 'venta' AND deleted_at IS NULL`),
    // Una sola factura de compra viva por certificación de subcontrata: una
    // anulada o rectificada deja de contar y permite volver a generarla.
    // El predicado enumera los estados vivos en vez de excluir 'rectificada':
    // ese valor se añade al enum en la 0030 y Postgres no deja usarlo en la
    // misma transacción, y drizzle aplica todas las migraciones pendientes en
    // una sola (rompía `db:migrate` sobre una base vacía). Al añadir un estado
    // nuevo a `invoice_status`, revisa esta lista.
    uniqueIndex('invoices_cert_subcontrata_activa_unique')
      .on(t.certSubcontrataId)
      .where(
        sql`cert_subcontrata_id IS NOT NULL AND deleted_at IS NULL AND status IN ('borrador', 'aprobada', 'pagada')`,
      ),
    index('invoices_company_cert_subcontrata_idx')
      .on(t.companyId, t.certSubcontrataId)
      .where(sql`cert_subcontrata_id IS NOT NULL`),
    check(
      'invoices_cert_subcontrata_compra',
      sql`${t.certSubcontrataId} IS NULL OR (${t.kind} = 'compra' AND ${t.rectifiesInvoiceId} IS NULL)`,
    ),
  ],
);

/** Líneas de factura: aquí vive la imputación analítica obra/partida. */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
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
  },
  (t) => [
    index('invoice_lines_invoice_id_idx').on(t.invoiceId),
    index('invoice_lines_project_phase_idx').on(t.projectId, t.phaseId),
  ],
);

export const certStatusEnum = pgEnum('cert_status', ['borrador', 'facturada']);

/** Certificaciones de obra: % a origen y facturación por diferencia. */
export const certifications = pgTable(
  'certifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Versión optimista: +1 en cada mutación; el cliente la devuelve en If-Match. */
    version: integer('version').notNull().default(1),
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
    /** Certificación que corrige (null si no es rectificativa). */
    rectifiesCertificationId: uuid('rectifies_certification_id').references(
      (): AnyPgColumn => certifications.id,
    ),
    rectificationReason: text('rectification_reason'),
    /** Motivo oficial R1-R4 (solo certificaciones rectificativas). */
    rectificationMotive: rectificationMotiveEnum('rectification_motive'),
    /** Tipo oficial S/I (solo certificaciones rectificativas). */
    rectificationType: rectificationTypeEnum('rectification_type'),
    /** Código de motivo Facturae (ReasonCode); null en rectificativas antiguas. */
    facturaeReasonCode: varchar('facturae_reason_code', { length: 2 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('certifications_invoice_id_idx').on(t.invoiceId),
    index('certifications_company_project_seq_idx')
      .on(t.companyId, t.projectId, t.seq.desc().nullsFirst())
      .where(sql`deleted_at IS NULL`),
    index('certifications_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
    index('certifications_rectifies_certification_id_idx').on(
      t.rectifiesCertificationId,
    ),
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
    /** Versión optimista: +1 en cada mutación; el cliente la devuelve en If-Match. */
    version: integer('version').notNull().default(1),
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
    index('purchase_orders_contact_id_idx').on(t.contactId),
    index('purchase_orders_company_order_date_idx')
      .on(
        t.companyId,
        t.orderDate.desc().nullsFirst(),
        t.seq.desc().nullsFirst(),
      )
      .where(sql`deleted_at IS NULL`),
    index('purchase_orders_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
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
    /** Versión optimista: +1 en cada mutación; el cliente la devuelve en If-Match. */
    version: integer('version').notNull().default(1),
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
    /** Último motivo de devolución a pendiente (el detalle va a auditoría). */
    returnReason: text('return_reason'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('delivery_notes_order_status_idx').on(t.orderId, t.status),
    index('delivery_notes_invoice_id_idx').on(t.invoiceId),
    index('delivery_notes_project_id_idx').on(t.projectId),
    index('delivery_notes_company_note_date_idx')
      .on(
        t.companyId,
        t.noteDate.desc().nullsFirst(),
        t.createdAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`deleted_at IS NULL`),
    index('delivery_notes_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
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

/**
 * Instrumento de cobro/pago de un vencimiento — informativo, se marca a
 * mano (el ERP no integra con el banco): permite cruzar en tesorería los
 * pagos aplazados vía confirming/pagaré (que tensan caja más adelante de
 * lo que sugiere `due_date`) frente al resto.
 */
export const paymentInstrumentEnum = pgEnum('payment_instrument', [
  'transferencia',
  'confirming',
  'pagare',
  'efectivo',
  'domiciliacion',
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
export const paymentMilestones = pgTable(
  'payment_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    direction: milestoneDirectionEnum('direction').notNull(),
    kind: milestoneKindEnum('kind').notNull().default('ordinario'),
    paymentInstrument: paymentInstrumentEnum('payment_instrument')
      .notNull()
      .default('transferencia'),
    dueDate: date('due_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: milestoneStatusEnum('status').notNull().default('previsto'),
    /** Fecha de la liquidación que lo dejó a cero (null mientras siga vivo). */
    paidAt: date('paid_at'),
    /**
     * Liquidado acumulado: suma de las liquidaciones vigentes
     * (`payment_settlements`), con el signo del importe. El saldo vivo es
     * `amount - settled_amount`; `status` pasa a 'pagado' cuando llega a cero.
     */
    settledAmount: numeric('settled_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** Control optimista: +1 en cada liquidación, anulación o cambio de estado. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('payment_milestones_invoice_id_idx').on(t.invoiceId),
    index('payment_milestones_company_status_due_idx').on(
      t.companyId,
      t.status,
      t.dueDate,
    ),
    // El liquidado lleva el signo del importe y nunca lo supera (sin sobrepago).
    check(
      'payment_milestones_settled_range',
      sql`(${t.amount} >= 0 AND ${t.settledAmount} BETWEEN 0 AND ${t.amount}) OR (${t.amount} < 0 AND ${t.settledAmount} BETWEEN ${t.amount} AND 0)`,
    ),
    // Coherencia del estado: 'pagado' exige saldo vivo cero; 'previsto' exige
    // saldo vivo (salvo un vencimiento de importe 0, que no tiene nada que liquidar).
    check(
      'payment_milestones_status_settled',
      sql`(${t.status} = 'pagado' AND ${t.settledAmount} = ${t.amount}) OR (${t.status} = 'previsto' AND (${t.settledAmount} <> ${t.amount} OR ${t.amount} = 0))`,
    ),
  ],
);

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
export const contactComplianceDocs = pgTable(
  'contact_compliance_docs',
  {
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
  },
  (t) => [index('contact_compliance_docs_contact_id_idx').on(t.contactId)],
);

/**
 * Exención temporal: permite operar con un contacto bloqueado bajo la
 * responsabilidad de quien la concede. Exige motivo y fecha de caducidad.
 */
export const complianceWaivers = pgTable(
  'compliance_waivers',
  {
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
  },
  (t) => [index('compliance_waivers_contact_id_idx').on(t.contactId)],
);

/**
 * Resultado bruto del pipeline OCR/IA (02-base-de-datos.md §2.4).
 * Versionable: cada pasada del modelo deja una fila, la más reciente es la
 * que se muestra en la bandeja de validación. `payload` guarda los campos
 * extraídos, `confidence` la confianza 0-1 por campo y `warnings` los avisos
 * (descuadre, NIF inválido, duplicado…).
 */
export const extractions = pgTable(
  'extractions',
  {
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
  },
  (t) => [index('extractions_document_id_idx').on(t.documentId)],
);

/**
 * Identidad y acceso (02-base-de-datos.md §2.1).
 * Autenticación propia: contraseña con scrypt, JWT de acceso de corta vida y
 * refresh tokens persistidos (solo su hash) para poder revocarlos. El rol
 * `obra` solo ve los proyectos asignados en `user_project_access`.
 *
 * Fase 14 añade `subcontrata` y `cliente`: roles de solo-portal (ver
 * `apps/api/src/modules/portals`). Un usuario `subcontrata` solo ve lo suyo
 * vía `users.contact_id`; uno `cliente` solo las obras de
 * `user_project_access`, igual que `obra` pero de solo lectura.
 */
export const userRoleEnum = pgEnum('user_role', [
  'admin',
  'gerente',
  'administracion',
  'obra',
  'subcontrata',
  'cliente',
  // Fase 2: solo lectura sobre toda la empresa (como `gerente`); la API
  // (`ReadOnlyGuard`) le bloquea cualquier escritura.
  'lector',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    role: userRoleEnum('role').notNull().default('administracion'),
    /** Solo para role = 'subcontrata': el contacto que representa este usuario en el portal. */
    contactId: uuid('contact_id').references(() => contacts.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Control optimista de concurrencia: se incrementa en cada PATCH/DELETE. */
    version: integer('version').notNull().default(1),
  },
  // El email identifica al usuario en todo el sistema (login sin indicar empresa)
  (t) => [
    uniqueIndex('users_email_unique')
      .on(sql`lower(${t.email})`)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const userProjectAccess = pgTable(
  'user_project_access',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // sha256 del token opaco entregado al cliente; el token en claro no se guarda
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('refresh_tokens_user_id_idx').on(t.userId)],
);

export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProjectAccess = typeof userProjectAccess.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
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

// ─── Presupuestos ────────────────────────────────────────────────────────────

/** Estado del presupuesto: borrador → activo (solo 1 activo por obra) → cerrado. */
export const budgetStatusEnum = pgEnum('budget_status', [
  'borrador',
  'activo',
  'cerrado',
]);

/**
 * Cabecera de presupuesto de obra. Una obra puede tener varias versiones;
 * solo puede haber un presupuesto `activo` por obra a la vez.
 * `source`: 'manual' | 'bc3' — indica si se creó a mano o se importó desde Presto/BC3.
 */
export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Versión optimista: +1 en cada mutación; el cliente la devuelve en If-Match. */
    version: integer('version').notNull().default(1),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: budgetStatusEnum('status').notNull().default('borrador'),
    /** 'manual' | 'bc3' */
    source: text('source').notNull().default('manual'),
    /** Cuándo se importó el archivo BC3 (nulo si es manual). */
    importedAt: timestamp('imported_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('budgets_project_status_idx').on(t.projectId, t.status)],
);

/**
 * Partidas del presupuesto. Admite árbol BC3 completo (capítulos, subcapítulos
 * y partidas) usando `level` y `parent_code`. Las partidas hoja (level 3+)
 * tienen `unit_price` y `quantity`; los nodos intermedios (capítulos) acumulan
 * `total_amount` para facilitar los informes.
 */
export const budgetItems = pgTable(
  'budget_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Versión optimista: +1 en cada mutación; el cliente la devuelve en If-Match. */
    version: integer('version').notNull().default(1),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    /** Código BC3 (ej. "01.01.003") o código manual. */
    code: text('code').notNull(),
    /** Descripción de la partida / capítulo. */
    name: text('name').notNull(),
    /** Unidad de medida (m², m³, ud, h, kg…). Vacío en capítulos. */
    unit: text('unit').notNull().default(''),
    /** Precio unitario. 0 en nodos capítulo. */
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    /** Medición (cantidad). 0 en nodos capítulo. */
    quantity: numeric('quantity', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    /** Importe total = unit_price × quantity (precalculado). */
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** FK a `project_phases`; permite enlazar partida BC3 con la fase de la obra. */
    phaseId: uuid('phase_id').references(() => projectPhases.id, {
      onDelete: 'set null',
    }),
    /** Nivel en árbol BC3: 1=capítulo, 2=subcapítulo, 3=partida, 4+=subpartida. */
    level: integer('level').notNull().default(3),
    /** Código del nodo padre (null en capítulos raíz). */
    parentCode: text('parent_code'),
    /** Orden de aparición dentro del padre. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('budget_items_phase_id_idx').on(t.phaseId),
    // Desglose del presupuesto: filtra por presupuesto y ordena por nivel y
    // orden; el índice sirve ambas cosas sin ordenar en memoria.
    index('budget_items_budget_level_order_idx').on(
      t.budgetId,
      t.level,
      t.sortOrder,
    ),
    // Código único dentro de un presupuesto
    unique().on(t.budgetId, t.code),
  ],
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type BudgetItem = typeof budgetItems.$inferSelect;
export type NewBudgetItem = typeof budgetItems.$inferInsert;

/**
 * Líneas de certificación: descomposición de una certificación por partida
 * de presupuesto. Permite certificar a origen partida a partida en lugar de
 * por porcentaje global de la obra.
 *
 * El `cumulativePct` de la cabecera (`certifications`) sigue siendo el %
 * global de referencia; las líneas son el detalle de ese avance.
 */
export const certificationLines = pgTable(
  'certification_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Versión optimista: +1 en cada mutación; el cliente la devuelve en If-Match. */
    version: integer('version').notNull().default(1),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'cascade' }),
    budgetItemId: uuid('budget_item_id')
      .notNull()
      .references(() => budgetItems.id, { onDelete: 'restrict' }),
    /** % ejecutado acumulado a origen de esta partida. */
    cumulativePct: numeric('cumulative_pct', {
      precision: 5,
      scale: 2,
    }).notNull(),
    /** Importe acumulado (partida.total_amount × cumulative_pct / 100). */
    cumulativeAmount: numeric('cumulative_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** Importe del periodo = acumulado_actual - acumulado_anterior. */
    periodAmount: numeric('period_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('certification_lines_budget_item_id_idx').on(t.budgetItemId),
    // Una partida aparece solo una vez por certificación
    unique().on(t.certificationId, t.budgetItemId),
  ],
);

export type CertificationLine = typeof certificationLines.$inferSelect;
export type NewCertificationLine = typeof certificationLines.$inferInsert;

// ─── Auditoría ────────────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'export'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * **Particionada por mes desde la Fase 16** (`occurred_at`, particionado
 * declarativo nativo — no modelado aquí porque Drizzle no puede expresar
 * `PARTITION BY`/particiones hijas: vive solo en la migración
 * `0027_audit_log_partition.sql`, igual que los índices GIN de trigramas de
 * la Fase 15. La PK real en base de datos es compuesta `(id, occurred_at)`
 * — Postgres exige que la clave de partición forme parte de la PK — aunque
 * aquí siga declarada solo sobre `id` (no afecta a cómo `AuditService` usa
 * la tabla: nunca hace `WHERE id = …`, y nada más del esquema referencia
 * `audit_log.id` por FK). Altas de partición futuras: cron propio
 * `AuditPartitionService` (`apps/api/src/audit/`) — sin `pg_partman`, no
 * disponible en este entorno.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Timestamp del evento (con zona horaria). Las filas nuevas llevan precisión de milisegundos. */
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Usuario que realizó la acción (null si fue el sistema). Sin FK: una FK
     * `ON DELETE SET NULL` haría un UPDATE sobre una tabla inmutable.
     */
    userId: uuid('user_id'),
    /** Sin `ON DELETE CASCADE`: borrar una empresa con auditoría debe fallar. */
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Tipo de entidad: 'certification', 'invoice', 'project', etc. */
    entityType: varchar('entity_type', { length: 60 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 10 }).notNull(),
    /** Snapshot anterior (null en create). */
    oldData: jsonb('old_data'),
    /** Snapshot nuevo (null en delete). */
    newData: jsonb('new_data'),
    /** IP o agente adicional (opcional). */
    meta: jsonb('meta'),
    /** 1, 2, 3… por empresa, sin huecos (cadena hash). */
    sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
    /** `entry_hash` de la fila anterior; génesis = 64 ceros. Nulo solo en filas históricas sin sellar. */
    previousHash: char('previous_hash', { length: 64 }),
    /** SHA-256 hex de la preimagen canónica (ver `@erp/shared` audit-hash). */
    entryHash: char('entry_hash', { length: 64 }),
    hashVersion: smallint('hash_version'),
    /** `X-Request-Id` de la petición que originó la entrada (entra en el hash). */
    correlationId: varchar('correlation_id', { length: 64 }),
  },
  (t) => [
    uniqueIndex('audit_log_company_seq_unique').on(
      t.companyId,
      t.sequenceNumber,
      t.occurredAt,
    ),
    index('audit_log_company_correlation_idx')
      .on(t.companyId, t.correlationId)
      .where(sql`${t.correlationId} IS NOT NULL`),
  ],
);

/**
 * Cabecera de la cadena hash: una fila por empresa. Su bloqueo de fila
 * (`FOR UPDATE`) serializa las escrituras de auditoría de la empresa y es la
 * garantía de unicidad de `(company_id, sequence_number)` (un UNIQUE en una
 * tabla particionada debe incluir la clave de partición). Solo la tocan los
 * triggers de `audit_log`. `last_entry_hash` nulo = filas históricas sin sellar.
 */
export const auditChainHeads = pgTable(
  'audit_chain_heads',
  {
    companyId: uuid('company_id')
      .primaryKey()
      .references(() => companies.id),
    lastSequenceNumber: bigint('last_sequence_number', { mode: 'number' })
      .notNull()
      .default(0),
    lastEntryHash: char('last_entry_hash', { length: 64 }).default(
      '0000000000000000000000000000000000000000000000000000000000000000',
    ),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('audit_chain_heads_seq_check', sql`${t.lastSequenceNumber} >= 0`),
    check(
      'audit_chain_heads_hash_check',
      sql`${t.lastEntryHash} IS NULL OR ${t.lastEntryHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/**
 * Anclas diarias de la cadena de auditoría: una fila por (empresa, día UTC)
 * con el último `sequence_number`/`entry_hash` de la empresa a ese cierre.
 * Inmutable (triggers en la migración 0042). Viven en la misma base de datos:
 * detectan reescrituras parciales de la cadena, no de un propietario con DDL
 * que reescriba cadena y anclas; el anclaje externo queda fuera de alcance.
 */
export const auditAnchors = pgTable(
  'audit_anchors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    anchorDate: date('anchor_date').notNull(),
    sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
    entryHash: char('entry_hash', { length: 64 }).notNull(),
    /** HMAC-SHA256 hex del ancla (`AUDIT_ANCHOR_KEY`); null si no había clave. */
    firma: char('firma', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'audit_anchors_firma_check',
      sql`${t.firma} IS NULL OR ${t.firma} ~ '^[0-9a-f]{64}$'`,
    ),
    unique('audit_anchors_company_date_unique').on(t.companyId, t.anchorDate),
    check('audit_anchors_seq_check', sql`${t.sequenceNumber} >= 1`),
    check('audit_anchors_hash_check', sql`${t.entryHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
export type AuditAnchor = typeof auditAnchors.$inferSelect;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

// ─── Comparativos de ofertas y adjudicación de subcontratas (Fase 10) ─────
/**
 * Un comparativo cubre una fase/capítulo de obra (`phaseId`): la matriz de
 * precios es "una fila por partida de esa fase, una columna por oferta de
 * proveedor" — cada partida es una fila de `budgetItems` con ese `phaseId`,
 * cada oferta es una fila de `comparativoOfertas` con sus líneas de precio
 * en `comparativoOfertaLineas`.
 *
 * La oferta adjudicada no se guarda como FK en `comparativos` (evitaría una
 * dependencia circular comparativos↔comparativoOfertas, incómoda de
 * migrar): se marca `isAwarded` en la propia oferta, con un índice único
 * parcial que garantiza que nunca hay dos ofertas adjudicadas a la vez
 * para el mismo comparativo.
 */
export const comparativoStatusEnum = pgEnum('comparativo_status', [
  'abierto',
  'adjudicado',
  'cancelado',
]);

export const comparativos = pgTable(
  'comparativos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    /** Fase/capítulo que se está comparando — fija qué partidas entran en la matriz. */
    phaseId: uuid('phase_id')
      .notNull()
      .references(() => projectPhases.id),
    title: text('title').notNull(),
    status: comparativoStatusEnum('status').notNull().default('abierto'),
    awardedAt: timestamp('awarded_at', { withTimezone: true }),
    /** Pedido/subcontrata borrador generado al adjudicar (ver `adjudicar()`). */
    purchaseOrderId: uuid('purchase_order_id').references(
      () => purchaseOrders.id,
    ),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('comparativos_project_phase_idx').on(t.projectId, t.phaseId)],
);

/** Oferta de un proveedor/subcontrata para un comparativo. */
export const comparativoOfertas = pgTable(
  'comparativo_ofertas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    comparativoId: uuid('comparativo_id')
      .notNull()
      .references(() => comparativos.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    /** Plazo de ejecución ofertado, en días. */
    leadTimeDays: integer('lead_time_days'),
    /** Condiciones de pago ofertadas (texto libre: "30 días fin de mes",...). */
    paymentTerms: text('payment_terms'),
    isAwarded: boolean('is_awarded').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Un proveedor no puede pujar dos veces en el mismo comparativo
    unique('comparativo_ofertas_comparativo_contact_unique').on(
      t.comparativoId,
      t.contactId,
    ),
    // Como mucho una oferta adjudicada por comparativo, a nivel de base de datos
    uniqueIndex('comparativo_ofertas_awarded_unique')
      .on(t.comparativoId)
      .where(sql`is_awarded = true`),
  ],
);

/** Precio unitario ofertado por una oferta para una partida concreta de la fase. */
export const comparativoOfertaLineas = pgTable(
  'comparativo_oferta_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ofertaId: uuid('oferta_id')
      .notNull()
      .references(() => comparativoOfertas.id, { onDelete: 'cascade' }),
    budgetItemId: uuid('budget_item_id')
      .notNull()
      .references(() => budgetItems.id, { onDelete: 'restrict' }),
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
    /** Medición ofertada; normalmente la de `budget_items`, pero el proveedor puede remedir. */
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    /** Precalculado: unit_price × quantity. */
    totalAmount: numeric('total_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
  },
  (t) => [
    unique('comparativo_oferta_lineas_oferta_item_unique').on(
      t.ofertaId,
      t.budgetItemId,
    ),
  ],
);

export type Comparativo = typeof comparativos.$inferSelect;
export type NewComparativo = typeof comparativos.$inferInsert;
export type ComparativoOferta = typeof comparativoOfertas.$inferSelect;
export type NewComparativoOferta = typeof comparativoOfertas.$inferInsert;
export type ComparativoOfertaLinea =
  typeof comparativoOfertaLineas.$inferSelect;
export type NewComparativoOfertaLinea =
  typeof comparativoOfertaLineas.$inferInsert;

// ─── Partes de trabajo diario: personal y maquinaria (Fase 10) ────────────
/**
 * Imputación diaria de coste real, la pieza que le falta al "Coste Real
 * Imputado" del control de desviaciones: hasta ahora solo se contaba lo
 * que llegaba por factura de compra, que en construcción siempre va por
 * detrás del gasto real (el operario trabaja hoy, la factura del
 * subcontratista llega a fin de mes). Ambas tablas llevan `approvedBy`/
 * `approvedAt` como aprobación simple de un encargado — no hay firma
 * digital ni biométrica, solo qué usuario aprobó y cuándo.
 */

export const parteMaquinariaOwnershipEnum = pgEnum(
  'parte_maquinaria_ownership',
  ['propia', 'alquilada'],
);

/** Parte de personal: horas ordinarias/extra de un operario, imputadas a obra y partida. */
export const partesPersonal = pgTable(
  'partes_personal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    /** Partida de imputación; nulo = coste general de obra sin partida concreta. */
    phaseId: uuid('phase_id').references(() => projectPhases.id, {
      onDelete: 'set null',
    }),
    /** Texto libre histórico; desde el maestro de trabajadores el alta nueva debería enlazar `trabajadorId`. */
    workerName: text('worker_name').notNull(),
    /** Ficha del maestro de trabajadores; nulo en partes históricos o sin ficha dada de alta. */
    trabajadorId: uuid('trabajador_id').references(() => trabajadores.id, {
      onDelete: 'set null',
    }),
    categoryId: uuid('category_id').references(() => categories.id),
    workDate: date('work_date').notNull(),
    ordinaryHours: numeric('ordinary_hours', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    overtimeHours: numeric('overtime_hours', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    /** Coste €/hora de la empresa por ese operario, no su nómina bruta. */
    ordinaryRate: numeric('ordinary_rate', {
      precision: 10,
      scale: 2,
    }).notNull(),
    overtimeRate: numeric('overtime_rate', {
      precision: 10,
      scale: 2,
    }).notNull(),
    /** Precalculado: ordinary_hours×ordinary_rate + overtime_hours×overtime_rate. */
    totalCost: numeric('total_cost', { precision: 14, scale: 2 }).notNull(),
    notes: text('notes'),
    approvedBy: uuid('approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('partes_personal_project_date_idx').on(t.projectId, t.workDate),
  ],
);

/** Parte de maquinaria: horas de uso, combustible y coste, propia o alquilada. */
export const partesMaquinaria = pgTable(
  'partes_maquinaria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    phaseId: uuid('phase_id').references(() => projectPhases.id, {
      onDelete: 'set null',
    }),
    /**
     * Texto libre histórico (Fase 10): se mantiene por compatibilidad con
     * partes ya creados. Desde Fase 13 el alta nueva debería enlazar
     * `equipoId` al maestro; `machineName` sigue mostrándose si no hay ficha.
     */
    machineName: text('machine_name').notNull(),
    /** Ficha del maestro de equipos (Fase 13); nulo en partes históricos o sin ficha dada de alta. */
    equipoId: uuid('equipo_id').references(() => equipos.id, {
      onDelete: 'set null',
    }),
    ownership: parteMaquinariaOwnershipEnum('ownership')
      .notNull()
      .default('propia'),
    workDate: date('work_date').notNull(),
    hoursUsed: numeric('hours_used', { precision: 6, scale: 2 })
      .notNull()
      .default('0'),
    fuelLiters: numeric('fuel_liters', { precision: 8, scale: 2 }),
    /** Coste €/hora — amortización+mantenimiento si es propia, tarifa si es alquilada. */
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }).notNull(),
    /** Precalculado: hours_used × hourly_rate (el combustible se anota, no se sobreprecia aparte). */
    totalCost: numeric('total_cost', { precision: 14, scale: 2 }).notNull(),
    notes: text('notes'),
    approvedBy: uuid('approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('partes_maquinaria_project_date_idx').on(t.projectId, t.workDate),
  ],
);

export type PartePersonal = typeof partesPersonal.$inferSelect;
export type NewPartePersonal = typeof partesPersonal.$inferInsert;
export type ParteMaquinaria = typeof partesMaquinaria.$inferSelect;
export type NewParteMaquinaria = typeof partesMaquinaria.$inferInsert;

// ─── Maquinaria y equipos: maestro y mantenimientos (Fase 13) ─────────────
/**
 * Maestro de equipos que faltaba desde Fase 10: `partes_maquinaria` solo
 * anotaba el nombre/matrícula en texto libre porque no había ficha de la
 * máquina. Este maestro permite dar de alta cada equipo una vez (propio o
 * alquilado, con su proveedor de alquiler si aplica) y enlazar tanto los
 * partes de uso diario (`partes_maquinaria.equipo_id`) como el histórico de
 * mantenimientos a esa ficha. Las referencias a `proveedores` (Fase 11) se
 * resuelven por closure: el orden de declaración en este archivo no importa.
 */

export const equipoTipoEnum = pgEnum('equipo_tipo', [
  'vehiculo',
  'maquina_pesada',
  'herramienta',
  'otro',
]);

export const equipoEstadoEnum = pgEnum('equipo_estado', [
  'operativo',
  'en_mantenimiento',
  'averiado',
  'baja',
]);

export const equipos = pgTable('equipos', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  nombre: text('nombre').notNull(),
  /** Matrícula o nº de serie; libre porque no toda herramienta la tiene. */
  matricula: text('matricula'),
  tipo: equipoTipoEnum('tipo').notNull().default('maquina_pesada'),
  ownership: parteMaquinariaOwnershipEnum('ownership')
    .notNull()
    .default('propia'),
  /** Proveedor de alquiler; solo tiene sentido si ownership = 'alquilada'. */
  proveedorAlquilerId: uuid('proveedor_alquiler_id').references(
    () => proveedores.id,
    { onDelete: 'set null' },
  ),
  estado: equipoEstadoEnum('estado').notNull().default('operativo'),
  fechaAlta: date('fecha_alta'),
  /** Fecha de baja definitiva; distinto de `deletedAt`, que es borrado lógico del registro. */
  fechaBaja: date('fecha_baja'),
  notas: text('notas'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const mantenimientoTipoEnum = pgEnum('mantenimiento_tipo', [
  'preventivo',
  'correctivo',
  'itv',
]);

/** Un evento de mantenimiento (o ITV) de un equipo del maestro. */
export const mantenimientosEquipo = pgTable('mantenimientos_equipo', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  equipoId: uuid('equipo_id')
    .notNull()
    .references(() => equipos.id),
  tipo: mantenimientoTipoEnum('tipo').notNull().default('preventivo'),
  fecha: date('fecha').notNull(),
  proveedorId: uuid('proveedor_id').references(() => proveedores.id, {
    onDelete: 'set null',
  }),
  coste: numeric('coste', { precision: 12, scale: 2 }),
  /** Próxima revisión prevista (preventivo/ITV); nulo en correctivos puntuales. */
  proximaRevisionFecha: date('proxima_revision_fecha'),
  descripcion: text('descripcion'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Equipo = typeof equipos.$inferSelect;
export type NewEquipo = typeof equipos.$inferInsert;
export type MantenimientoEquipo = typeof mantenimientosEquipo.$inferSelect;
export type NewMantenimientoEquipo = typeof mantenimientosEquipo.$inferInsert;

/**
 * Maestro de trabajadores: mismo hueco que `equipos` cerró para maquinaria,
 * ahora para personas — `partes_personal.worker_name` era texto libre
 * porque no había ficha del operario. Referencia a `proveedores` resuelta
 * por closure, igual que en `equipos` (el orden de declaración no importa).
 */
export const trabajadorTipoEnum = pgEnum('trabajador_tipo', [
  'propio',
  'subcontratado',
]);

export const trabajadores = pgTable('trabajadores', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  nombre: text('nombre').notNull(),
  /** DNI/NIE; libre porque a veces se da de alta sin él (alta urgente en obra). */
  documentoIdentidad: text('documento_identidad'),
  categoryId: uuid('category_id').references(() => categories.id),
  tipo: trabajadorTipoEnum('tipo').notNull().default('propio'),
  /** Subcontrata a la que pertenece; solo tiene sentido con tipo = 'subcontratado'. */
  proveedorId: uuid('proveedor_id').references(() => proveedores.id, {
    onDelete: 'set null',
  }),
  /** Tarifas habituales para prellenar el alta de un parte; el parte puede pisarlas. */
  ordinaryRateDefault: numeric('ordinary_rate_default', {
    precision: 10,
    scale: 2,
  }),
  overtimeRateDefault: numeric('overtime_rate_default', {
    precision: 10,
    scale: 2,
  }),
  activo: boolean('activo').notNull().default(true),
  fechaAlta: date('fecha_alta'),
  fechaBaja: date('fecha_baja'),
  notas: text('notas'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Trabajador = typeof trabajadores.$inferSelect;
export type NewTrabajador = typeof trabajadores.$inferInsert;

// ─── Proveedores y subcontratas: ficha extendida (Fase 11) ────────────────
/**
 * Ficha extendida de proveedor/subcontrata, complementaria a `contacts`
 * (que sigue siendo el maestro unificado proveedor/cliente usado por
 * facturas y pedidos). Esta tabla añade los datos específicos de
 * homologación de origen/ejecución que pide compras internacional
 * (país de origen, país de ejecución, país de origen de materiales) y no
 * tienen sitio natural en `contacts`. `contactId` es opcional: permite dar
 * de alta la ficha antes de tener el contacto de facturación enlazado.
 */
export const proveedorTipoEnum = pgEnum('proveedor_tipo', [
  'proveedor',
  'subcontrata',
]);

export const proveedores = pgTable(
  'proveedores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    razonSocial: text('razon_social').notNull(),
    /** CIF/NIF del proveedor (obligatorio y único por empresa) */
    cifNif: text('cif_nif').notNull(),
    tipo: proveedorTipoEnum('tipo').notNull().default('proveedor'),
    categoriaPrincipal: text('categoria_principal'),
    pais: text('pais').notNull().default('ES'),
    paisEjecucion: text('pais_ejecucion').notNull().default('ES'),
    paisOrigenMateriales: text('pais_origen_materiales'),
    codigoExterno: text('codigo_externo'),
    sedeCentral: text('sede_central'),
    contactoComercial: text('contacto_comercial'),
    telefonoContacto: text('telefono_contacto'),
    emailContacto: text('email_contacto'),
    condicionesPagoDias: integer('condiciones_pago_dias').notNull().default(30),
    retencionGarantiaPct: numeric('retencion_garantia_pct', {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default('5.00'),
    activo: boolean('activo').notNull().default(true),
    notas: text('notas'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('proveedores_company_cif_nif_unique')
      .on(t.companyId, t.cifNif)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const contratoSubcontrataStatusEnum = pgEnum(
  'contrato_subcontrata_status',
  ['borrador', 'activo', 'completado', 'cancelado'],
);

/** Contratos de subcontrata con una obra determinada. */
export const contratosSubcontrata = pgTable(
  'contratos_subcontrata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    proveedorId: uuid('proveedor_id')
      .notNull()
      .references(() => proveedores.id),
    proyectoId: uuid('proyecto_id')
      .notNull()
      .references(() => projects.id),
    numeroContrato: text('numero_contrato').notNull(),
    fechaInicio: date('fecha_inicio').notNull(),
    fechaFinPrevista: date('fecha_fin_prevista').notNull(),
    fechaFinReal: date('fecha_fin_real'),
    importeTotal: numeric('importe_total', {
      precision: 14,
      scale: 2,
    }).notNull(),
    importeEjecutado: numeric('importe_ejecutado', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    pctEjecutado: numeric('pct_ejecutado', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    retencionGarantiaPct: numeric('retencion_garantia_pct', {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default('5.00'),
    status: contratoSubcontrataStatusEnum('status')
      .notNull()
      .default('borrador'),
    condicionesEspeciales: text('condiciones_especiales'),
    firmaFecha: date('firma_fecha'),
    notas: text('notas'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('contratos_subcontrata_company_numero_unique')
      .on(t.companyId, t.numeroContrato)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const documentoPRLTypeEnum = pgEnum('documento_prl_type', [
  'plan_seguridad',
  'seguro_rc',
  'certificado_ss',
  'itinerario_formativo',
  'epi',
  'otro',
]);

export const documentoPRLStatusEnum = pgEnum('documento_prl_status', [
  'vigente',
  'proximo_vencimiento',
  'vencido',
  'rechazado',
]);

/** Documentos de PRL (Prevención de Riesgos Laborales) por proveedor/subcontrata. */
export const documentosPRL = pgTable(
  'documentos_prl',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    proveedorId: uuid('proveedor_id')
      .notNull()
      .references(() => proveedores.id),
    docType: documentoPRLTypeEnum('doc_type').notNull(),
    numeroExpediente: text('numero_expediente').notNull(),
    fechaEmision: date('fecha_emision').notNull(),
    fechaVencimiento: date('fecha_vencimiento').notNull(),
    status: documentoPRLStatusEnum('status').notNull().default('vigente'),
    /** Archivo asociado (opcional): reaprovecha el módulo documental. */
    documentId: uuid('document_id').references(() => documents.id),
    notas: text('notas'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('documentos_prl_proveedor_numero_unique')
      .on(t.proveedorId, t.numeroExpediente)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type Proveedor = typeof proveedores.$inferSelect;
export type NewProveedor = typeof proveedores.$inferInsert;
export type ContratoSubcontrata = typeof contratosSubcontrata.$inferSelect;
export type NewContratoSubcontrata = typeof contratosSubcontrata.$inferInsert;
export type DocumentoPRL = typeof documentosPRL.$inferSelect;
export type NewDocumentoPRL = typeof documentosPRL.$inferInsert;

/**
 * Certificaciones de subcontrata (lado de coste de la producción): lo que la
 * constructora debe a un subcontratista por lo ejecutado contra su contrato.
 * Se certifica a origen; periodo, retención y líquido se calculan en
 * `computeCertSubcontrata` (`@erp/shared`) y se guardan para auditoría.
 * Los CHECK repiten la aritmética en la base: una fila descuadrada no entra
 * ni por una vía que se salte la API.
 */
export const certSubcontrataStatusEnum = pgEnum('cert_subcontrata_status', [
  'borrador',
  'aprobada',
  'pagada',
  'anulada',
]);

export const certificacionesSubcontrata = pgTable(
  'certificaciones_subcontrata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    contratoId: uuid('contrato_id')
      .notNull()
      .references(() => contratosSubcontrata.id, { onDelete: 'restrict' }),
    /** Correlativo dentro del contrato (1, 2, 3…). */
    numero: integer('numero').notNull(),
    fecha: date('fecha').notNull(),
    periodoDesde: date('periodo_desde').notNull(),
    periodoHasta: date('periodo_hasta').notNull(),
    importeOrigen: numeric('importe_origen', {
      precision: 14,
      scale: 2,
    }).notNull(),
    importeAnterior: numeric('importe_anterior', {
      precision: 14,
      scale: 2,
    }).notNull(),
    importePeriodo: numeric('importe_periodo', {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** % de garantía del contrato en el momento de certificar. */
    retencionPct: numeric('retencion_pct', {
      precision: 5,
      scale: 2,
    }).notNull(),
    retencionImporte: numeric('retencion_importe', {
      precision: 14,
      scale: 2,
    }).notNull(),
    importeLiquido: numeric('importe_liquido', {
      precision: 14,
      scale: 2,
    }).notNull(),
    status: certSubcontrataStatusEnum('status').notNull().default('borrador'),
    aprobadaAt: timestamp('aprobada_at', { withTimezone: true }),
    fechaPago: date('fecha_pago'),
    anuladaAt: timestamp('anulada_at', { withTimezone: true }),
    motivoAnulacion: text('motivo_anulacion'),
    notas: text('notas'),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('cert_subcontrata_contrato_numero_unique')
      .on(t.contratoId, t.numero)
      .where(sql`deleted_at IS NULL`),
    /** Como mucho un borrador vivo por contrato. */
    uniqueIndex('cert_subcontrata_un_borrador_unique')
      .on(t.contratoId)
      .where(sql`status = 'borrador' AND deleted_at IS NULL`),
    index('cert_subcontrata_company_contrato_idx').on(
      t.companyId,
      t.contratoId,
      t.numero,
    ),
    check('cert_subcontrata_numero_check', sql`${t.numero} >= 1`),
    check(
      'cert_subcontrata_periodo_check',
      sql`${t.periodoDesde} <= ${t.periodoHasta}`,
    ),
    check(
      'cert_subcontrata_importes_check',
      sql`${t.importeOrigen} >= 0 AND ${t.importeAnterior} >= 0 AND ${t.importePeriodo} > 0 AND ${t.importePeriodo} = ${t.importeOrigen} - ${t.importeAnterior}`,
    ),
    check(
      'cert_subcontrata_retencion_check',
      sql`${t.retencionPct} BETWEEN 0 AND 50 AND ${t.retencionImporte} >= 0 AND ${t.importeLiquido} = ${t.importePeriodo} - ${t.retencionImporte}`,
    ),
    check(
      'cert_subcontrata_estado_check',
      // Una anulada conserva su `aprobada_at` si llegó a aprobarse (trazabilidad).
      sql`(${t.status} NOT IN ('aprobada', 'pagada') OR ${t.aprobadaAt} IS NOT NULL) AND (${t.status} <> 'borrador' OR ${t.aprobadaAt} IS NULL) AND (${t.status} = 'pagada') = (${t.fechaPago} IS NOT NULL) AND (${t.status} = 'anulada') = (${t.anuladaAt} IS NOT NULL AND ${t.motivoAnulacion} IS NOT NULL)`,
    ),
    check('cert_subcontrata_version_check', sql`${t.version} >= 1`),
  ],
);

export type CertificacionSubcontrata =
  typeof certificacionesSubcontrata.$inferSelect;
export type NewCertificacionSubcontrata =
  typeof certificacionesSubcontrata.$inferInsert;

/**
 * Devoluciones de la retención de garantía al subcontratista. Solo inserción:
 * una devolución errónea se compensa, no se edita (queda en auditoría).
 */
export const devolucionesGarantiaSubcontrata = pgTable(
  'devoluciones_garantia_subcontrata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    contratoId: uuid('contrato_id')
      .notNull()
      .references(() => contratosSubcontrata.id, { onDelete: 'restrict' }),
    fecha: date('fecha').notNull(),
    importe: numeric('importe', { precision: 14, scale: 2 }).notNull(),
    motivo: text('motivo').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('devoluciones_garantia_company_contrato_idx').on(
      t.companyId,
      t.contratoId,
    ),
    check('devoluciones_garantia_importe_check', sql`${t.importe} > 0`),
  ],
);

export type DevolucionGarantiaSubcontrata =
  typeof devolucionesGarantiaSubcontrata.$inferSelect;

// ─── Permisos públicos y licencias (Fase 12) ───────────────────────────────
/**
 * Trámites municipales/administrativos de una obra: licencia de obra, vado,
 * ocupación de vía pública, gestión de residuos. Cada uno tiene su propio
 * ciclo de vida (solicitado → en_tramite → concedido/denegado) y, salvo la
 * licencia de obra, suele caducar y requerir renovación — de ahí
 * `fechaVencimiento` y el servicio de alertas previas a la caducidad.
 */
export const permisoTipoEnum = pgEnum('permiso_tipo', [
  'licencia_obra',
  'vado',
  'ocupacion_via_publica',
  'gestion_residuos',
]);

export const permisoStatusEnum = pgEnum('permiso_status', [
  'solicitado',
  'en_tramite',
  'concedido',
  'denegado',
]);

export const permisosPublicos = pgTable('permisos_publicos', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  tipo: permisoTipoEnum('tipo').notNull(),
  organismoPublico: text('organismo_publico').notNull(),
  numeroExpediente: text('numero_expediente'),
  fechaSolicitud: date('fecha_solicitud').notNull(),
  /** Fecha en la que el organismo resolvió (concedió o denegó). */
  fechaResolucion: date('fecha_resolucion'),
  /** Nula en trámites que no caducan (p. ej. una licencia de obra ya cerrada). */
  fechaVencimiento: date('fecha_vencimiento'),
  status: permisoStatusEnum('status').notNull().default('solicitado'),
  canonImporte: numeric('canon_importe', { precision: 12, scale: 2 }),
  /** Documento adjunto (resolución, justificante de tasa…), opcional. */
  documentId: uuid('document_id').references(() => documents.id),
  notas: text('notas'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PermisoPublico = typeof permisosPublicos.$inferSelect;
export type NewPermisoPublico = typeof permisosPublicos.$inferInsert;

// ─── Contratación y gestión documental de obra (Fase 12) ───────────────────
/**
 * Contratos con subcontratistas, proveedores y clientes ligados a una obra
 * concreta (distintos de `contratos_subcontrata`, que es la ficha de
 * ejecución/certificación de la subcontrata en `proveedores`; este es el
 * documento legal firmado con su PDF adjunto y sus cláusulas). El PDF se
 * reaprovecha del módulo documental (`documents`, con dedupe por hash).
 */
export const contratoObraTipoEnum = pgEnum('contrato_obra_tipo', [
  'subcontrata',
  'suministro',
  'cliente',
  'alquiler',
  'servicios',
  'otro',
]);

export const contratoObraEstadoFirmaEnum = pgEnum(
  'contrato_obra_estado_firma',
  ['borrador', 'pendiente_firma', 'firmado', 'rescindido'],
);

export const contratosObra = pgTable('contratos_obra', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  /** Subcontratista, proveedor o cliente — reaprovecha el maestro unificado. */
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id),
  tipo: contratoObraTipoEnum('tipo').notNull(),
  importe: numeric('importe', { precision: 14, scale: 2 }).notNull(),
  fechaFirma: date('fecha_firma'),
  /** PDF firmado u otro anexo técnico principal del contrato. */
  documentId: uuid('document_id').references(() => documents.id),
  estadoFirma: contratoObraEstadoFirmaEnum('estado_firma')
    .notNull()
    .default('borrador'),
  retencionPct: numeric('retencion_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('5.00'),
  /** Cláusulas de abonos/pagos a cuenta, en texto libre (no estructurado). */
  condicionesAbono: text('condiciones_abono'),
  notas: text('notas'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ContratoObra = typeof contratosObra.$inferSelect;
export type NewContratoObra = typeof contratosObra.$inferInsert;

/** Anexo técnico adicional de un contrato (además del PDF principal). */
export const contratoObraAnexos = pgTable('contrato_obra_anexos', {
  id: uuid('id').primaryKey().defaultRandom(),
  contratoId: uuid('contrato_id')
    .notNull()
    .references(() => contratosObra.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  descripcion: text('descripcion').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ContratoObraAnexo = typeof contratoObraAnexos.$inferSelect;
export type NewContratoObraAnexo = typeof contratoObraAnexos.$inferInsert;

// ─── Actas de recepción (Fase 12) ───────────────────────────────────────────
/**
 * Recepción provisional/definitiva de la obra, con su lista de repasos
 * (defectos pendientes de subsanar antes de poder firmar sin reservas).
 */
export const actaRecepcionTipoEnum = pgEnum('acta_recepcion_tipo', [
  'provisional',
  'definitiva',
]);

export const actaRecepcionEstadoEnum = pgEnum('acta_recepcion_estado', [
  'pendiente_firma',
  'firmada_sin_reservas',
  'firmada_con_reservas',
]);

export const actasRecepcion = pgTable('actas_recepcion', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  tipo: actaRecepcionTipoEnum('tipo').notNull(),
  fecha: date('fecha').notNull(),
  estado: actaRecepcionEstadoEnum('estado')
    .notNull()
    .default('pendiente_firma'),
  /** Acta firmada escaneada, opcional. */
  documentId: uuid('document_id').references(() => documents.id),
  notas: text('notas'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActaRecepcion = typeof actasRecepcion.$inferSelect;
export type NewActaRecepcion = typeof actasRecepcion.$inferInsert;

export const repasoEstadoEnum = pgEnum('repaso_estado', [
  'pendiente',
  'subsanado',
]);

/** Ítem de la lista de repasos de un acta: un defecto a subsanar. */
export const actaRecepcionRepasos = pgTable('acta_recepcion_repasos', {
  id: uuid('id').primaryKey().defaultRandom(),
  actaId: uuid('acta_id')
    .notNull()
    .references(() => actasRecepcion.id, { onDelete: 'cascade' }),
  descripcion: text('descripcion').notNull(),
  responsable: text('responsable'),
  fechaLimite: date('fecha_limite'),
  estado: repasoEstadoEnum('estado').notNull().default('pendiente'),
  fechaSubsanacion: date('fecha_subsanacion'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActaRecepcionRepaso = typeof actaRecepcionRepasos.$inferSelect;
export type NewActaRecepcionRepaso = typeof actaRecepcionRepasos.$inferInsert;

// ─── Incidencias y control de seguridad PRL (Fase 12) ───────────────────────
/**
 * Puntos de inspección de seguridad en obra: alta rápida de una incidencia
 * (andamios, acopios, EPIs…), con seguimiento de su subsanación. Distinto de
 * `contact_compliance_docs` (documentación PRL de la subcontrata): esto es
 * seguridad física en el tajo, no papeleo.
 */
export const incidenciaPRLGravedadEnum = pgEnum('incidencia_prl_gravedad', [
  'leve',
  'grave',
  'muy_grave',
]);

export const incidenciaPRLEstadoEnum = pgEnum('incidencia_prl_estado', [
  'abierta',
  'en_subsanacion',
  'cerrada',
]);

export const incidenciasPRL = pgTable('incidencias_prl', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  fecha: date('fecha').notNull(),
  /** Punto de inspección: "Andamios planta 3", "Acopio de residuos"… */
  puntoInspeccion: text('punto_inspeccion').notNull(),
  descripcion: text('descripcion').notNull(),
  gravedad: incidenciaPRLGravedadEnum('gravedad').notNull().default('leve'),
  estado: incidenciaPRLEstadoEnum('estado').notNull().default('abierta'),
  responsableSubsanacion: text('responsable_subsanacion'),
  fechaLimiteSubsanacion: date('fecha_limite_subsanacion'),
  fechaCierre: date('fecha_cierre'),
  /** Foto/evidencia adjunta, opcional. */
  documentId: uuid('document_id').references(() => documents.id),
  notas: text('notas'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type IncidenciaPRL = typeof incidenciasPRL.$inferSelect;
export type NewIncidenciaPRL = typeof incidenciasPRL.$inferInsert;

// ─── ESG, huella de carbono y sostenibilidad (Fase 14) ─────────────────────
/**
 * Cálculo de emisiones para informes de sostenibilidad (BREEAM/LEED):
 * catálogo de factores de emisión (kg CO2e por unidad de consumo) y los
 * registros de consumo real por obra que se multiplican por ese factor.
 * `emisionesKgCo2e` se guarda calculado (no vista) para no recalcular todo
 * el histórico si un factor cambia de valor más adelante.
 */
export const esgCategoriaEnum = pgEnum('esg_categoria', [
  'combustible',
  'energia',
  'agua',
  'material',
  'residuo',
]);

export const esgFactoresEmision = pgTable('esg_factores_emision', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  categoria: esgCategoriaEnum('categoria').notNull(),
  nombre: text('nombre').notNull(),
  /** Unidad de consumo del factor: 'litro', 'kWh', 'm3', 'kg', 'tonelada'… */
  unidad: text('unidad').notNull(),
  factorKgCo2e: numeric('factor_kg_co2e', {
    precision: 14,
    scale: 6,
  }).notNull(),
  /** Referencia de la tabla de factores usada, p.ej. "MITECO 2025". */
  fuente: text('fuente'),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EsgFactorEmision = typeof esgFactoresEmision.$inferSelect;
export type NewEsgFactorEmision = typeof esgFactoresEmision.$inferInsert;

export const esgRegistrosEmision = pgTable('esg_registros_emision', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  phaseId: uuid('phase_id').references(() => projectPhases.id),
  factorId: uuid('factor_id')
    .notNull()
    .references(() => esgFactoresEmision.id),
  fecha: date('fecha').notNull(),
  /** Cantidad consumida en la unidad del factor (litros, kWh, m³, kg…). */
  cantidad: numeric('cantidad', { precision: 14, scale: 4 }).notNull(),
  /** = cantidad × factor.factorKgCo2e en el momento del alta. */
  emisionesKgCo2e: numeric('emisiones_kg_co2e', {
    precision: 14,
    scale: 3,
  }).notNull(),
  /** Justificante opcional: factura de combustible, recibo de luz… */
  documentId: uuid('document_id').references(() => documents.id),
  notas: text('notas'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EsgRegistroEmision = typeof esgRegistrosEmision.$inferSelect;
export type NewEsgRegistroEmision = typeof esgRegistrosEmision.$inferInsert;

/**
 * Trazabilidad RCD (residuos de construcción y demolición) — obligación
 * legal española distinta del cálculo de huella de carbono de arriba: cada
 * salida de residuo de obra a un gestor autorizado se documenta con un
 * vale/albarán de entrega a planta, identificando el residuo por su código
 * LER (Lista Europea de Residuos) y si el destino es valorización o
 * eliminación — el ratio entre ambos es el KPI que piden BREEAM/LEED y la
 * normativa de RCD.
 */
export const rcdTreatmentEnum = pgEnum('rcd_treatment', [
  'valorizacion',
  'eliminacion',
]);

export const rcdVales = pgTable(
  'rcd_vales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    /** Código LER (p.ej. "17 01 01" hormigón, "17 04 05" hierro y acero). */
    lerCode: text('ler_code').notNull(),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    /** "tn" (toneladas) o "m3"; el gestor certifica en la unidad que pesa/mide. */
    unit: text('unit').notNull().default('tn'),
    treatment: rcdTreatmentEnum('treatment').notNull().default('valorizacion'),
    /** Gestor autorizado de residuos que recibe el vale — un `contact` más. */
    managerContactId: uuid('manager_contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    /** Número de vale/albarán tal como lo emite el gestor. */
    ticketNumber: text('ticket_number').notNull(),
    ticketDate: date('ticket_date').notNull(),
    /** Foto o PDF del vale escaneado, si se sube (reutiliza `documents`). */
    documentId: uuid('document_id').references(() => documents.id),
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
    unique('rcd_vales_manager_ticket_unique').on(
      t.managerContactId,
      t.ticketNumber,
    ),
  ],
);

export type RcdVale = typeof rcdVales.$inferSelect;
export type NewRcdVale = typeof rcdVales.$inferInsert;

// ─── Mantenimiento preventivo e IoT de flota (Fase 14) ─────────────────────
/**
 * Telemetría de maquinaria y alertas de avería, encima del maestro de
 * equipos de Fase 13 (`equipos` / `mantenimientos_equipo`): esto NO
 * duplica ficha ni histórico de mantenimiento, solo añade la ingesta de
 * lecturas del dispositivo IoT y las alertas que dispara (avería detectada
 * por código de error, anomalía de telemetría o mantenimiento vencido según
 * `equipos.proxima_revision_fecha` calculado por `EquiposService`).
 */
export const iotAlertaTipoEnum = pgEnum('iot_alerta_tipo', [
  'averia',
  'anomalia_telemetria',
  'mantenimiento_vencido',
]);

export const iotAlertaGravedadEnum = pgEnum('iot_alerta_gravedad', [
  'leve',
  'grave',
  'critica',
]);

export const iotAlertaEstadoEnum = pgEnum('iot_alerta_estado', [
  'abierta',
  'reconocida',
  'cerrada',
]);

export const iotLecturasTelemetria = pgTable('iot_lecturas_telemetria', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  equipoId: uuid('equipo_id')
    .notNull()
    .references(() => equipos.id),
  projectId: uuid('project_id').references(() => projects.id),
  capturadoEn: timestamp('capturado_en', { withTimezone: true }).notNull(),
  horasUso: numeric('horas_uso', { precision: 10, scale: 2 }),
  kmRecorridos: numeric('km_recorridos', { precision: 10, scale: 2 }),
  combustibleNivelPct: numeric('combustible_nivel_pct', {
    precision: 5,
    scale: 2,
  }),
  temperaturaMotor: numeric('temperatura_motor', {
    precision: 6,
    scale: 2,
  }),
  ubicacionLat: numeric('ubicacion_lat', { precision: 9, scale: 6 }),
  ubicacionLng: numeric('ubicacion_lng', { precision: 9, scale: 6 }),
  /** Código de avería reportado por el equipo (OBD/CAN u homólogo), si lo hay. */
  codigoError: text('codigo_error'),
  /** Payload crudo del dispositivo, para depurar sin perder datos del fabricante. */
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type IotLecturaTelemetria = typeof iotLecturasTelemetria.$inferSelect;
export type NewIotLecturaTelemetria = typeof iotLecturasTelemetria.$inferInsert;

export const iotAlertas = pgTable('iot_alertas', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  equipoId: uuid('equipo_id')
    .notNull()
    .references(() => equipos.id),
  lecturaId: uuid('lectura_id').references(() => iotLecturasTelemetria.id),
  tipo: iotAlertaTipoEnum('tipo').notNull(),
  gravedad: iotAlertaGravedadEnum('gravedad').notNull().default('leve'),
  estado: iotAlertaEstadoEnum('estado').notNull().default('abierta'),
  mensaje: text('mensaje').notNull(),
  reconocidaPorUserId: uuid('reconocida_por_user_id').references(
    () => users.id,
  ),
  cerradaAt: timestamp('cerrada_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type IotAlerta = typeof iotAlertas.$inferSelect;
export type NewIotAlerta = typeof iotAlertas.$inferInsert;

// ─── Contradictorios y modificados (Fase 14) ────────────────────────────────
/**
 * Workflow de aprobación de precios contradictorios y modificados de obra
 * con la Dirección Facultativa: `borrador` (editable) → `enviado_df`
 * (esperando resolución) → `aprobado`/`rechazado` (cerrado). El importe
 * aprobado puede diferir del estimado; no toca `budget_items` directamente
 * — la certificación del modificado sigue el circuito normal de
 * certificaciones una vez aprobado, igual que cualquier partida.
 */
export const changeOrderTipoEnum = pgEnum('change_order_tipo', [
  'contradictorio',
  'modificado',
]);

export const changeOrderEstadoEnum = pgEnum('change_order_estado', [
  'borrador',
  'enviado_df',
  'aprobado',
  'rechazado',
]);

export const changeOrders = pgTable(
  'change_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    phaseId: uuid('phase_id').references(() => projectPhases.id),
    /** Correlativo por obra, igual criterio que `purchase_orders.seq`. */
    seq: integer('seq').notNull(),
    numero: text('numero').notNull(),
    tipo: changeOrderTipoEnum('tipo').notNull().default('contradictorio'),
    estado: changeOrderEstadoEnum('estado').notNull().default('borrador'),
    titulo: text('titulo').notNull(),
    descripcion: text('descripcion').notNull(),
    motivo: text('motivo'),
    direccionFacultativaContactId: uuid(
      'direccion_facultativa_contact_id',
    ).references(() => contacts.id),
    importeEstimado: numeric('importe_estimado', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0.00'),
    importeAprobado: numeric('importe_aprobado', {
      precision: 14,
      scale: 2,
    }),
    documentId: uuid('document_id').references(() => documents.id),
    fechaEnvio: timestamp('fecha_envio', { withTimezone: true }),
    fechaResolucion: timestamp('fecha_resolucion', { withTimezone: true }),
    comentarioResolucion: text('comentario_resolucion'),
    notas: text('notas'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.projectId, t.seq),
    index('change_orders_company_created_idx')
      .on(t.companyId, t.createdAt.desc().nullsFirst())
      .where(sql`deleted_at IS NULL`),
  ],
);

export type ChangeOrder = typeof changeOrders.$inferSelect;
export type NewChangeOrder = typeof changeOrders.$inferInsert;

/** Línea de precio contradictorio/modificado: partida nueva o repreciada. */
export const changeOrderLineas = pgTable(
  'change_order_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeOrderId: uuid('change_order_id')
      .notNull()
      .references(() => changeOrders.id, { onDelete: 'cascade' }),
    /** Partida existente que se reprecia; nulo si es una partida nueva. */
    budgetItemId: uuid('budget_item_id').references(() => budgetItems.id),
    descripcion: text('descripcion').notNull(),
    unidad: text('unidad').notNull(),
    cantidad: numeric('cantidad', { precision: 14, scale: 4 }).notNull(),
    precioUnitario: numeric('precio_unitario', {
      precision: 14,
      scale: 4,
    }).notNull(),
    importe: numeric('importe', { precision: 14, scale: 2 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('change_order_lineas_change_order_id_idx').on(t.changeOrderId)],
);

export type ChangeOrderLinea = typeof changeOrderLineas.$inferSelect;
export type NewChangeOrderLinea = typeof changeOrderLineas.$inferInsert;

// ─── Firma digital biométrica (Fase 14) ─────────────────────────────────────
/**
 * Firma electrónica remota para partes, actas, contratos y entregas de EPI.
 * `entityTipo`/`entityId` es una referencia polimórfica ligera (sin FK de
 * base de datos, como el resto del ERP no tiene una tabla única de
 * "documentos firmables"): el módulo que la crea es responsable de que el
 * `entityId` exista. Cada firmante guarda el hash de los datos de firma
 * (trazo/biometría) recibidos del cliente, no la biometría en crudo.
 */
export const signatureEntityTipoEnum = pgEnum('signature_entity_tipo', [
  'parte_diario',
  'acta_recepcion',
  'contrato_obra',
  'entrega_epi',
  'otro',
]);

export const signatureEstadoEnum = pgEnum('signature_estado', [
  'pendiente',
  'completada',
  'cancelada',
  'expirada',
]);

export const signerEstadoEnum = pgEnum('signer_estado', [
  'pendiente',
  'firmado',
  'rechazado',
]);

export const signatureRequests = pgTable('signature_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id').references(() => projects.id),
  entityTipo: signatureEntityTipoEnum('entity_tipo').notNull(),
  entityId: uuid('entity_id').notNull(),
  titulo: text('titulo').notNull(),
  documentId: uuid('document_id').references(() => documents.id),
  estado: signatureEstadoEnum('estado').notNull().default('pendiente'),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id),
  fechaLimite: date('fecha_limite'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SignatureRequest = typeof signatureRequests.$inferSelect;
export type NewSignatureRequest = typeof signatureRequests.$inferInsert;

export const signatureSigners = pgTable('signature_signers', {
  id: uuid('id').primaryKey().defaultRandom(),
  signatureRequestId: uuid('signature_request_id')
    .notNull()
    .references(() => signatureRequests.id, { onDelete: 'cascade' }),
  nombre: text('nombre').notNull(),
  email: text('email'),
  /** Rol textual del firmante en el documento: "Jefe de obra", "Dirección Facultativa"… */
  rol: text('rol'),
  sortOrder: integer('sort_order').notNull().default(0),
  estado: signerEstadoEnum('estado').notNull().default('pendiente'),
  firmadoAt: timestamp('firmado_at', { withTimezone: true }),
  ipFirma: text('ip_firma'),
  /** sha256 de los datos de firma (trazo/biometría) recibidos del cliente. */
  hashFirma: text('hash_firma'),
  motivoRechazo: text('motivo_rechazo'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SignatureSigner = typeof signatureSigners.$inferSelect;
export type NewSignatureSigner = typeof signatureSigners.$inferInsert;

// ─── Portales externos de autoservicio (Fase 14) ────────────────────────────
/**
 * Soporte de datos para los portales aislados de `apps/web/src/app/portals`.
 * El portal de clientes es de solo lectura sobre datos ya existentes
 * (`projects`, `certifications`, `project_phases`…) y no necesita tabla
 * propia. El portal de subcontratas sí: CAE ya vive en
 * `contact_compliance_docs` (se reutiliza, filtrando por `users.contact_id`),
 * pero la carga de facturas necesita una bandeja de entrada propia — no se
 * escribe directo en `invoices` porque esa tabla lleva encadenado el hash
 * VeriFactu y la numeración fiscal, que son responsabilidad de
 * administración, no de la subcontrata.
 */
export const portalSubmissionEstadoEnum = pgEnum('portal_submission_estado', [
  'pendiente_revision',
  'aceptada',
  'rechazada',
]);

export const portalFacturaSubmissions = pgTable('portal_factura_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  numeroFacturaDeclarado: text('numero_factura_declarado').notNull(),
  fechaDeclarada: date('fecha_declarada').notNull(),
  importeDeclarado: numeric('importe_declarado', {
    precision: 14,
    scale: 2,
  }).notNull(),
  estado: portalSubmissionEstadoEnum('estado')
    .notNull()
    .default('pendiente_revision'),
  notas: text('notas'),
  revisadoPorUserId: uuid('revisado_por_user_id').references(() => users.id),
  revisadoAt: timestamp('revisado_at', { withTimezone: true }),
  /** Si el staff la vincula a la factura real ya dada de alta en `invoices`. */
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PortalFacturaSubmission =
  typeof portalFacturaSubmissions.$inferSelect;
export type NewPortalFacturaSubmission =
  typeof portalFacturaSubmissions.$inferInsert;

// ─── Inversores / Real Estate ──────────────────────────────────────────────
// Cuentas en participación por obra/promoción: cada `investment_account`
// agrupa a los inversores que financian una obra (o la empresa en general,
// con `project_id` nulo) y el reparto de aportaciones/dividendos entre ellos.
// La TIR/VAN se calculan en caliente en `packages/shared/src/calculo.ts` a
// partir de los movimientos de `investment_cashflows`, nunca se persisten.

export const investorKindEnum = pgEnum('investor_kind', [
  'persona_fisica',
  'persona_juridica',
]);

export const investors = pgTable(
  'investors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: investorKindEnum('kind').notNull().default('persona_fisica'),
    legalName: text('legal_name').notNull(),
    taxId: text('tax_id'),
    email: text('email'),
    phone: text('phone'),
    iban: text('iban'),
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
    uniqueIndex('investors_company_taxid_unique')
      .on(t.companyId, t.taxId)
      .where(sql`deleted_at IS NULL AND tax_id IS NOT NULL`),
  ],
);

export const investmentAccountStatusEnum = pgEnum('investment_account_status', [
  'activa',
  'cerrada',
]);

/** Cuenta en participación: el vehículo que agrupa la inversión de una obra/promoción. */
export const investmentAccounts = pgTable('investment_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  /** Nulo = fondo/cuenta a nivel de empresa, no atada a una única obra. */
  projectId: uuid('project_id').references(() => projects.id),
  name: text('name').notNull(),
  status: investmentAccountStatusEnum('status').notNull().default('activa'),
  /** Capital comprometido total (suma de referencia; no se recalcula sola). */
  committedAmount: numeric('committed_amount', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  /** Valoración actual no realizada, para la TIR "a valor de hoy". Editable a mano. */
  currentValuationAmount: numeric('current_valuation_amount', {
    precision: 14,
    scale: 2,
  }),
  startDate: date('start_date').notNull(),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Porcentaje de participación de cada inversor en una cuenta. */
export const investmentParticipations = pgTable(
  'investment_participations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: 'cascade' }),
    investorId: uuid('investor_id')
      .notNull()
      .references(() => investors.id, { onDelete: 'restrict' }),
    /** % de participación, con 4 decimales para cuadrar repartos al céntimo. */
    participationPct: numeric('participation_pct', {
      precision: 7,
      scale: 4,
    }).notNull(),
    committedAmount: numeric('committed_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    joinedAt: date('joined_at').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('investment_participations_account_investor_unique').on(
      t.accountId,
      t.investorId,
    ),
  ],
);

export const investmentCashflowDirectionEnum = pgEnum(
  'investment_cashflow_direction',
  ['aportacion', 'reparto'],
);

/**
 * Movimiento de caja frente a un inversor: aportación (entra dinero a la
 * cuenta) o reparto de dividendo (sale dinero hacia el inversor). Es la
 * serie temporal sobre la que se calcula la TIR/VAN de cada inversor —
 * `computeIrr`/`computeNpv` en `@erp/shared` esperan justo esta forma
 * (fecha + importe con signo desde el punto de vista del inversor).
 */
export const investmentCashflows = pgTable('investment_cashflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => investmentAccounts.id, { onDelete: 'cascade' }),
  investorId: uuid('investor_id')
    .notNull()
    .references(() => investors.id, { onDelete: 'restrict' }),
  direction: investmentCashflowDirectionEnum('direction').notNull(),
  flowDate: date('flow_date').notNull(),
  /** Siempre positivo; el signo para TIR/VAN lo pone `direction`. */
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  concept: text('concept'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Investor = typeof investors.$inferSelect;
export type NewInvestor = typeof investors.$inferInsert;
export type InvestmentAccount = typeof investmentAccounts.$inferSelect;
export type NewInvestmentAccount = typeof investmentAccounts.$inferInsert;
export type InvestmentParticipation =
  typeof investmentParticipations.$inferSelect;
export type NewInvestmentParticipation =
  typeof investmentParticipations.$inferInsert;
export type InvestmentCashflow = typeof investmentCashflows.$inferSelect;
export type NewInvestmentCashflow = typeof investmentCashflows.$inferInsert;

// ─── Tesorería · cuentas bancarias y caja ──────────────────────────────────
// Saldo real desde el que arranca la proyección de `TreasuryService.cashflow`
// (antes arrancaba siempre en 0, es decir, solo mostraba el neto de
// vencimientos sin el efectivo ya disponible). Sin ledger de movimientos
// todavía: `current_balance` se edita a mano o se recalcula desde fuera;
// la conciliación bancaria (extractos, Norma 43) queda para cuando se
// aborde M3 completo (`03-modulos.md`).

export const bankAccountKindEnum = pgEnum('bank_account_kind', [
  'banco',
  'caja',
]);

export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  name: text('name').notNull(),
  kind: bankAccountKindEnum('kind').notNull().default('banco'),
  iban: text('iban'),
  currentBalance: numeric('current_balance', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;

// ─── Copiloto IA de contratación ────────────────────────────────────────────
// Auditoría automática de contratos de subcontrata y pliegos: un agente LLM
// (mismo patrón que `apps/api/src/ocr/extraction.service.ts`, modelo de
// Anthropic con salida JSON estructurada) lee el documento y detecta
// cláusulas de riesgo. No sustituye la revisión legal; deja constancia de
// lo detectado para que un humano decida.

export const contractAuditRiskEnum = pgEnum('contract_audit_risk', [
  'bajo',
  'medio',
  'alto',
  'critico',
]);

export const contractAudits = pgTable('contract_audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id').references(() => projects.id),
  contactId: uuid('contact_id').references(() => contacts.id),
  /** Documento origen si venía de un PDF ya subido; null si se auditó texto pegado. */
  documentId: uuid('document_id').references(() => documents.id),
  model: text('model').notNull(),
  overallRisk: contractAuditRiskEnum('overall_risk').notNull(),
  summary: text('summary').notNull(),
  /** Array de { clause, riskLevel, explanation, recommendation }; ver `@erp/shared`. */
  findings: jsonb('findings').notNull().default([]),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ContractAudit = typeof contractAudits.$inferSelect;
export type NewContractAudit = typeof contractAudits.$inferInsert;

// ─── BIM · visor IFC ────────────────────────────────────────────────────────
// El modelo .ifc se guarda como original inmutable (mismo `StorageService`
// que `documents`) y se parsea en el navegador (`web-ifc` + `three`, Fase
// nueva de `apps/web/src/components/bim`). El backend solo guarda metadatos
// y el vínculo elemento IFC ↔ partida de presupuesto; la geometría nunca
// pasa por el servidor salvo para servir el fichero original.

export const bimModels = pgTable('bim_models', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  /** Ej. "IFC4", "IFC2X3", leído de la cabecera del fichero si se pudo. */
  ifcSchema: text('ifc_schema'),
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Vínculo entre un elemento del IFC (por su GlobalId) y una partida de presupuesto. */
export const bimElementLinks = pgTable(
  'bim_element_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bimModelId: uuid('bim_model_id')
      .notNull()
      .references(() => bimModels.id, { onDelete: 'cascade' }),
    /** GlobalId IFC (GUID base64 de 22 caracteres), no el expressID numérico interno. */
    ifcGlobalId: text('ifc_global_id').notNull(),
    ifcElementName: text('ifc_element_name'),
    /** Ej. "IfcWall", "IfcSlab"… tal como viene del fichero. */
    ifcElementType: text('ifc_element_type'),
    budgetItemId: uuid('budget_item_id').references(() => budgetItems.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('bim_element_links_model_global_id_unique').on(
      t.bimModelId,
      t.ifcGlobalId,
    ),
  ],
);

export type BimModel = typeof bimModels.$inferSelect;
export type NewBimModel = typeof bimModels.$inferInsert;
export type BimElementLink = typeof bimElementLinks.$inferSelect;
export type NewBimElementLink = typeof bimElementLinks.$inferInsert;

/* ═══════════════ Promoción inmobiliaria, comercialización y postventa ═══════════════
 * Unidades en venta de una promoción (obra), su reserva/venta a un
 * comprador (`contacts`, mismo maestro que proveedores/clientes — un
 * comprador es un cliente más), el plan de cobros pactado, el acta de
 * entrega de llaves y las incidencias de postventa/garantía una vez
 * entregada. No reutiliza `payment_milestones` (que nace de facturas):
 * el plan de cobros de un comprador puede pactarse antes de que exista
 * factura alguna (reserva → contrato privado → aplazados → escritura).
 */

export const realEstateUnitKindEnum = pgEnum('real_estate_unit_kind', [
  'vivienda',
  'local',
  'garaje',
  'trastero',
  'otro',
]);

export const realEstateUnitStatusEnum = pgEnum('real_estate_unit_status', [
  'disponible',
  'reservada',
  'vendida',
  'entregada',
]);

export const realEstateUnits = pgTable(
  'real_estate_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    /** Identificador comercial dentro de la promoción, p.ej. "1ºA", "Local 3". */
    code: text('code').notNull(),
    kind: realEstateUnitKindEnum('kind').notNull().default('vivienda'),
    surfaceM2: numeric('surface_m2', { precision: 8, scale: 2 }),
    salePrice: numeric('sale_price', { precision: 14, scale: 2 }).notNull(),
    status: realEstateUnitStatusEnum('status').notNull().default('disponible'),
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
    uniqueIndex('real_estate_units_project_code_unique')
      .on(t.projectId, t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const realEstateReservationStatusEnum = pgEnum(
  'real_estate_reservation_status',
  ['reservada', 'contrato_firmado', 'escriturada', 'cancelada'],
);

export const realEstateReservations = pgTable('real_estate_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  unitId: uuid('unit_id')
    .notNull()
    .references(() => realEstateUnits.id, { onDelete: 'restrict' }),
  buyerContactId: uuid('buyer_contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'restrict' }),
  status: realEstateReservationStatusEnum('status')
    .notNull()
    .default('reservada'),
  reservationDate: date('reservation_date').notNull(),
  /** Precio pactado con este comprador; puede diferir del `salePrice` de tarifa de la unidad. */
  agreedPrice: numeric('agreed_price', { precision: 14, scale: 2 }).notNull(),
  signalAmount: numeric('signal_amount', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  contractDate: date('contract_date'),
  deedDate: date('deed_date'),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const realEstatePaymentStatusEnum = pgEnum(
  'real_estate_payment_status',
  ['previsto', 'cobrado'],
);

/** Plan de cobros pactado con el comprador (señal, contrato, aplazados, escritura…). */
export const realEstatePaymentMilestones = pgTable(
  'real_estate_payment_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => realEstateReservations.id, { onDelete: 'cascade' }),
    concept: text('concept').notNull(),
    dueDate: date('due_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: realEstatePaymentStatusEnum('status').notNull().default('previsto'),
    paidAt: date('paid_at'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/** Acta de entrega de llaves: una por reserva (índice único). */
export const realEstateKeyHandovers = pgTable(
  'real_estate_key_handovers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => realEstateReservations.id, { onDelete: 'cascade' }),
    handoverDate: date('handover_date').notNull(),
    /** Acta firmada digitalizada, si se sube (reutiliza `documents`). */
    documentId: uuid('document_id').references(() => documents.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('real_estate_key_handovers_reservation_unique').on(
      t.reservationId,
    ),
  ],
);

export const postventaIncidentCategoryEnum = pgEnum(
  'postventa_incident_category',
  [
    'albanileria',
    'fontaneria',
    'electricidad',
    'carpinteria',
    'climatizacion',
    'otros',
  ],
);

export const postventaIncidentStatusEnum = pgEnum('postventa_incident_status', [
  'abierta',
  'en_reparacion',
  'cerrada',
]);

/** Incidencia de postventa/garantía sobre una unidad ya entregada. */
export const postventaIncidents = pgTable('postventa_incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  unitId: uuid('unit_id')
    .notNull()
    .references(() => realEstateUnits.id, { onDelete: 'restrict' }),
  /** Propietario que reporta la incidencia; nulo si la reporta el propio equipo. */
  reportedByContactId: uuid('reported_by_contact_id').references(
    () => contacts.id,
  ),
  category: postventaIncidentCategoryEnum('category')
    .notNull()
    .default('otros'),
  description: text('description').notNull(),
  status: postventaIncidentStatusEnum('status').notNull().default('abierta'),
  reportedAt: date('reported_at').notNull(),
  resolvedAt: date('resolved_at'),
  /** Fin del plazo de garantía aplicable a esta incidencia (LOE: 1/3/10 años según defecto). */
  warrantyDeadline: date('warranty_deadline'),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RealEstateUnit = typeof realEstateUnits.$inferSelect;
export type NewRealEstateUnit = typeof realEstateUnits.$inferInsert;
export type RealEstateReservation = typeof realEstateReservations.$inferSelect;
export type NewRealEstateReservation =
  typeof realEstateReservations.$inferInsert;
export type RealEstatePaymentMilestone =
  typeof realEstatePaymentMilestones.$inferSelect;
export type NewRealEstatePaymentMilestone =
  typeof realEstatePaymentMilestones.$inferInsert;
export type RealEstateKeyHandover = typeof realEstateKeyHandovers.$inferSelect;
export type NewRealEstateKeyHandover =
  typeof realEstateKeyHandovers.$inferInsert;
export type PostventaIncident = typeof postventaIncidents.$inferSelect;
export type NewPostventaIncident = typeof postventaIncidents.$inferInsert;

/* ═══════════════ App de obra offline-first: fichajes y checklist PRL ═══════════════
 * Datos de campo que la PWA (`apps/web`) puede crear sin cobertura y
 * sincronizar después en segundo plano (IndexedDB → cola → API). Cada fila
 * lleva un `client_id` opcional (UUID generado en el dispositivo en el
 * momento del fichaje/checklist, no al sincronizar) con índice único por
 * empresa: si la sincronización reintenta un envío que en realidad ya
 * llegó (app cerrada a media subida, reintento automático…), el segundo
 * POST es un no-op en vez de duplicar el registro — la idempotencia vive
 * en la clave, no en lógica de deduplicación a posteriori.
 *
 * Personal propio: mismo criterio que `partes_personal` (Fase 10) — no
 * hay maestro de trabajadores todavía, se anota el nombre.
 */

export const fichajeTypeEnum = pgEnum('fichaje_type', ['entrada', 'salida']);

export const fichajes = pgTable(
  'fichajes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    workerName: text('worker_name').notNull(),
    type: fichajeTypeEnum('type').notNull(),
    /** Momento real del fichaje (lo fija el dispositivo) — puede ser anterior a `createdAt` si se sincronizó offline más tarde. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Coordenadas del dispositivo al fichar, si el navegador las dio — justifica presencia en obra. */
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('fichajes_company_client_unique')
      .on(t.companyId, t.clientId)
      .where(sql`client_id IS NOT NULL`),
  ],
);

export type Fichaje = typeof fichajes.$inferSelect;
export type NewFichaje = typeof fichajes.$inferInsert;

/** Checklist PRL diario antes de empezar a trabajar (lista fija de comprobaciones, ver `packages/shared/src/offline-field.ts`). */
export const prlChecklists = pgTable(
  'prl_checklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    workerName: text('worker_name').notNull(),
    checkDate: date('check_date').notNull(),
    /** `{ label: string, checked: boolean }[]`, una fila por ítem del checklist fijo. */
    items: jsonb('items').notNull(),
    allChecked: boolean('all_checked').notNull().default(false),
    notes: text('notes'),
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('prl_checklists_company_client_unique')
      .on(t.companyId, t.clientId)
      .where(sql`client_id IS NOT NULL`),
  ],
);

export type PrlChecklist = typeof prlChecklists.$inferSelect;
export type NewPrlChecklist = typeof prlChecklists.$inferInsert;

/* ═══════════════ Notificaciones proactivas (Fase 13) ═══════════════
 * Hasta ahora todas las alertas del ERP (compliance PRL, permisos
 * públicos, sobrecoste, garantía de postventa) eran cálculo bajo
 * demanda — un `GET` que hay que entrar a mirar. `alert_rules` hace el
 * umbral configurable por empresa (cada una decide su propio horizonte
 * de aviso o su propio % de sobrecoste tolerable, en vez de un valor
 * fijo en código) y `notifications` es la bandeja de entrada in-app que
 * deja el cron (`AlertsSchedulerService`, `apps/api/src/alerts/`) al
 * evaluar esas reglas — con salida a email opcional si hay SMTP
 * configurado, igual de "opt-in silencioso" que `ANTHROPIC_API_KEY`.
 */

export const alertRuleTypeEnum = pgEnum('alert_rule_type', [
  'compliance_doc',
  'permiso',
  'sobrecoste',
  'garantia_postventa',
  // Solo notificaciones por evento (no tienen regla configurable).
  'aprobacion',
  'almacen',
  'aval',
]);

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    type: alertRuleTypeEnum('type').notNull(),
    /** Días antes de caducidad — solo aplica a `compliance_doc`/`permiso`/`garantia_postventa`. */
    thresholdDays: integer('threshold_days'),
    /** % de desviación sobre presupuesto — solo aplica a `sobrecoste`. */
    thresholdPct: numeric('threshold_pct', { precision: 6, scale: 2 }),
    /** `('in_app' | 'email')[]`, ver `packages/shared/src/alerts.ts`. */
    channels: jsonb('channels').notNull().default(['in_app']),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique('alert_rules_company_type_unique').on(t.companyId, t.type)],
);

export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;

/**
 * Bandeja in-app. `dedupeKey` identifica el hecho concreto que disparó la
 * alerta (p.ej. `compliance_doc:<contactId>:<docId>`) con índice único por
 * empresa: el cron no vuelve a crear la misma notificación en cada pasada
 * mientras el hecho siga sin resolverse — se notifica una vez, no cada N
 * minutos hasta que alguien actúe.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    type: alertRuleTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Ruta relativa del frontend a la que lleva la notificación, p.ej. "/cumplimiento". */
    link: text('link'),
    dedupeKey: text('dedupe_key').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('notifications_company_dedupe_unique').on(t.companyId, t.dedupeKey),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

/* ═══════════════ Conciliación bancaria (Fase 14) ═══════════════
 * Movimientos importados de un extracto (CSV o Norma 43/AEB43) para
 * cuadrarlos contra `payment_milestones` — asistida, no automática: un
 * movimiento propone un vencimiento candidato, una persona confirma.
 */
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id),
    transactionDate: date('transaction_date').notNull(),
    /** Con signo: positivo cobro, negativo pago — igual que lo trae el extracto. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    concept: text('concept').notNull(),
    balanceAfter: numeric('balance_after', { precision: 14, scale: 2 }),
    /** Referencia propia del banco, si el formato la trae (Norma 43 sí, el CSV genérico no siempre). */
    bankReference: text('bank_reference'),
    reconciledMilestoneId: uuid('reconciled_milestone_id').references(
      () => paymentMilestones.id,
    ),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Deduplica una reimportación accidental del mismo extracto.
    unique('bank_transactions_dedupe_unique').on(
      t.bankAccountId,
      t.transactionDate,
      t.amount,
      t.concept,
    ),
  ],
);

export type BankTransaction = typeof bankTransactions.$inferSelect;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;

/**
 * Claves de idempotencia (cabecera `Idempotency-Key`): una clave repetida en
 * 24 h devuelve la respuesta original guardada. Única por empresa. Ver
 * `apps/api/src/common/idempotencia/`.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    key: varchar('key', { length: 255 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    path: text('path').notNull(),
    /** SHA-256 hex del JSON canónico del cuerpo. */
    requestHash: char('request_hash', { length: 64 }).notNull(),
    /** 'procesando' | 'completada'. */
    status: varchar('status', { length: 12 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_keys_company_key_unique').on(t.companyId, t.key),
    index('idempotency_keys_expires_at_idx').on(t.expiresAt),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

/* ───────────────── Contabilidad general (libro mayor) ─────────────────
 * Plan de cuentas PGC por empresa, períodos mensuales y asientos de partida
 * doble. Reglas puras en `packages/shared/src/contabilidad.ts`. Garantías en
 * base de datos (migración 0049): trigger diferido de cuadre debe = haber por
 * asiento e inmutabilidad de las líneas contabilizadas.
 */

export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', [
  'activo',
  'pasivo',
  'patrimonio',
  'ingreso',
  'gasto',
]);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 12 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    type: ledgerAccountTypeEnum('type').notNull(),
    /** Solo las cuentas imputables reciben apuntes; las de 3 dígitos agrupan. */
    postable: boolean('postable').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_accounts_company_code_unique').on(t.companyId, t.code),
    check('ledger_accounts_code_digits', sql`${t.code} ~ '^[0-9]{3,12}$'`),
  ],
);

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;

export const fiscalPeriodStatusEnum = pgEnum('fiscal_period_status', [
  'abierto',
  'cerrado',
]);

/** Período contable mensual. Sin fila = abierto. */
export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    status: fiscalPeriodStatusEnum('status').notNull().default('abierto'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('fiscal_periods_company_year_month_unique').on(
      t.companyId,
      t.year,
      t.month,
    ),
    check('fiscal_periods_month_range', sql`${t.month} BETWEEN 1 AND 12`),
  ],
);

export const journalEntrySourceEnum = pgEnum('journal_entry_source', [
  'manual',
  'factura_venta',
  'factura_compra',
  'cobro',
  'pago',
  'anulacion',
  'amortizacion',
  'baja_inmovilizado',
  'entrada_almacen',
  'consumo_obra',
  'devolucion_obra',
  'regularizacion_inventario',
  'obra_en_curso',
  'provision_perdidas',
  'aval',
  'regularizacion_ejercicio',
  'cierre_ejercicio',
  'apertura_ejercicio',
  'aplicacion_resultado',
]);

export const journalEntryStatusEnum = pgEnum('journal_entry_status', [
  'contabilizado',
  'anulado',
]);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Número correlativo por empresa y ejercicio. */
    number: integer('number').notNull(),
    fiscalYear: smallint('fiscal_year').notNull(),
    entryDate: date('entry_date').notNull(),
    description: varchar('description', { length: 240 }).notNull(),
    source: journalEntrySourceEnum('source').notNull(),
    /** Factura o vencimiento de origen (null en manuales). */
    sourceId: uuid('source_id'),
    status: journalEntryStatusEnum('status').notNull().default('contabilizado'),
    /** Contra-asiento que anula este asiento. */
    reversedById: uuid('reversed_by_id').references(
      (): AnyPgColumn => journalEntries.id,
    ),
    /** Asiento que este contra-asiento anula. */
    reversesId: uuid('reverses_id').references(
      (): AnyPgColumn => journalEntries.id,
    ),
    reversalReason: varchar('reversal_reason', { length: 240 }),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('journal_entries_company_year_number_unique').on(
      t.companyId,
      t.fiscalYear,
      t.number,
    ),
    index('journal_entries_company_date_idx').on(
      t.companyId,
      t.entryDate,
      t.number,
    ),
    // Interfaz contable idempotente: un único asiento vivo por documento de origen.
    uniqueIndex('journal_entries_source_vivo_unique')
      .on(t.companyId, t.source, t.sourceId)
      .where(
        sql`source_id IS NOT NULL AND status = 'contabilizado' AND reverses_id IS NULL`,
      ),
    check(
      'journal_entries_source_id_coherence',
      sql`(${t.source} = 'manual') = (${t.sourceId} IS NULL) OR ${t.source} = 'anulacion'`,
    ),
  ],
);

export type JournalEntry = typeof journalEntries.$inferSelect;

export const journalEntryLines = pgTable(
  'journal_entry_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'restrict' }),
    lineNo: smallint('line_no').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0'),
    credit: numeric('credit', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** Imputación analítica por obra (centro de coste). */
    projectId: uuid('project_id').references(() => projects.id),
    description: varchar('description', { length: 240 }),
  },
  (t) => [
    index('journal_entry_lines_entry_idx').on(t.entryId),
    index('journal_entry_lines_company_account_idx').on(
      t.companyId,
      t.accountId,
    ),
    index('journal_entry_lines_company_project_idx')
      .on(t.companyId, t.projectId)
      .where(sql`project_id IS NOT NULL`),
    check(
      'journal_entry_lines_un_lado',
      sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} > 0) <> (${t.credit} > 0)`,
    ),
  ],
);

export type JournalEntryLine = typeof journalEntryLines.$inferSelect;

/* ───────────── Liquidaciones de vencimientos (cobros y pagos parciales) ─────────────
 * Cada cobro o pago, total o parcial, contra un vencimiento. Inmutables: una
 * liquidación errónea se anula (status 'anulada', con motivo) y deja de contar
 * en `payment_milestones.settled_amount`. Reglas puras en
 * `packages/shared/src/calculo.ts` (`motivoLiquidacionInvalida`).
 */

export const settlementStatusEnum = pgEnum('settlement_status', [
  'vigente',
  'anulada',
]);

export const paymentSettlements = pgTable(
  'payment_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    // Cascada: un vencimiento solo se borra sin liquidado (anular o
    // rectificar la factura); su historial queda en audit_log.
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => paymentMilestones.id, { onDelete: 'cascade' }),
    /** Con el signo del vencimiento (negativo en rectificativas); nunca 0. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    settledOn: date('settled_on').notNull(),
    status: settlementStatusEnum('status').notNull().default('vigente'),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
    /** Movimiento bancario conciliado que originó la liquidación. */
    bankTransactionId: uuid('bank_transaction_id').references(
      () => bankTransactions.id,
    ),
    paymentInstrument: paymentInstrumentEnum('payment_instrument')
      .notNull()
      .default('transferencia'),
    reference: varchar('reference', { length: 80 }),
    notes: text('notes'),
    reversalReason: varchar('reversal_reason', { length: 240 }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedBy: uuid('reversed_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('payment_settlements_company_milestone_idx').on(
      t.companyId,
      t.milestoneId,
      t.settledOn,
    ),
    index('payment_settlements_company_date_idx').on(
      t.companyId,
      t.settledOn,
      t.status,
    ),
    index('payment_settlements_bank_transaction_idx')
      .on(t.bankTransactionId)
      .where(sql`bank_transaction_id IS NOT NULL`),
    check('payment_settlements_amount_not_zero', sql`${t.amount} <> 0`),
    check(
      'payment_settlements_reversal_coherence',
      sql`(${t.status} = 'anulada') = (${t.reversedAt} IS NOT NULL AND ${t.reversalReason} IS NOT NULL)`,
    ),
  ],
);

export type PaymentSettlement = typeof paymentSettlements.$inferSelect;

/* ───────────────── Activos fijos (inmovilizado material) ─────────────────
 * Ficha del activo (opcionalmente ligada a una máquina de `equipos`) y sus
 * cuotas de amortización contabilizadas. Reglas puras en `calculo.ts`
 * (`cuadroAmortizacion`, `resultadoBaja`); contrato en `@erp/shared/activos`.
 */

export const fixedAssetCategoryEnum = pgEnum('fixed_asset_category', [
  'maquinaria',
  'transporte',
  'utillaje',
  'instalaciones',
  'informatica',
  'otros',
]);

export const fixedAssetStatusEnum = pgEnum('fixed_asset_status', [
  'activo',
  'baja',
]);

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 30 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    category: fixedAssetCategoryEnum('category').notNull(),
    equipoId: uuid('equipo_id').references(() => equipos.id),
    /** Obra a la que se imputa la amortización (centro de coste). */
    projectId: uuid('project_id').references(() => projects.id),
    acquisitionDate: date('acquisition_date').notNull(),
    /** Puesta en servicio: la amortización empieza ese mes. */
    startDate: date('start_date').notNull(),
    cost: numeric('cost', { precision: 14, scale: 2 }).notNull(),
    residualValue: numeric('residual_value', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    status: fixedAssetStatusEnum('status').notNull().default('activo'),
    disposalDate: date('disposal_date'),
    disposalAmount: numeric('disposal_amount', { precision: 14, scale: 2 }),
    disposalReason: varchar('disposal_reason', { length: 240 }),
    disposalEntryId: uuid('disposal_entry_id').references(
      () => journalEntries.id,
    ),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('fixed_assets_company_code_unique').on(t.companyId, t.code),
    // Una máquina solo puede ser un activo.
    uniqueIndex('fixed_assets_equipo_unique')
      .on(t.equipoId)
      .where(sql`equipo_id IS NOT NULL`),
    index('fixed_assets_company_status_idx').on(t.companyId, t.status),
    check(
      'fixed_assets_importes',
      sql`${t.cost} > 0 AND ${t.residualValue} >= 0 AND ${t.residualValue} <= ${t.cost} AND ${t.usefulLifeMonths} > 0`,
    ),
    check('fixed_assets_fechas', sql`${t.startDate} >= ${t.acquisitionDate}`),
    check(
      'fixed_assets_baja_coherencia',
      sql`(${t.status} = 'baja') = (${t.disposalDate} IS NOT NULL)`,
    ),
  ],
);

export type FixedAsset = typeof fixedAssets.$inferSelect;

/** Cuota de amortización contabilizada: una por activo y mes (idempotente). */
export const fixedAssetDepreciations = pgTable(
  'fixed_asset_depreciations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id, { onDelete: 'restrict' }),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    journalEntryId: uuid('journal_entry_id').references(
      () => journalEntries.id,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('fixed_asset_depreciations_asset_period_unique').on(
      t.assetId,
      t.year,
      t.month,
    ),
    index('fixed_asset_depreciations_company_period_idx').on(
      t.companyId,
      t.year,
      t.month,
    ),
    check(
      'fixed_asset_depreciations_mes',
      sql`${t.month} BETWEEN 1 AND 12 AND ${t.amount} > 0`,
    ),
  ],
);

export type FixedAssetDepreciation =
  typeof fixedAssetDepreciations.$inferSelect;

/* ─────────────────────────── Almacén y stock ───────────────────────────
 * Almacenes (centrales y acopios de obra), catálogo de artículos, saldo
 * valorado por almacén y artículo (cantidad + valor; PMP = valor/cantidad) y
 * movimientos inmutables (trigger en la migración 0052). Reglas puras de
 * valoración en `calculo.ts`; contrato en `@erp/shared/almacen`.
 */

export const warehouseKindEnum = pgEnum('warehouse_kind', ['central', 'obra']);

export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'entrada_compra',
  'salida_obra',
  'traspaso',
  'regularizacion',
  'devolucion',
]);

export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    kind: warehouseKindEnum('kind').notNull(),
    /** Obra del acopio (solo `kind = 'obra'`). */
    projectId: uuid('project_id').references(() => projects.id),
    address: varchar('address', { length: 240 }),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('warehouses_company_code_unique').on(t.companyId, t.code),
    index('warehouses_company_project_idx').on(t.companyId, t.projectId),
    check(
      'warehouses_kind_project',
      sql`(${t.kind} = 'obra') = (${t.projectId} IS NOT NULL)`,
    ),
  ],
);

export type Warehouse = typeof warehouses.$inferSelect;

export const stockArticles = pgTable(
  'stock_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 30 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    unit: varchar('unit', { length: 10 }).notNull(),
    /** Cuenta PGC de existencias (grupo 3). */
    inventoryAccount: varchar('inventory_account', { length: 10 })
      .notNull()
      .default('3000'),
    /** Cuenta PGC de variación de existencias (subgrupo 61). */
    variationAccount: varchar('variation_account', { length: 10 })
      .notNull()
      .default('6100'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_articles_company_code_unique').on(t.companyId, t.code),
    check(
      'stock_articles_cuentas_pgc',
      sql`${t.inventoryAccount} ~ '^3[0-9]{3,7}$' AND ${t.variationAccount} ~ '^61[0-9]{2,6}$'`,
    ),
  ],
);

export type StockArticle = typeof stockArticles.$inferSelect;

/** Saldo valorado de un artículo en un almacén. */
export const stockItems = pgTable(
  'stock_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    articleId: uuid('article_id')
      .notNull()
      .references(() => stockArticles.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 14, scale: 3 })
      .notNull()
      .default('0'),
    reservedQuantity: numeric('reserved_quantity', { precision: 14, scale: 3 })
      .notNull()
      .default('0'),
    /** Valor de las existencias (céntimos exactos): la fuente del PMP. */
    stockValue: numeric('stock_value', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** PMP vigente; con saldo cero conserva el último conocido. */
    averageCost: numeric('average_cost', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    minStock: numeric('min_stock', { precision: 14, scale: 3 })
      .notNull()
      .default('0'),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_items_warehouse_article_unique').on(
      t.warehouseId,
      t.articleId,
    ),
    index('stock_items_company_article_idx').on(t.companyId, t.articleId),
    check(
      'stock_items_no_negativo',
      sql`${t.quantity} >= 0 AND ${t.stockValue} >= 0 AND ${t.averageCost} >= 0 AND ${t.minStock} >= 0`,
    ),
    check(
      'stock_items_reserva',
      sql`${t.reservedQuantity} >= 0 AND ${t.reservedQuantity} <= ${t.quantity}`,
    ),
    check(
      'stock_items_valor_sin_cantidad',
      sql`${t.quantity} > 0 OR ${t.stockValue} = 0`,
    ),
  ],
);

export type StockItem = typeof stockItems.$inferSelect;

/**
 * Movimiento de stock (kárdex). Inmutable: un error se corrige con otro
 * movimiento. Cantidad y valor con signo respecto a `warehouse_id` (en un
 * traspaso, el origen; el destino es `target_warehouse_id`).
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    type: stockMovementTypeEnum('type').notNull(),
    movementDate: date('movement_date').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    targetWarehouseId: uuid('target_warehouse_id').references(
      () => warehouses.id,
      { onDelete: 'restrict' },
    ),
    articleId: uuid('article_id')
      .notNull()
      .references(() => stockArticles.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id),
    deliveryNoteId: uuid('delivery_note_id').references(() => deliveryNotes.id),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    totalValue: numeric('total_value', { precision: 14, scale: 2 }).notNull(),
    /** Saldo del almacén `warehouse_id` tras el movimiento. */
    quantityAfter: numeric('quantity_after', {
      precision: 14,
      scale: 3,
    }).notNull(),
    averageCostAfter: numeric('average_cost_after', {
      precision: 14,
      scale: 4,
    }).notNull(),
    reason: varchar('reason', { length: 240 }),
    notes: text('notes'),
    journalEntryId: uuid('journal_entry_id').references(
      () => journalEntries.id,
    ),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('stock_movements_company_date_idx').on(
      t.companyId,
      t.movementDate.desc(),
      t.createdAt.desc(),
    ),
    index('stock_movements_warehouse_article_idx').on(
      t.warehouseId,
      t.articleId,
      t.movementDate,
    ),
    index('stock_movements_target_warehouse_idx')
      .on(t.targetWarehouseId)
      .where(sql`target_warehouse_id IS NOT NULL`),
    index('stock_movements_company_project_idx')
      .on(t.companyId, t.projectId, t.movementDate)
      .where(sql`project_id IS NOT NULL`),
    // Un albarán se recepciona en stock una sola vez por artículo.
    uniqueIndex('stock_movements_delivery_note_article_unique')
      .on(t.deliveryNoteId, t.articleId)
      .where(sql`delivery_note_id IS NOT NULL`),
    check(
      'stock_movements_signo',
      sql`${t.quantity} <> 0 AND ${t.unitCost} >= 0 AND (
        (${t.type} IN ('entrada_compra', 'devolucion') AND ${t.quantity} > 0 AND ${t.totalValue} >= 0)
        OR (${t.type} IN ('salida_obra', 'traspaso') AND ${t.quantity} < 0 AND ${t.totalValue} <= 0)
        OR (${t.type} = 'regularizacion' AND sign(${t.totalValue}) IN (0, sign(${t.quantity})))
      )`,
    ),
    check(
      'stock_movements_referencias',
      sql`(${t.type} = 'traspaso') = (${t.targetWarehouseId} IS NOT NULL)
        AND (${t.targetWarehouseId} IS NULL OR ${t.targetWarehouseId} <> ${t.warehouseId})
        AND (${t.type} NOT IN ('salida_obra', 'devolucion') OR ${t.projectId} IS NOT NULL)
        AND (${t.deliveryNoteId} IS NULL OR ${t.type} = 'entrada_compra')
        AND (${t.type} <> 'regularizacion' OR ${t.reason} IS NOT NULL)`,
    ),
    check('stock_movements_saldo', sql`${t.quantityAfter} >= 0`),
  ],
);

export type StockMovement = typeof stockMovements.$inferSelect;

/* ──────────────────── Control presupuestario por obra ────────────────────
 * Configuración del control de disponibilidad (SAP PS/CO): sin fila, la obra
 * está en modo observación. Reglas en `calculo.ts`
 * (`evaluarControlPresupuestario`); contrato en `@erp/shared`.
 */

export const budgetControlModeEnum = pgEnum('budget_control_mode', [
  'observacion',
  'aviso',
  'bloqueo',
]);

export const projectBudgetControls = pgTable(
  'project_budget_controls',
  {
    projectId: uuid('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    mode: budgetControlModeEnum('mode').notNull().default('observacion'),
    /** % sobre el presupuesto antes de considerarlo excedido. */
    tolerancePct: numeric('tolerance_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    /** % del presupuesto a partir del cual se avisa. */
    warningPct: numeric('warning_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('90'),
    updatedBy: uuid('updated_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('project_budget_controls_company_mode_idx').on(t.companyId, t.mode),
    check(
      'project_budget_controls_pct',
      sql`${t.tolerancePct} BETWEEN 0 AND 100 AND ${t.warningPct} > 0 AND ${t.warningPct} <= 100`,
    ),
  ],
);

export type ProjectBudgetControl = typeof projectBudgetControls.$inferSelect;

/* ──────────────────── Flujos de aprobación por umbral ────────────────────
 * Estrategia de liberación (SAP Release Strategy / Oracle Approvals): reglas
 * de umbral por operación y obra, y solicitudes con su decisión. Reglas puras
 * en `calculo.ts`; contrato en `@erp/shared/aprobaciones`.
 */

export const approvalOperationEnum = pgEnum('approval_operation', [
  'pedido_compra',
  'factura_compra',
  'certificacion_subcontrata',
]);

export const approvalRoleEnum = pgEnum('approval_role', [
  'administracion',
  'gerente',
  'admin',
]);

export const approvalRequestStatusEnum = pgEnum('approval_request_status', [
  'pendiente',
  'aprobada',
  'rechazada',
  'invalidada',
  'anulada',
]);

export const approvalRules = pgTable(
  'approval_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    name: varchar('name', { length: 120 }).notNull(),
    operation: approvalOperationEnum('operation').notNull(),
    /** Importe desde el que aplica (inclusive). */
    minAmount: numeric('min_amount', { precision: 14, scale: 2 }).notNull(),
    requiredRole: approvalRoleEnum('required_role').notNull(),
    /** Obra concreta; null = todas. */
    projectId: uuid('project_id').references(() => projects.id),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('approval_rules_company_operation_idx').on(
      t.companyId,
      t.operation,
      t.isActive,
    ),
    // Un mismo tramo no se repite por operación y alcance (obra o general).
    uniqueIndex('approval_rules_tramo_unique')
      .on(
        t.companyId,
        t.operation,
        sql`coalesce(${t.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.minAmount,
      )
      .where(sql`is_active`),
    check('approval_rules_min_amount', sql`${t.minAmount} >= 0`),
  ],
);

export type ApprovalRule = typeof approvalRules.$inferSelect;

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    operation: approvalOperationEnum('operation').notNull(),
    /** Documento sujeto: pedido, factura o certificación de subcontrata. */
    entityId: uuid('entity_id').notNull(),
    reference: varchar('reference', { length: 80 }).notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    ruleId: uuid('rule_id').references(() => approvalRules.id),
    /** Snapshot del importe solicitado. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    requiredRole: approvalRoleEnum('required_role').notNull(),
    status: approvalRequestStatusEnum('status').notNull().default('pendiente'),
    comment: varchar('comment', { length: 500 }),
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: varchar('decision_reason', { length: 500 }),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Una sola solicitud viva (pendiente o aprobada) por documento.
    uniqueIndex('approval_requests_viva_unique')
      .on(t.companyId, t.operation, t.entityId)
      .where(sql`status IN ('pendiente', 'aprobada')`),
    index('approval_requests_company_status_idx').on(
      t.companyId,
      t.status,
      t.requestedAt,
    ),
    index('approval_requests_entity_idx').on(
      t.companyId,
      t.operation,
      t.entityId,
      t.requestedAt,
    ),
    check('approval_requests_amount', sql`${t.amount} >= 0`),
    check(
      'approval_requests_decision',
      sql`(${t.status} = 'pendiente') = (${t.decidedAt} IS NULL)
        AND (${t.status} NOT IN ('rechazada', 'invalidada', 'anulada') OR ${t.decisionReason} IS NOT NULL)
        AND (${t.decidedBy} IS NULL OR ${t.requestedBy} IS NULL OR ${t.decidedBy} <> ${t.requestedBy} OR ${t.status} IN ('invalidada', 'anulada'))`,
    ),
  ],
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;

/* ─────────────────── Consolidación de grupo / holding ───────────────────
 * Permisos de consolidación entre sociedades, grupos con sus miembros,
 * ajustes manuales de consolidación y cierres (snapshot por periodo). Reglas
 * puras en `calculo.ts`; contrato en `@erp/shared/consolidacion`.
 */

/**
 * Permiso de consolidación: la sociedad `company_id` (dueña de los datos)
 * autoriza a `user_id`, de otra sociedad, a leer sus estados financieros
 * para consolidarlos. Lo concede y lo revoca el admin de `company_id`.
 */
export const userCompanyGrants = pgTable(
  'user_company_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('user_company_grants_vigente_unique')
      .on(t.companyId, t.userId)
      .where(sql`revoked_at IS NULL`),
    index('user_company_grants_user_idx').on(t.userId),
  ],
);

export type UserCompanyGrant = typeof userCompanyGrants.$inferSelect;

export const consolidationMethodEnum = pgEnum('consolidation_method', [
  'global',
  'proporcional',
]);

export const corporateGroups = pgTable(
  'corporate_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Sociedad matriz: dueña del grupo y de su configuración. */
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    name: varchar('name', { length: 120 }).notNull(),
    baseCurrency: char('base_currency', { length: 3 }).notNull().default('EUR'),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('corporate_groups_company_name_unique').on(t.companyId, t.name),
  ],
);

export type CorporateGroup = typeof corporateGroups.$inferSelect;

export const corporateGroupMembers = pgTable(
  'corporate_group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => corporateGroups.id, { onDelete: 'restrict' }),
    /** Sociedad integrada. */
    memberCompanyId: uuid('member_company_id')
      .notNull()
      .references(() => companies.id),
    ownershipPct: numeric('ownership_pct', {
      precision: 5,
      scale: 2,
    }).notNull(),
    method: consolidationMethodEnum('method').notNull().default('global'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Una sociedad no puede estar dos veces activa en el mismo grupo.
    uniqueIndex('corporate_group_members_activa_unique')
      .on(t.groupId, t.memberCompanyId)
      .where(sql`end_date IS NULL`),
    index('corporate_group_members_company_idx').on(t.memberCompanyId),
    check(
      'corporate_group_members_pct',
      sql`${t.ownershipPct} >= 0.01 AND ${t.ownershipPct} <= 100`,
    ),
    check(
      'corporate_group_members_fechas',
      sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

export type CorporateGroupMember = typeof corporateGroupMembers.$inferSelect;

export const consolidationAdjustmentStatusEnum = pgEnum(
  'consolidation_adjustment_status',
  ['vigente', 'anulado'],
);

/** Ajuste manual de consolidación (debe/haber, cuadrado por construcción). */
export const consolidationAdjustments = pgTable(
  'consolidation_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Matriz (dueña del grupo). */
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => corporateGroups.id, { onDelete: 'restrict' }),
    adjustmentDate: date('adjustment_date').notNull(),
    description: varchar('description', { length: 240 }).notNull(),
    debitAccount: varchar('debit_account', { length: 10 }).notNull(),
    creditAccount: varchar('credit_account', { length: 10 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    /** Sociedad a la que se refiere (informativo). */
    memberCompanyId: uuid('member_company_id').references(() => companies.id),
    status: consolidationAdjustmentStatusEnum('status')
      .notNull()
      .default('vigente'),
    cancelReason: varchar('cancel_reason', { length: 240 }),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('consolidation_adjustments_group_date_idx').on(
      t.groupId,
      t.adjustmentDate,
    ),
    check(
      'consolidation_adjustments_importe',
      sql`${t.amount} > 0 AND ${t.debitAccount} <> ${t.creditAccount}
        AND ${t.debitAccount} ~ '^[1-7][0-9]{2,9}$' AND ${t.creditAccount} ~ '^[1-7][0-9]{2,9}$'`,
    ),
    check(
      'consolidation_adjustments_anulacion',
      sql`(${t.status} = 'anulado') = (${t.cancelReason} IS NOT NULL)`,
    ),
  ],
);

export type ConsolidationAdjustment =
  typeof consolidationAdjustments.$inferSelect;

/** Cierre de consolidación: congela el resultado de un periodo. */
export const consolidationClosings = pgTable(
  'consolidation_closings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => corporateGroups.id, { onDelete: 'restrict' }),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('consolidation_closings_periodo_unique').on(
      t.groupId,
      t.periodFrom,
      t.periodTo,
    ),
    check(
      'consolidation_closings_periodo',
      sql`${t.periodTo} >= ${t.periodFrom}`,
    ),
  ],
);

export type ConsolidationClosing = typeof consolidationClosings.$inferSelect;

/* ───────────────────── Solicitudes de material de obra ─────────────────────
 * Reserva de stock por obra y requisición de compra del faltante (SAP MM,
 * Oracle Requisitions). Reglas puras en `calculo.ts`; contrato en
 * `@erp/shared/solicitudes-material`.
 */

export const materialRequestStatusEnum = pgEnum('material_request_status', [
  'abierta',
  'servida_parcial',
  'servida',
  'cancelada',
]);

export const materialRequests = pgTable(
  'material_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Correlativo por empresa; con el prefijo forma el número (SM-000001). */
    seq: integer('seq').notNull(),
    number: varchar('number', { length: 20 }).notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: materialRequestStatusEnum('status').notNull().default('abierta'),
    neededBy: date('needed_by'),
    notes: varchar('notes', { length: 500 }),
    cancelReason: varchar('cancel_reason', { length: 240 }),
    requestedBy: uuid('requested_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('material_requests_company_seq_unique').on(t.companyId, t.seq),
    index('material_requests_company_status_idx').on(
      t.companyId,
      t.status,
      t.createdAt,
    ),
    index('material_requests_project_idx').on(t.companyId, t.projectId),
    check(
      'material_requests_cancelacion',
      sql`(${t.status} = 'cancelada') = (${t.cancelReason} IS NOT NULL)`,
    ),
  ],
);

export type MaterialRequest = typeof materialRequests.$inferSelect;

export const materialRequestLines = pgTable(
  'material_request_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    requestId: uuid('request_id')
      .notNull()
      .references(() => materialRequests.id, { onDelete: 'restrict' }),
    articleId: uuid('article_id')
      .notNull()
      .references(() => stockArticles.id),
    quantityRequested: numeric('quantity_requested', {
      precision: 14,
      scale: 3,
    }).notNull(),
    /** Retenido ahora en `stock_items.reserved_quantity` por esta línea. */
    quantityReserved: numeric('quantity_reserved', { precision: 14, scale: 3 })
      .notNull()
      .default('0'),
    quantityServed: numeric('quantity_served', { precision: 14, scale: 3 })
      .notNull()
      .default('0'),
    /** Pedido de compra que cubre el faltante. */
    purchaseOrderId: uuid('purchase_order_id').references(
      () => purchaseOrders.id,
    ),
  },
  (t) => [
    uniqueIndex('material_request_lines_article_unique').on(
      t.requestId,
      t.articleId,
    ),
    index('material_request_lines_po_idx')
      .on(t.purchaseOrderId)
      .where(sql`purchase_order_id IS NOT NULL`),
    check(
      'material_request_lines_cantidades',
      sql`${t.quantityRequested} > 0 AND ${t.quantityReserved} >= 0 AND ${t.quantityServed} >= 0
        AND ${t.quantityReserved} + ${t.quantityServed} <= ${t.quantityRequested}`,
    ),
  ],
);

export type MaterialRequestLine = typeof materialRequestLines.$inferSelect;

/* ─────────────────────── Obra en curso (WIP) al cierre ───────────────────────
 * Un cierre por obra y mes (grado de avance): producción ejecutada y
 * facturado a origen, WIP y la regularización contabilizada respecto del
 * anterior. Reglas puras en `calculo.ts`; contrato en `@erp/shared/wip`.
 */

export const wipStatusEnum = pgEnum('wip_status', ['contabilizado', 'anulado']);

export const workInProgress = pgTable(
  'work_in_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    closingDate: date('closing_date').notNull(),
    /** Producción ejecutada a origen (última certificación hasta el cierre). */
    production: numeric('production', { precision: 14, scale: 2 }).notNull(),
    /** Facturado a origen (base de venta emitida hasta el cierre). */
    invoiced: numeric('invoiced', { precision: 14, scale: 2 }).notNull(),
    /** WIP a origen: production − invoiced (con signo). */
    wipAmount: numeric('wip_amount', { precision: 14, scale: 2 }).notNull(),
    previousWip: numeric('previous_wip', { precision: 14, scale: 2 }).notNull(),
    /** Lo contabilizado: wip_amount − previous_wip. */
    adjustment: numeric('adjustment', { precision: 14, scale: 2 }).notNull(),
    /** Coste real a origen (informativo: margen reconocido). */
    actualCost: numeric('actual_cost', { precision: 14, scale: 2 }).notNull(),
    status: wipStatusEnum('status').notNull().default('contabilizado'),
    /** Null si la regularización es 0 (no hay asiento). */
    journalEntryId: uuid('journal_entry_id').references(
      () => journalEntries.id,
    ),
    reversalEntryId: uuid('reversal_entry_id').references(
      () => journalEntries.id,
    ),
    cancelReason: varchar('cancel_reason', { length: 240 }),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Un solo cierre vigente por obra y mes.
    uniqueIndex('work_in_progress_vigente_unique')
      .on(t.companyId, t.projectId, t.year, t.month)
      .where(sql`status = 'contabilizado'`),
    index('work_in_progress_company_period_idx').on(
      t.companyId,
      t.year,
      t.month,
    ),
    index('work_in_progress_project_idx').on(t.projectId, t.year, t.month),
    check(
      'work_in_progress_cuadre',
      sql`${t.month} BETWEEN 1 AND 12
        AND ${t.wipAmount} = ${t.production} - ${t.invoiced}
        AND ${t.adjustment} = ${t.wipAmount} - ${t.previousWip}`,
    ),
    check(
      'work_in_progress_anulacion',
      sql`(${t.status} = 'anulado') = (${t.cancelReason} IS NOT NULL)`,
    ),
  ],
);

export type WorkInProgress = typeof workInProgress.$inferSelect;

/* ─────────────── Provisión por pérdidas previstas (contratos onerosos) ───────────────
 * Un cierre por obra y mes: pérdida total prevista, la ya reconocida por el
 * grado de avance, la provisión necesaria y el ajuste contabilizado frente a
 * la anterior. Reglas puras en `calculo.ts`; contrato en
 * `@erp/shared/provision-perdidas`. Mismo ciclo de estados que la obra en curso.
 */

export const lossProvisions = pgTable(
  'loss_provisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    closingDate: date('closing_date').notNull(),
    /** Ingreso total previsto (null: obra sin contrato, sin provisión). */
    contractAmount: numeric('contract_amount', { precision: 14, scale: 2 }),
    /** Coste estimado al cierre (cuadro de márgenes). */
    estimatedCost: numeric('estimated_cost', {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** Producción ejecutada a origen (como la obra en curso). */
    production: numeric('production', { precision: 14, scale: 2 }).notNull(),
    /** Coste real a origen hasta el cierre. */
    actualCost: numeric('actual_cost', { precision: 14, scale: 2 }).notNull(),
    projectFinished: boolean('project_finished').notNull().default(false),
    /** máx(0, coste estimado − contrato). */
    totalLoss: numeric('total_loss', { precision: 14, scale: 2 }).notNull(),
    /** máx(0, coste real − producción): ya en resultados. */
    recognizedLoss: numeric('recognized_loss', {
      precision: 14,
      scale: 2,
    }).notNull(),
    requiredProvision: numeric('required_provision', {
      precision: 14,
      scale: 2,
    }).notNull(),
    previousProvision: numeric('previous_provision', {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** Lo contabilizado: required − previous (dotación > 0, exceso < 0). */
    adjustment: numeric('adjustment', { precision: 14, scale: 2 }).notNull(),
    status: wipStatusEnum('status').notNull().default('contabilizado'),
    /** Null si el ajuste es 0 (no hay asiento). */
    journalEntryId: uuid('journal_entry_id').references(
      () => journalEntries.id,
    ),
    reversalEntryId: uuid('reversal_entry_id').references(
      () => journalEntries.id,
    ),
    cancelReason: varchar('cancel_reason', { length: 240 }),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Un solo cierre vigente por obra y mes.
    uniqueIndex('loss_provisions_vigente_unique')
      .on(t.companyId, t.projectId, t.year, t.month)
      .where(sql`status = 'contabilizado'`),
    index('loss_provisions_company_period_idx').on(
      t.companyId,
      t.year,
      t.month,
    ),
    index('loss_provisions_project_idx').on(t.projectId, t.year, t.month),
    check(
      'loss_provisions_cuadre',
      sql`${t.month} BETWEEN 1 AND 12
        AND ${t.totalLoss} >= 0 AND ${t.recognizedLoss} >= 0
        AND ${t.requiredProvision} >= 0 AND ${t.previousProvision} >= 0
        AND ${t.adjustment} = ${t.requiredProvision} - ${t.previousProvision}`,
    ),
    check(
      'loss_provisions_anulacion',
      sql`(${t.status} = 'anulado') = (${t.cancelReason} IS NOT NULL)`,
    ),
  ],
);

export type LossProvision = typeof lossProvisions.$inferSelect;

/* ─────────────────────── Avales bancarios y garantías ───────────────────────
 * Avales emitidos (a nuestro cargo, a favor de clientes o administraciones) y
 * recibidos (de subcontratas y proveedores a nuestro favor). Riesgo
 * contingente: sin asiento mientras vive; se contabilizan sus comisiones y
 * su ejecución. Invariante: saldo vivo = nominal − liberado − ejecutado.
 * Reglas puras en `calculo.ts`; contrato en `@erp/shared/avales`.
 */

export const bankGuaranteeTypeEnum = pgEnum('bank_guarantee_type', [
  'garantia_definitiva',
  'garantia_provisional',
  'anticipo',
  'buena_ejecucion',
  'oferta_licitacion',
  'retencion_garantia',
  'otro',
]);

export const bankGuaranteeDirectionEnum = pgEnum('bank_guarantee_direction', [
  'emitido',
  'recibido',
]);

export const bankGuaranteeStatusEnum = pgEnum('bank_guarantee_status', [
  'vigente',
  'liberado_parcial',
  'liberado',
  'ejecutado',
  'vencido',
  'anulado',
]);

export const bankGuaranteeMovementTypeEnum = pgEnum(
  'bank_guarantee_movement_type',
  [
    'alta',
    'liberacion',
    'ejecucion',
    'prorroga',
    'comision',
    'vencimiento',
    'anulacion',
  ],
);

export const bankGuarantees = pgTable(
  'bank_guarantees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Número del aval en la entidad avalista. */
    reference: varchar('reference', { length: 60 }).notNull(),
    type: bankGuaranteeTypeEnum('type').notNull(),
    direction: bankGuaranteeDirectionEnum('direction').notNull(),
    /** Entidad avalista (banco o aseguradora de caución). */
    issuer: varchar('issuer', { length: 120 }).notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    /** Beneficiario (emitido) o avalado (recibido). */
    contactId: uuid('contact_id').references(() => contacts.id),
    contratoObraId: uuid('contrato_obra_id').references(() => contratosObra.id),
    certificationId: uuid('certification_id').references(
      () => certifications.id,
    ),
    /** Cuenta propia de liquidación de comisiones y ejecuciones. */
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    releasedAmount: numeric('released_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    executedAmount: numeric('executed_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** Saldo vivo = amount − released − executed (CHECK). */
    outstandingAmount: numeric('outstanding_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** Comisiones registradas (acumulado). */
    commissionsAmount: numeric('commissions_amount', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    /** Comisión devengada mes a mes (6260 a 4100), vigente. */
    accruedCommission: numeric('accrued_commission', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    /** De lo devengado, lo que ya liquidó el banco (4100 a 5720). */
    accrualSettled: numeric('accrual_settled', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    issueDate: date('issue_date').notNull(),
    /** Null: indefinido, hasta su cancelación. */
    expiryDate: date('expiry_date'),
    commissionRatePct: numeric('commission_rate_pct', {
      precision: 7,
      scale: 4,
    }),
    commissionPeriodMonths: smallint('commission_period_months'),
    status: bankGuaranteeStatusEnum('status').notNull().default('vigente'),
    /** Motivo de la última liberación, ejecución o anulación. */
    reason: varchar('reason', { length: 240 }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_guarantees_reference_unique').on(
      t.companyId,
      t.issuer,
      t.reference,
    ),
    index('bank_guarantees_company_status_idx').on(
      t.companyId,
      t.status,
      t.expiryDate,
    ),
    index('bank_guarantees_company_project_idx').on(t.companyId, t.projectId),
    index('bank_guarantees_company_contact_idx').on(t.companyId, t.contactId),
    check(
      'bank_guarantees_importes',
      sql`${t.amount} > 0 AND ${t.releasedAmount} >= 0 AND ${t.executedAmount} >= 0
        AND ${t.commissionsAmount} >= 0
        AND ${t.outstandingAmount} >= 0 AND ${t.outstandingAmount} <= ${t.amount}
        AND ${t.outstandingAmount} = ${t.amount} - ${t.releasedAmount} - ${t.executedAmount}`,
    ),
    check(
      'bank_guarantees_fechas',
      sql`${t.expiryDate} IS NULL OR ${t.expiryDate} >= ${t.issueDate}`,
    ),
    check(
      'bank_guarantees_comision',
      sql`(${t.commissionRatePct} IS NULL OR (${t.commissionRatePct} >= 0 AND ${t.commissionRatePct} <= 100 AND ${t.direction} = 'emitido'))
        AND (${t.commissionPeriodMonths} IS NULL OR ${t.commissionPeriodMonths} BETWEEN 1 AND 12)`,
    ),
    check(
      'bank_guarantees_estado_saldo',
      sql`(${t.status} IN ('vigente', 'liberado_parcial', 'anulado')) = (${t.outstandingAmount} > 0)`,
    ),
  ],
);

export type BankGuarantee = typeof bankGuarantees.$inferSelect;

/** Historial inmutable del aval: cada alta, liberación, ejecución, prórroga… */
export const bankGuaranteeMovements = pgTable(
  'bank_guarantee_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    guaranteeId: uuid('guarantee_id')
      .notNull()
      .references(() => bankGuarantees.id),
    type: bankGuaranteeMovementTypeEnum('type').notNull(),
    movementDate: date('movement_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** Saldo vivo tras el movimiento. */
    outstandingAfter: numeric('outstanding_after', {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** Nuevo vencimiento (prórroga) o el vigente. */
    expiryDate: date('expiry_date'),
    reason: varchar('reason', { length: 240 }),
    journalEntryId: uuid('journal_entry_id').references(
      () => journalEntries.id,
    ),
    /** Ejecución financiada por el banco (5200) en vez de cargo en cuenta. */
    financed: boolean('financed').notNull().default(false),
    /**
     * En una liquidación de comisión, la parte que saldó lo devengado (4100):
     * permite reconstruir lo pendiente de liquidar a cualquier fecha.
     */
    accrualSettledAmount: numeric('accrual_settled_amount', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('bank_guarantee_movements_guarantee_idx').on(
      t.companyId,
      t.guaranteeId,
      t.movementDate,
    ),
    check(
      'bank_guarantee_movements_importes',
      sql`${t.amount} >= 0 AND ${t.outstandingAfter} >= 0`,
    ),
  ],
);

export type BankGuaranteeMovement = typeof bankGuaranteeMovements.$inferSelect;

/**
 * Línea de avales que una entidad nos concede (límite de riesgo). La consumen
 * los avales emitidos vivos de la misma entidad (`bank_guarantees.issuer`).
 */
export const bankGuaranteeLines = pgTable(
  'bank_guarantee_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    issuer: varchar('issuer', { length: 120 }).notNull(),
    limitAmount: numeric('limit_amount', { precision: 14, scale: 2 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    expiryDate: date('expiry_date'),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_guarantee_lines_issuer_unique').on(t.companyId, t.issuer),
    check('bank_guarantee_lines_limite', sql`${t.limitAmount} >= 0`),
  ],
);

export type BankGuaranteeLine = typeof bankGuaranteeLines.$inferSelect;

/* ─────────────────────── Cierre y apertura del ejercicio ───────────────────────
 * Un cierre vigente por empresa y ejercicio: los tres asientos (regularización,
 * cierre y apertura del siguiente), el resultado y los meses que cerró. Se
 * revierte por contra-asientos (estado `revertido`). Reglas puras en
 * `calculo.ts` (`asientosCierreEjercicio`).
 */

export const fiscalYearClosingStatusEnum = pgEnum(
  'fiscal_year_closing_status',
  ['cerrado', 'revertido'],
);

export const fiscalYearClosings = pgTable(
  'fiscal_year_closings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    year: smallint('year').notNull(),
    status: fiscalYearClosingStatusEnum('status').notNull().default('cerrado'),
    income: numeric('income', { precision: 14, scale: 2 }).notNull(),
    expenses: numeric('expenses', { precision: 14, scale: 2 }).notNull(),
    /** Ingresos − gastos (beneficio > 0). */
    result: numeric('result', { precision: 14, scale: 2 }).notNull(),
    regularizationEntryId: uuid('regularization_entry_id').references(
      () => journalEntries.id,
    ),
    closingEntryId: uuid('closing_entry_id').references(
      () => journalEntries.id,
    ),
    openingEntryId: uuid('opening_entry_id').references(
      () => journalEntries.id,
    ),
    /** Meses que este cierre pasó a «cerrado» (se reabren al revertir). */
    closedMonths: jsonb('closed_months').notNull().default([]),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reversalReason: varchar('reversal_reason', { length: 240 }),
    reversedBy: uuid('reversed_by').references(() => users.id),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('fiscal_year_closings_vigente_unique')
      .on(t.companyId, t.year)
      .where(sql`status = 'cerrado'`),
    index('fiscal_year_closings_company_year_idx').on(t.companyId, t.year),
    check(
      'fiscal_year_closings_cuadre',
      sql`${t.year} BETWEEN 2000 AND 2100 AND ${t.result} = ${t.income} - ${t.expenses}`,
    ),
    check(
      'fiscal_year_closings_reversion',
      sql`(${t.status} = 'revertido') = (${t.reversalReason} IS NOT NULL AND ${t.reversedAt} IS NOT NULL)`,
    ),
  ],
);

export type FiscalYearClosing = typeof fiscalYearClosings.$inferSelect;

/* ─────────────────────── Estimación al cierre (EAC) por obra ───────────────────────
 * Historial inmutable: cada versión fija (o retira, con importe null) el
 * coste estimado al cierre con fecha de efecto, motivo y usuario. La vigente
 * a una fecha es la de mayor versión con efecto ≤ esa fecha.
 */

export const projectCostEstimates = pgTable(
  'project_cost_estimates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    /** Secuencia por obra (1, 2, 3…): la versión de If-Match. */
    version: integer('version').notNull(),
    effectiveDate: date('effective_date').notNull(),
    /** Null: vuelta al cálculo automático. */
    estimatedCost: numeric('estimated_cost', { precision: 14, scale: 2 }),
    reason: varchar('reason', { length: 240 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('project_cost_estimates_version_unique').on(
      t.companyId,
      t.projectId,
      t.version,
    ),
    index('project_cost_estimates_project_date_idx').on(
      t.companyId,
      t.projectId,
      t.effectiveDate,
    ),
    check(
      'project_cost_estimates_importe',
      sql`${t.version} >= 1 AND (${t.estimatedCost} IS NULL OR ${t.estimatedCost} >= 0)`,
    ),
  ],
);

export type ProjectCostEstimate = typeof projectCostEstimates.$inferSelect;

/* ─────────────────── Aplicación del resultado del ejercicio (129) ───────────────────
 * Una aplicación vigente por empresa y ejercicio cerrado: el reparto acordado
 * (reservas, remanente, compensación, dividendos) y su asiento en el
 * ejercicio siguiente. Se anula por contra-asiento.
 */

export const resultApplicationStatusEnum = pgEnum('result_application_status', [
  'aplicado',
  'anulado',
]);

export const resultApplications = pgTable(
  'result_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Ejercicio cuyo resultado se aplica (ya cerrado). */
    year: smallint('year').notNull(),
    status: resultApplicationStatusEnum('status').notNull().default('aplicado'),
    /** Beneficio > 0, pérdida < 0 (sin CHECK de signo). */
    result: numeric('result', { precision: 14, scale: 2 }).notNull(),
    applicationDate: date('application_date').notNull(),
    agreement: varchar('agreement', { length: 240 }).notNull(),
    /** Acuerdo posterior al plazo de seis meses, confirmado expresamente. */
    outOfTerm: boolean('out_of_term').notNull().default(false),
    /** `[{ cuenta, importe }]` del reparto. */
    allocation: jsonb('allocation').notNull(),
    journalEntryId: uuid('journal_entry_id').references(
      () => journalEntries.id,
    ),
    reversalEntryId: uuid('reversal_entry_id').references(
      () => journalEntries.id,
    ),
    cancelReason: varchar('cancel_reason', { length: 240 }),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('result_applications_vigente_unique')
      .on(t.companyId, t.year)
      .where(sql`status = 'aplicado'`),
    index('result_applications_company_year_idx').on(t.companyId, t.year),
    check(
      'result_applications_anulacion',
      sql`(${t.status} = 'anulado') = (${t.cancelReason} IS NOT NULL)`,
    ),
  ],
);

export type ResultApplication = typeof resultApplications.$inferSelect;

/* ─────────────────── Devengo mensual de comisiones de aval ───────────────────
 * Un devengo vigente por aval y mes: días del mes en que estuvo vivo, saldo
 * y tasa de cálculo, importe y asiento (6260 obra a 4100). Mismo ciclo que
 * la obra en curso: contabilizado → anulado (contra-asiento).
 */

export const bankGuaranteeAccruals = pgTable(
  'bank_guarantee_accruals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    guaranteeId: uuid('guarantee_id')
      .notNull()
      .references(() => bankGuarantees.id),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    days: smallint('days').notNull(),
    baseAmount: numeric('base_amount', { precision: 14, scale: 2 }).notNull(),
    ratePct: numeric('rate_pct', { precision: 7, scale: 4 }).notNull(),
    /** Tramos de saldo constante del mes: `[{ desde, hasta, dias, saldo, importe }]`. */
    segments: jsonb('segments').notNull().default([]),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: wipStatusEnum('status').notNull().default('contabilizado'),
    journalEntryId: uuid('journal_entry_id').references(
      () => journalEntries.id,
    ),
    reversalEntryId: uuid('reversal_entry_id').references(
      () => journalEntries.id,
    ),
    cancelReason: varchar('cancel_reason', { length: 240 }),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_guarantee_accruals_vigente_unique')
      .on(t.companyId, t.guaranteeId, t.year, t.month)
      .where(sql`status = 'contabilizado'`),
    index('bank_guarantee_accruals_company_period_idx').on(
      t.companyId,
      t.year,
      t.month,
    ),
    check(
      'bank_guarantee_accruals_importes',
      sql`${t.month} BETWEEN 1 AND 12 AND ${t.days} BETWEEN 0 AND 31
        AND ${t.amount} >= 0 AND ${t.baseAmount} >= 0 AND ${t.periodTo} >= ${t.periodFrom}`,
    ),
    check(
      'bank_guarantee_accruals_anulacion',
      sql`(${t.status} = 'anulado') = (${t.cancelReason} IS NOT NULL)`,
    ),
  ],
);

export type BankGuaranteeAccrual = typeof bankGuaranteeAccruals.$inferSelect;

/**
 * Ejecuciones del devengo mensual (manuales o de la tarea programada): qué
 * mes, cuántos avales se devengaron, importe y omitidos. Registro de control
 * del cierre (SAP Financial Close / Oracle Close Manager).
 */
export const bankGuaranteeAccrualRuns = pgTable(
  'bank_guarantee_accrual_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    trigger: varchar('trigger', { length: 20 }).notNull(),
    postedCount: integer('posted_count').notNull().default(0),
    amount: numeric('amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    skippedCount: integer('skipped_count').notNull().default(0),
    skipped: jsonb('skipped').notNull().default([]),
    /** Lote del devengo automático al que pertenece (null: devengo manual de un mes). */
    batchId: uuid('batch_id').references(() => bankGuaranteeAccrualBatches.id),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('bank_guarantee_accrual_runs_company_period_idx').on(
      t.companyId,
      t.year,
      t.month,
    ),
    index('bank_guarantee_accrual_runs_batch_idx').on(t.batchId),
    check(
      'bank_guarantee_accrual_runs_valores',
      sql`${t.month} BETWEEN 1 AND 12 AND ${t.trigger} IN ('manual', 'automatico')
        AND ${t.postedCount} >= 0 AND ${t.skippedCount} >= 0`,
    ),
  ],
);

export type BankGuaranteeAccrualRun =
  typeof bankGuaranteeAccrualRuns.$inferSelect;

/**
 * Lotes del devengo automático de comisiones de aval (endpoint o tarea
 * programada): rango recorrido, fecha de referencia, totales y avisos de los
 * meses omitidos o saltados (motivo, nivel, casos). Evidencia auditada para
 * que las omisiones de la tarea programada lleguen a la UI y al MCP.
 */
export const bankGuaranteeAccrualBatches = pgTable(
  'bank_guarantee_accrual_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    trigger: varchar('trigger', { length: 20 }).notNull(),
    referenceDate: date('reference_date').notNull(),
    periodFrom: varchar('period_from', { length: 7 }),
    periodTo: varchar('period_to', { length: 7 }).notNull(),
    postedCount: integer('posted_count').notNull().default(0),
    amount: numeric('amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    warnings: jsonb('warnings').notNull().default([]),
    alertCount: integer('alert_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('bank_guarantee_accrual_batches_company_created_idx').on(
      t.companyId,
      t.createdAt,
    ),
    check(
      'bank_guarantee_accrual_batches_valores',
      sql`${t.trigger} IN ('manual', 'automatico')
        AND ${t.postedCount} >= 0 AND ${t.alertCount} >= 0`,
    ),
  ],
);

export type BankGuaranteeAccrualBatch =
  typeof bankGuaranteeAccrualBatches.$inferSelect;

/**
 * Conciliaciones de cierre auxiliar ↔ mayor guardadas (evidencia del cierre):
 * fecha de corte, partidas con auxiliar, mayor y diferencia, y resultado.
 */
export const closeReconciliations = pgTable(
  'close_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    cutOffDate: date('cut_off_date').notNull(),
    balanced: boolean('balanced').notNull(),
    mismatches: integer('mismatches').notNull(),
    items: jsonb('items').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('close_reconciliations_company_date_idx').on(
      t.companyId,
      t.cutOffDate,
    ),
    check(
      'close_reconciliations_coherencia',
      sql`${t.mismatches} >= 0 AND (${t.balanced} = (${t.mismatches} = 0))`,
    ),
  ],
);

export type CloseReconciliation = typeof closeReconciliations.$inferSelect;

/**
 * Historial de tasas de comisión de un aval: la de cada fecha rige desde ese
 * día (null: sin comisión). El devengo de un mes con cambio de tasa se
 * prorratea por tramos. Una tasa por aval y fecha de efecto.
 */
export const bankGuaranteeRates = pgTable(
  'bank_guarantee_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    guaranteeId: uuid('guarantee_id')
      .notNull()
      .references(() => bankGuarantees.id),
    effectiveDate: date('effective_date').notNull(),
    ratePct: numeric('rate_pct', { precision: 7, scale: 4 }),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_guarantee_rates_effective_unique').on(
      t.companyId,
      t.guaranteeId,
      t.effectiveDate,
    ),
    check(
      'bank_guarantee_rates_rango',
      sql`${t.ratePct} IS NULL OR (${t.ratePct} >= 0 AND ${t.ratePct} <= 100)`,
    ),
  ],
);

export type BankGuaranteeRate = typeof bankGuaranteeRates.$inferSelect;
