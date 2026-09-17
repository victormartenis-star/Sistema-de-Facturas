CREATE TYPE "public"."verifactu_status" AS ENUM('no_generado', 'generado_local', 'enviado', 'error');--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "verifactu_status" "verifactu_status" DEFAULT 'no_generado' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "verifactu_sent_at" timestamp with time zone;