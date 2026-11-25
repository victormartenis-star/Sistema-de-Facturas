CREATE TYPE "public"."fiscal_year_closing_status" AS ENUM('cerrado', 'revertido');--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'regularizacion_ejercicio';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'cierre_ejercicio';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'apertura_ejercicio';--> statement-breakpoint
CREATE TABLE "bank_guarantee_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issuer" varchar(120) NOT NULL,
	"limit_amount" numeric(14, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expiry_date" date,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_guarantee_lines_limite" CHECK ("bank_guarantee_lines"."limit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_year_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"status" "fiscal_year_closing_status" DEFAULT 'cerrado' NOT NULL,
	"income" numeric(14, 2) NOT NULL,
	"expenses" numeric(14, 2) NOT NULL,
	"result" numeric(14, 2) NOT NULL,
	"regularization_entry_id" uuid,
	"closing_entry_id" uuid,
	"opening_entry_id" uuid,
	"closed_months" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversal_reason" varchar(240),
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_year_closings_cuadre" CHECK ("fiscal_year_closings"."year" BETWEEN 2000 AND 2100 AND "fiscal_year_closings"."result" = "fiscal_year_closings"."income" - "fiscal_year_closings"."expenses"),
	CONSTRAINT "fiscal_year_closings_reversion" CHECK (("fiscal_year_closings"."status" = 'revertido') = ("fiscal_year_closings"."reversal_reason" IS NOT NULL AND "fiscal_year_closings"."reversed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "project_cost_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_date" date NOT NULL,
	"estimated_cost" numeric(14, 2),
	"reason" varchar(240) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_cost_estimates_importe" CHECK ("project_cost_estimates"."version" >= 1 AND ("project_cost_estimates"."estimated_cost" IS NULL OR "project_cost_estimates"."estimated_cost" >= 0))
);
--> statement-breakpoint
ALTER TABLE "bank_guarantee_movements" ADD COLUMN "financed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_guarantee_lines" ADD CONSTRAINT "bank_guarantee_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_regularization_entry_id_journal_entries_id_fk" FOREIGN KEY ("regularization_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_closing_entry_id_journal_entries_id_fk" FOREIGN KEY ("closing_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_opening_entry_id_journal_entries_id_fk" FOREIGN KEY ("opening_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_estimates" ADD CONSTRAINT "project_cost_estimates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_estimates" ADD CONSTRAINT "project_cost_estimates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_estimates" ADD CONSTRAINT "project_cost_estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_guarantee_lines_issuer_unique" ON "bank_guarantee_lines" USING btree ("company_id","issuer");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_year_closings_vigente_unique" ON "fiscal_year_closings" USING btree ("company_id","year") WHERE status = 'cerrado';--> statement-breakpoint
CREATE INDEX "fiscal_year_closings_company_year_idx" ON "fiscal_year_closings" USING btree ("company_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "project_cost_estimates_version_unique" ON "project_cost_estimates" USING btree ("company_id","project_id","version");--> statement-breakpoint
CREATE INDEX "project_cost_estimates_project_date_idx" ON "project_cost_estimates" USING btree ("company_id","project_id","effective_date");