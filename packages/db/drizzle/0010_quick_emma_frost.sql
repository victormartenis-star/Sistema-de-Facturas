CREATE TYPE "public"."permit_kind" AS ENUM('licencia_obra', 'licencia_cala', 'ocupacion_via_publica', 'acometida_agua_provisional', 'acometida_agua', 'acometida_electrica_provisional', 'acometida_electrica', 'potencia_definitiva', 'tasas_avales', 'licencia_primera_ocupacion', 'otro');--> statement-breakpoint
CREATE TABLE "permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "permit_kind" NOT NULL,
	"counterparty" text,
	"reference" text,
	"requested_at" date,
	"committed_at" date,
	"granted_at" date,
	"needed_by" date,
	"cost" numeric(14, 2),
	"not_applicable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;