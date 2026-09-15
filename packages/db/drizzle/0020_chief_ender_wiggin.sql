CREATE TYPE "public"."fichaje_type" AS ENUM('entrada', 'salida');--> statement-breakpoint
CREATE TABLE "fichajes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"worker_name" text NOT NULL,
	"type" "fichaje_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prl_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"worker_name" text NOT NULL,
	"check_date" date NOT NULL,
	"items" jsonb NOT NULL,
	"all_checked" boolean DEFAULT false NOT NULL,
	"notes" text,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fichajes" ADD CONSTRAINT "fichajes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichajes" ADD CONSTRAINT "fichajes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prl_checklists" ADD CONSTRAINT "prl_checklists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prl_checklists" ADD CONSTRAINT "prl_checklists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fichajes_company_client_unique" ON "fichajes" USING btree ("company_id","client_id") WHERE client_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prl_checklists_company_client_unique" ON "prl_checklists" USING btree ("company_id","client_id") WHERE client_id IS NOT NULL;