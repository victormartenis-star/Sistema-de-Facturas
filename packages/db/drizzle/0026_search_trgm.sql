CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_file_name_trgm_idx" ON "documents" USING gin ("file_name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_trgm_idx" ON "invoices" USING gin ("invoice_number" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_notes_trgm_idx" ON "invoices" USING gin ("notes" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_legal_name_trgm_idx" ON "contacts" USING gin ("legal_name" gin_trgm_ops);
