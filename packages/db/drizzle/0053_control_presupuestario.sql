CREATE TYPE "public"."budget_control_mode" AS ENUM('observacion', 'aviso', 'bloqueo');--> statement-breakpoint
CREATE TABLE "project_budget_controls" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"mode" "budget_control_mode" DEFAULT 'observacion' NOT NULL,
	"tolerance_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"warning_pct" numeric(5, 2) DEFAULT '90' NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budget_controls_pct" CHECK ("project_budget_controls"."tolerance_pct" BETWEEN 0 AND 100 AND "project_budget_controls"."warning_pct" > 0 AND "project_budget_controls"."warning_pct" <= 100)
);
--> statement-breakpoint
ALTER TABLE "project_budget_controls" ADD CONSTRAINT "project_budget_controls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_controls" ADD CONSTRAINT "project_budget_controls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_controls" ADD CONSTRAINT "project_budget_controls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_budget_controls_company_mode_idx" ON "project_budget_controls" USING btree ("company_id","mode");