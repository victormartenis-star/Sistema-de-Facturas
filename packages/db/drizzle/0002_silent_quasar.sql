CREATE TYPE "public"."doc_status" AS ENUM('subido', 'procesando', 'extraido', 'validado', 'rechazado', 'error');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('factura_compra', 'factura_venta', 'albaran', 'presupuesto', 'certificacion', 'pedido', 'contrato', 'ticket', 'otro');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"doc_type" "doc_type",
	"status" "doc_status" DEFAULT 'subido' NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_dedupe_idx" ON "documents" USING btree ("company_id","file_sha256") WHERE deleted_at IS NULL;