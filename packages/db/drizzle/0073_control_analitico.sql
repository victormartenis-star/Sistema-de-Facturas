CREATE TYPE "public"."allocation_basis" AS ENUM('porcentaje', 'presupuesto', 'produccion', 'horas');--> statement-breakpoint
CREATE TYPE "public"."allocation_cycle_type" AS ENUM('distribucion', 'imputacion');--> statement-breakpoint
CREATE TYPE "public"."allocation_run_status" AS ENUM('contabilizado', 'revertido');--> statement-breakpoint
CREATE TYPE "public"."cost_center_kind" AS ENUM('estructura', 'general', 'apoyo', 'receptor');--> statement-breakpoint
CREATE TYPE "public"."forecast_scenario_kind" AS ENUM('base', 'optimista', 'pesimista', 'personalizado');--> statement-breakpoint
CREATE TABLE "allocation_cycle_receivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"project_id" uuid,
	"cost_center_id" uuid,
	"weight_pct" numeric(9, 4),
	CONSTRAINT "allocation_cycle_receivers_destino" CHECK (("allocation_cycle_receivers"."project_id" IS NULL) <> ("allocation_cycle_receivers"."cost_center_id" IS NULL)
        AND ("allocation_cycle_receivers"."weight_pct" IS NULL OR ("allocation_cycle_receivers"."weight_pct" > 0 AND "allocation_cycle_receivers"."weight_pct" <= 100)))
);
--> statement-breakpoint
CREATE TABLE "allocation_cycle_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" "allocation_cycle_type" NOT NULL,
	"basis" "allocation_basis" NOT NULL,
	"assessment_account" varchar(10),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_cycles_cuenta" CHECK (("allocation_cycles"."type" = 'imputacion') = ("allocation_cycles"."assessment_account" IS NOT NULL)
        AND ("allocation_cycles"."assessment_account" IS NULL OR "allocation_cycles"."assessment_account" ~ '^6[0-9]{2,9}$'))
);
--> statement-breakpoint
CREATE TABLE "allocation_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sender_cost_center_id" uuid NOT NULL,
	"receiver_project_id" uuid,
	"receiver_cost_center_id" uuid,
	"account_code" varchar(10) NOT NULL,
	"base_amount" numeric(14, 2) NOT NULL,
	"weight" numeric(20, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"residue_cents" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "allocation_run_lines_destino" CHECK (("allocation_run_lines"."receiver_project_id" IS NULL) <> ("allocation_run_lines"."receiver_cost_center_id" IS NULL) AND "allocation_run_lines"."weight" >= 0)
);
--> statement-breakpoint
CREATE TABLE "allocation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" "allocation_run_status" DEFAULT 'contabilizado' NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"reverse_reason" varchar(240),
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_runs_periodo" CHECK ("allocation_runs"."period_to" >= "allocation_runs"."period_from"),
	CONSTRAINT "allocation_runs_reversion" CHECK (("allocation_runs"."status" = 'revertido') = ("allocation_runs"."reversed_at" IS NOT NULL AND "allocation_runs"."reverse_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "cost_center_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"account_prefix" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_center_accounts_prefijo" CHECK ("cost_center_accounts"."account_prefix" ~ '^6[0-9]{0,9}$')
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" "cost_center_kind" DEFAULT 'general' NOT NULL,
	"parent_id" uuid,
	"responsible_user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" varchar(500),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_centers_codigo" CHECK ("cost_centers"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$' AND ("cost_centers"."parent_id" IS NULL OR "cost_centers"."parent_id" <> "cost_centers"."id"))
);
--> statement-breakpoint
CREATE TABLE "forecast_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" "forecast_scenario_kind" DEFAULT 'personalizado' NOT NULL,
	"cost_adjust_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"revenue_adjust_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"delay_months" smallint DEFAULT 0 NOT NULL,
	"include_overhead" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_scenarios_supuestos" CHECK ("forecast_scenarios"."cost_adjust_pct" BETWEEN -100 AND 1000 AND "forecast_scenarios"."revenue_adjust_pct" BETWEEN -100 AND 1000
        AND "forecast_scenarios"."delay_months" BETWEEN 0 AND 60)
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"cutoff_date" date NOT NULL,
	"label" varchar(120) NOT NULL,
	"totals" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD COLUMN "cost_center_id" uuid;--> statement-breakpoint
ALTER TABLE "allocation_cycle_receivers" ADD CONSTRAINT "allocation_cycle_receivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycle_receivers" ADD CONSTRAINT "allocation_cycle_receivers_cycle_id_allocation_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."allocation_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycle_receivers" ADD CONSTRAINT "allocation_cycle_receivers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycle_receivers" ADD CONSTRAINT "allocation_cycle_receivers_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycle_senders" ADD CONSTRAINT "allocation_cycle_senders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycle_senders" ADD CONSTRAINT "allocation_cycle_senders_cycle_id_allocation_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."allocation_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycle_senders" ADD CONSTRAINT "allocation_cycle_senders_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycles" ADD CONSTRAINT "allocation_cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cycles" ADD CONSTRAINT "allocation_cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_run_lines" ADD CONSTRAINT "allocation_run_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_run_lines" ADD CONSTRAINT "allocation_run_lines_run_id_allocation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."allocation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_run_lines" ADD CONSTRAINT "allocation_run_lines_sender_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("sender_cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_run_lines" ADD CONSTRAINT "allocation_run_lines_receiver_project_id_projects_id_fk" FOREIGN KEY ("receiver_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_run_lines" ADD CONSTRAINT "allocation_run_lines_receiver_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("receiver_cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_cycle_id_allocation_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."allocation_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_center_accounts" ADD CONSTRAINT "cost_center_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_center_accounts" ADD CONSTRAINT "cost_center_accounts_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_id_cost_centers_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_scenarios" ADD CONSTRAINT "forecast_scenarios_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_scenarios" ADD CONSTRAINT "forecast_scenarios_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_scenario_id_forecast_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."forecast_scenarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_cycle_receivers_obra_unique" ON "allocation_cycle_receivers" USING btree ("cycle_id","project_id") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_cycle_receivers_centro_unique" ON "allocation_cycle_receivers" USING btree ("cycle_id","cost_center_id") WHERE cost_center_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "allocation_cycle_receivers_company_idx" ON "allocation_cycle_receivers" USING btree ("company_id","cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_cycle_senders_unique" ON "allocation_cycle_senders" USING btree ("cycle_id","cost_center_id");--> statement-breakpoint
CREATE INDEX "allocation_cycle_senders_company_idx" ON "allocation_cycle_senders" USING btree ("company_id","cost_center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_cycles_company_code_unique" ON "allocation_cycles" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "allocation_run_lines_run_idx" ON "allocation_run_lines" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "allocation_run_lines_company_project_idx" ON "allocation_run_lines" USING btree ("company_id","receiver_project_id") WHERE receiver_project_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "allocation_run_lines_company_receiver_center_idx" ON "allocation_run_lines" USING btree ("company_id","receiver_cost_center_id") WHERE receiver_cost_center_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "allocation_run_lines_company_sender_idx" ON "allocation_run_lines" USING btree ("company_id","sender_cost_center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_runs_company_seq_unique" ON "allocation_runs" USING btree ("company_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_runs_vigente_unique" ON "allocation_runs" USING btree ("cycle_id","period_from","period_to") WHERE status = 'contabilizado';--> statement-breakpoint
CREATE INDEX "allocation_runs_company_periodo_idx" ON "allocation_runs" USING btree ("company_id","period_from","period_to");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_center_accounts_company_prefix_unique" ON "cost_center_accounts" USING btree ("company_id","account_prefix");--> statement-breakpoint
CREATE INDEX "cost_center_accounts_center_idx" ON "cost_center_accounts" USING btree ("cost_center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_company_code_unique" ON "cost_centers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "cost_centers_company_parent_idx" ON "cost_centers" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_scenarios_company_code_unique" ON "forecast_scenarios" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_company_scenario_idx" ON "forecast_snapshots" USING btree ("company_id","scenario_id","cutoff_date");--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entry_lines_company_cost_center_idx" ON "journal_entry_lines" USING btree ("company_id","cost_center_id") WHERE cost_center_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_obra_o_centro" CHECK ("journal_entry_lines"."project_id" IS NULL OR "journal_entry_lines"."cost_center_id" IS NULL);