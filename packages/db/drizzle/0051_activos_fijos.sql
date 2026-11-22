CREATE TYPE "public"."fixed_asset_category" AS ENUM('maquinaria', 'transporte', 'utillaje', 'instalaciones', 'informatica', 'otros');--> statement-breakpoint
CREATE TYPE "public"."fixed_asset_status" AS ENUM('activo', 'baja');--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'amortizacion';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'baja_inmovilizado';--> statement-breakpoint
CREATE TABLE "fixed_asset_depreciations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_asset_depreciations_mes" CHECK ("fixed_asset_depreciations"."month" BETWEEN 1 AND 12 AND "fixed_asset_depreciations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" "fixed_asset_category" NOT NULL,
	"equipo_id" uuid,
	"project_id" uuid,
	"acquisition_date" date NOT NULL,
	"start_date" date NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"residual_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"useful_life_months" integer NOT NULL,
	"status" "fixed_asset_status" DEFAULT 'activo' NOT NULL,
	"disposal_date" date,
	"disposal_amount" numeric(14, 2),
	"disposal_reason" varchar(240),
	"disposal_entry_id" uuid,
	"notes" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_assets_importes" CHECK ("fixed_assets"."cost" > 0 AND "fixed_assets"."residual_value" >= 0 AND "fixed_assets"."residual_value" <= "fixed_assets"."cost" AND "fixed_assets"."useful_life_months" > 0),
	CONSTRAINT "fixed_assets_fechas" CHECK ("fixed_assets"."start_date" >= "fixed_assets"."acquisition_date"),
	CONSTRAINT "fixed_assets_baja_coherencia" CHECK (("fixed_assets"."status" = 'baja') = ("fixed_assets"."disposal_date" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_entry_id_journal_entries_id_fk" FOREIGN KEY ("disposal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_depreciations_asset_period_unique" ON "fixed_asset_depreciations" USING btree ("asset_id","year","month");--> statement-breakpoint
CREATE INDEX "fixed_asset_depreciations_company_period_idx" ON "fixed_asset_depreciations" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_company_code_unique" ON "fixed_assets" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_equipo_unique" ON "fixed_assets" USING btree ("equipo_id") WHERE equipo_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fixed_assets_company_status_idx" ON "fixed_assets" USING btree ("company_id","status");