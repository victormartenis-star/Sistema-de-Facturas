CREATE TYPE "public"."bank_guarantee_direction" AS ENUM('emitido', 'recibido');--> statement-breakpoint
CREATE TYPE "public"."bank_guarantee_movement_type" AS ENUM('alta', 'liberacion', 'ejecucion', 'prorroga', 'comision', 'vencimiento', 'anulacion');--> statement-breakpoint
CREATE TYPE "public"."bank_guarantee_status" AS ENUM('vigente', 'liberado_parcial', 'liberado', 'ejecutado', 'vencido', 'anulado');--> statement-breakpoint
CREATE TYPE "public"."bank_guarantee_type" AS ENUM('garantia_definitiva', 'garantia_provisional', 'anticipo', 'buena_ejecucion', 'oferta_licitacion', 'retencion_garantia', 'otro');--> statement-breakpoint
ALTER TYPE "public"."alert_rule_type" ADD VALUE 'aval';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'aval';--> statement-breakpoint
CREATE TABLE "bank_guarantee_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"guarantee_id" uuid NOT NULL,
	"type" "bank_guarantee_movement_type" NOT NULL,
	"movement_date" date NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"outstanding_after" numeric(14, 2) NOT NULL,
	"expiry_date" date,
	"reason" varchar(240),
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_guarantee_movements_importes" CHECK ("bank_guarantee_movements"."amount" >= 0 AND "bank_guarantee_movements"."outstanding_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bank_guarantees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reference" varchar(60) NOT NULL,
	"type" "bank_guarantee_type" NOT NULL,
	"direction" "bank_guarantee_direction" NOT NULL,
	"issuer" varchar(120) NOT NULL,
	"project_id" uuid,
	"contact_id" uuid,
	"contrato_obra_id" uuid,
	"certification_id" uuid,
	"bank_account_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"released_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"executed_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"outstanding_amount" numeric(14, 2) NOT NULL,
	"commissions_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"issue_date" date NOT NULL,
	"expiry_date" date,
	"commission_rate_pct" numeric(7, 4),
	"commission_period_months" smallint,
	"status" "bank_guarantee_status" DEFAULT 'vigente' NOT NULL,
	"reason" varchar(240),
	"notes" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_guarantees_importes" CHECK ("bank_guarantees"."amount" > 0 AND "bank_guarantees"."released_amount" >= 0 AND "bank_guarantees"."executed_amount" >= 0
        AND "bank_guarantees"."commissions_amount" >= 0
        AND "bank_guarantees"."outstanding_amount" >= 0 AND "bank_guarantees"."outstanding_amount" <= "bank_guarantees"."amount"
        AND "bank_guarantees"."outstanding_amount" = "bank_guarantees"."amount" - "bank_guarantees"."released_amount" - "bank_guarantees"."executed_amount"),
	CONSTRAINT "bank_guarantees_fechas" CHECK ("bank_guarantees"."expiry_date" IS NULL OR "bank_guarantees"."expiry_date" >= "bank_guarantees"."issue_date"),
	CONSTRAINT "bank_guarantees_comision" CHECK (("bank_guarantees"."commission_rate_pct" IS NULL OR ("bank_guarantees"."commission_rate_pct" >= 0 AND "bank_guarantees"."commission_rate_pct" <= 100 AND "bank_guarantees"."direction" = 'emitido'))
        AND ("bank_guarantees"."commission_period_months" IS NULL OR "bank_guarantees"."commission_period_months" BETWEEN 1 AND 12)),
	CONSTRAINT "bank_guarantees_estado_saldo" CHECK (("bank_guarantees"."status" IN ('vigente', 'liberado_parcial', 'anulado')) = ("bank_guarantees"."outstanding_amount" > 0))
);
--> statement-breakpoint
ALTER TABLE "bank_guarantee_movements" ADD CONSTRAINT "bank_guarantee_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_movements" ADD CONSTRAINT "bank_guarantee_movements_guarantee_id_bank_guarantees_id_fk" FOREIGN KEY ("guarantee_id") REFERENCES "public"."bank_guarantees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_movements" ADD CONSTRAINT "bank_guarantee_movements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_movements" ADD CONSTRAINT "bank_guarantee_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_contrato_obra_id_contratos_obra_id_fk" FOREIGN KEY ("contrato_obra_id") REFERENCES "public"."contratos_obra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_certification_id_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_guarantee_movements_guarantee_idx" ON "bank_guarantee_movements" USING btree ("company_id","guarantee_id","movement_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_guarantees_reference_unique" ON "bank_guarantees" USING btree ("company_id","issuer","reference");--> statement-breakpoint
CREATE INDEX "bank_guarantees_company_status_idx" ON "bank_guarantees" USING btree ("company_id","status","expiry_date");--> statement-breakpoint
CREATE INDEX "bank_guarantees_company_project_idx" ON "bank_guarantees" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "bank_guarantees_company_contact_idx" ON "bank_guarantees" USING btree ("company_id","contact_id");