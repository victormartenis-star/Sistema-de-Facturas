CREATE TYPE "public"."rcd_treatment" AS ENUM('valorizacion', 'eliminacion');--> statement-breakpoint
CREATE TABLE "rcd_vales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"ler_code" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'tn' NOT NULL,
	"treatment" "rcd_treatment" DEFAULT 'valorizacion' NOT NULL,
	"manager_contact_id" uuid NOT NULL,
	"ticket_number" text NOT NULL,
	"ticket_date" date NOT NULL,
	"document_id" uuid,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rcd_vales_manager_ticket_unique" UNIQUE("manager_contact_id","ticket_number")
);
--> statement-breakpoint
ALTER TABLE "rcd_vales" ADD CONSTRAINT "rcd_vales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcd_vales" ADD CONSTRAINT "rcd_vales_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcd_vales" ADD CONSTRAINT "rcd_vales_manager_contact_id_contacts_id_fk" FOREIGN KEY ("manager_contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcd_vales" ADD CONSTRAINT "rcd_vales_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;