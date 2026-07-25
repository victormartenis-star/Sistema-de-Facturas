CREATE TYPE "public"."compliance_doc_type" AS ENUM('plan_seguridad', 'seguro_rc', 'certificado_ss', 'certificado_aeat', 'rea', 'itinerario_formativo', 'reconocimiento_medico', 'epi', 'otro');--> statement-breakpoint
CREATE TABLE "compliance_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"valid_until" date NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_compliance_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"doc_type" "compliance_doc_type" NOT NULL,
	"document_id" uuid,
	"issued_at" date,
	"expires_at" date,
	"rejected" boolean DEFAULT false NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "requires_compliance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "compliance_waivers" ADD CONSTRAINT "compliance_waivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_waivers" ADD CONSTRAINT "compliance_waivers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_compliance_docs" ADD CONSTRAINT "contact_compliance_docs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_compliance_docs" ADD CONSTRAINT "contact_compliance_docs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_compliance_docs" ADD CONSTRAINT "contact_compliance_docs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;