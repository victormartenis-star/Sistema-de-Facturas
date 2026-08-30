CREATE TABLE "cost_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"as_of_month" date NOT NULL,
	"pending_to_contract" numeric(14, 2) NOT NULL,
	"notes" text,
	"reported_by" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_monthly_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"month" date NOT NULL,
	"planned_production" numeric(14, 2) DEFAULT '0' NOT NULL,
	"planned_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "target_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "cost_forecasts" ADD CONSTRAINT "cost_forecasts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_forecasts" ADD CONSTRAINT "cost_forecasts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_monthly_plan" ADD CONSTRAINT "project_monthly_plan_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_monthly_plan" ADD CONSTRAINT "project_monthly_plan_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_forecasts_unique" ON "cost_forecasts" USING btree ("project_id","as_of_month") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_monthly_plan_unique" ON "project_monthly_plan" USING btree ("project_id","month") WHERE deleted_at IS NULL;