CREATE TYPE "public"."consolidation_fx_rate_type" AS ENUM('cierre', 'medio', 'historico');--> statement-breakpoint
ALTER TYPE "public"."consolidation_method" ADD VALUE 'puesta_equivalencia';--> statement-breakpoint
CREATE TABLE "consolidation_fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"rate_type" "consolidation_fx_rate_type" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consolidation_fx_rates_valores" CHECK ("consolidation_fx_rates"."rate" > 0 AND "consolidation_fx_rates"."currency" ~ '^[A-Z]{3}$' AND "consolidation_fx_rates"."valid_to" >= "consolidation_fx_rates"."valid_from"),
	CONSTRAINT "consolidation_fx_rates_fecha_unica" CHECK ("consolidation_fx_rates"."rate_type" = 'medio' OR "consolidation_fx_rates"."valid_from" = "consolidation_fx_rates"."valid_to")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "functional_currency" char(3) DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "created_by_company_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_group_members" ADD COLUMN "acquisition_date" date;--> statement-breakpoint
ALTER TABLE "corporate_group_members" ADD COLUMN "investment_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "corporate_group_members" ADD COLUMN "investment_account" varchar(10);--> statement-breakpoint
ALTER TABLE "corporate_group_members" ADD COLUMN "equity_at_acquisition" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "consolidation_fx_rates" ADD CONSTRAINT "consolidation_fx_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_fx_rates" ADD CONSTRAINT "consolidation_fx_rates_group_id_corporate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."corporate_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_fx_rates" ADD CONSTRAINT "consolidation_fx_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consolidation_fx_rates_unique" ON "consolidation_fx_rates" USING btree ("group_id","currency","rate_type","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "consolidation_fx_rates_company_group_idx" ON "consolidation_fx_rates" USING btree ("company_id","group_id","currency");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_company_id_companies_id_fk" FOREIGN KEY ("created_by_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_created_by_company_idx" ON "companies" USING btree ("created_by_company_id");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_functional_currency" CHECK ("companies"."functional_currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "corporate_group_members" ADD CONSTRAINT "corporate_group_members_inversion" CHECK (("corporate_group_members"."investment_cost" IS NULL) = ("corporate_group_members"."investment_account" IS NULL)
        AND ("corporate_group_members"."investment_cost" IS NULL OR "corporate_group_members"."investment_cost" >= 0)
        AND ("corporate_group_members"."investment_account" IS NULL OR "corporate_group_members"."investment_account" ~ '^2[0-9]{3,9}$'));