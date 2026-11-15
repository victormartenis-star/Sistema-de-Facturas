import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Índices de los listados (migración 0040_fase2_indices_listados). Cada uno
 * sirve a una consulta real de un listado; el orden `DESC` es `NULLS FIRST`
 * (el predeterminado de `ORDER BY ... DESC`), si no el planificador no los
 * usa para ordenar.
 */
const INDICES_LISTADOS = {
  invoices_company_issue_date_idx: ['invoices', 'invoices.service list()'],
  certifications_company_project_seq_idx: ['certifications', 'list()'],
  certifications_company_status_idx: ['certifications', 'list(status)'],
  purchase_orders_company_order_date_idx: ['purchase_orders', 'list()'],
  purchase_orders_company_status_idx: ['purchase_orders', 'list(status)'],
  delivery_notes_company_note_date_idx: ['delivery_notes', 'list()'],
  delivery_notes_company_status_idx: ['delivery_notes', 'list(status)'],
  change_orders_company_created_idx: ['change_orders', 'list()'],
} as const;

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

  it('existen los índices de listados (0040), parciales por deleted_at y con orden DESC NULLS FIRST', async () => {
    const db = getDb();
    const res = await db.execute(
      sql`SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const filas = res.rows as {
      indexname: string;
      tablename: string;
      indexdef: string;
    }[];
    const porNombre = new Map(filas.map((r) => [r.indexname, r]));
    for (const [nombre, [tabla]] of Object.entries(INDICES_LISTADOS)) {
      const fila = porNombre.get(nombre);
      expect(fila?.tablename).toBe(tabla);
      expect(fila?.indexdef).toContain('WHERE (deleted_at IS NULL)');
      expect(fila?.indexdef).toContain('(company_id');
      // Si hay orden descendente, debe ser el predeterminado (NULLS FIRST).
      expect(fila?.indexdef).not.toContain('NULLS LAST');
    }
  });

  it('la migración 0040 es posterior a la 0039 en el diario y tiene su snapshot', () => {
    const dir = join(__dirname, '../../../../packages/db/drizzle');
    const journal = JSON.parse(
      readFileSync(join(dir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; when: number; tag: string }[] };
    const e39 = journal.entries.find((e) => e.idx === 39);
    const e40 = journal.entries.find((e) => e.idx === 40);
    expect(e40?.tag).toBe('0040_fase2_indices_listados');
    expect(e40!.when).toBeGreaterThan(e39!.when);
    expect(() =>
      readFileSync(join(dir, 'meta/0040_snapshot.json'), 'utf8'),
    ).not.toThrow();
  });
});
