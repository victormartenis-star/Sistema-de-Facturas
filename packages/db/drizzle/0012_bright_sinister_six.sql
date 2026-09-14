ALTER TABLE "invoices" ADD COLUMN "verifactu_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "verifactu_previous_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "verifactu_generated_at" timestamp with time zone;