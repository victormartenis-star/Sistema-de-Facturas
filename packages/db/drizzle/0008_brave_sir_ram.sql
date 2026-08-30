CREATE TYPE "public"."variation_kind" AS ENUM('modificado', 'contradictorio', 'exceso_medicion', 'cambio_solucion', 'variacion_calidades', 'eliminacion_partida');--> statement-breakpoint
CREATE TYPE "public"."variation_status" AS ENUM('pendiente', 'aprobado', 'rechazado');--> statement-breakpoint
CREATE TABLE "variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"variation_number" text NOT NULL,
	"kind" "variation_kind" DEFAULT 'modificado' NOT NULL,
	"phase_id" uuid,
	"description" text NOT NULL,
	"sales_variation" numeric(14, 2) NOT NULL,
	"cost_variation" numeric(14, 2) DEFAULT '0' NOT NULL,
	"requested_at" date NOT NULL,
	"df_approved_at" date,
	"owner_approved_at" date,
	"rejected_at" date,
	"rejection_reason" text,
	"status" "variation_status" DEFAULT 'pendiente' NOT NULL,
	"executed" boolean DEFAULT false NOT NULL,
	"client_order_ref" text,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "variations" ADD CONSTRAINT "variations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variations" ADD CONSTRAINT "variations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variations" ADD CONSTRAINT "variations_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "variations_number_unique" ON "variations" USING btree ("company_id","variation_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "variations_project_seq_unique" ON "variations" USING btree ("project_id","seq") WHERE deleted_at IS NULL;