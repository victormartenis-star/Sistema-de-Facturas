CREATE TYPE "public"."rectification_kind" AS ENUM('total', 'diferencias');--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "rectifies_certification_id" uuid;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "rectification_reason" text;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rectifies_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rectification_kind" "rectification_kind";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rectification_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_rectifies_certification_id_certifications_id_fk" FOREIGN KEY ("rectifies_certification_id") REFERENCES "public"."certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rectifies_invoice_id_invoices_id_fk" FOREIGN KEY ("rectifies_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifications_rectifies_certification_id_idx" ON "certifications" USING btree ("rectifies_certification_id");--> statement-breakpoint
CREATE INDEX "invoices_rectifies_invoice_id_idx" ON "invoices" USING btree ("rectifies_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_rectifies_total_unique" ON "invoices" USING btree ("rectifies_invoice_id") WHERE rectification_kind = 'total' AND deleted_at IS NULL AND status <> 'anulada';--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rectification_coherence" CHECK (("invoices"."rectifies_invoice_id" IS NULL AND "invoices"."rectification_kind" IS NULL AND "invoices"."rectification_reason" IS NULL) OR ("invoices"."rectifies_invoice_id" IS NOT NULL AND "invoices"."rectification_kind" IS NOT NULL AND "invoices"."rectification_reason" IS NOT NULL));