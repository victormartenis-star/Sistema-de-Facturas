CREATE TYPE "public"."stoppage_attribution" AS ENUM('propiedad', 'direccion_facultativa', 'administracion', 'suministradora', 'fuerza_mayor', 'contratista');--> statement-breakpoint
CREATE TYPE "public"."stoppage_cause" AS ENUM('falta_definicion_proyecto', 'falta_suministro_propiedad', 'impago', 'licencia_o_permiso', 'orden_direccion_facultativa', 'condiciones_meteorologicas', 'otra');--> statement-breakpoint
CREATE TYPE "public"."stoppage_cost_concept" AS ENUM('indirectos', 'medios_auxiliares', 'personal', 'alquileres', 'otros');--> statement-breakpoint
CREATE TABLE "stoppage_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stoppage_id" uuid NOT NULL,
	"concept" "stoppage_cost_concept" NOT NULL,
	"description" text,
	"daily_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stoppages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"stoppage_number" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"cause" "stoppage_cause" NOT NULL,
	"attribution" "stoppage_attribution" NOT NULL,
	"description" text NOT NULL,
	"opened_at" date NOT NULL,
	"opened_by" text,
	"notified_at" date,
	"notified_to" text,
	"claimed_amount" numeric(14, 2),
	"claimed_at" date,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stoppage_costs" ADD CONSTRAINT "stoppage_costs_stoppage_id_stoppages_id_fk" FOREIGN KEY ("stoppage_id") REFERENCES "public"."stoppages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stoppage_costs_stoppage_idx" ON "stoppage_costs" USING btree ("stoppage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stoppages_number_idx" ON "stoppages" USING btree ("company_id","stoppage_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "stoppages_project_idx" ON "stoppages" USING btree ("project_id");