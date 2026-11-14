import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '@erp/db';

/** Índices de la Fase 2 (migración 0028_fase2_indices). */
const INDICES_ESPERADOS = [
  'budget_items_phase_id_idx',
  'budgets_project_status_idx',
  'certification_lines_budget_item_id_idx',
  'certifications_invoice_id_idx',
  'change_order_lineas_change_order_id_idx',
  'comparativos_project_phase_idx',
  'compliance_waivers_contact_id_idx',
  'contact_compliance_docs_contact_id_idx',
  'delivery_notes_order_status_idx',
  'delivery_notes_invoice_id_idx',
  'delivery_notes_project_id_idx',
  'documents_project_id_idx',
  'extractions_document_id_idx',
  'invoice_lines_invoice_id_idx',
  'invoice_lines_project_phase_idx',
  'invoices_company_status_issue_date_idx',
  'invoices_contact_id_idx',
  'partes_maquinaria_project_date_idx',
  'partes_personal_project_date_idx',
  'payment_milestones_invoice_id_idx',
  'payment_milestones_company_status_due_idx',
  'purchase_orders_contact_id_idx',
  'refresh_tokens_user_id_idx',
];

describe('Índices de la Fase 2', () => {
  // Esta spec usa `getDb()` sin levantar una app Nest, así que nadie más
  // cierra el pool de `pg`: sin esto Jest avisa «did not exit one second
  // after the test run has completed».
  afterAll(async () => {
    await closeDb();
  });

  it('existen todos los índices del núcleo económico', async () => {
    const db = getDb();
    const res = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const existentes = new Set(
      (res.rows as { indexname: string }[]).map((r) => r.indexname),
    );
    const faltan = INDICES_ESPERADOS.filter((n) => !existentes.has(n));
    expect(faltan).toEqual([]);
  });
});
