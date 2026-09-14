CREATE TYPE "public"."comparativo_status" AS ENUM('abierto', 'adjudicado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."parte_maquinaria_ownership" AS ENUM('propia', 'alquilada');--> statement-breakpoint
CREATE TABLE "comparativo_oferta_lineas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oferta_id" uuid NOT NULL,
	"budget_item_id" uuid NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "comparativo_oferta_lineas_oferta_item_unique" UNIQUE("oferta_id","budget_item_id")
);
--> statement-breakpoint
CREATE TABLE "comparativo_ofertas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comparativo_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"lead_time_days" integer,
	"payment_terms" text,
	"is_awarded" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparativo_ofertas_comparativo_contact_unique" UNIQUE("comparativo_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "comparativos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "comparativo_status" DEFAULT 'abierto' NOT NULL,
	"awarded_at" timestamp with time zone,
	"purchase_order_id" uuid,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partes_maquinaria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"machine_name" text NOT NULL,
	"ownership" "parte_maquinaria_ownership" DEFAULT 'propia' NOT NULL,
	"work_date" date NOT NULL,
	"hours_used" numeric(6, 2) DEFAULT '0' NOT NULL,
	"fuel_liters" numeric(8, 2),
	"hourly_rate" numeric(10, 2) NOT NULL,
	"total_cost" numeric(14, 2) NOT NULL,
	"notes" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partes_personal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"worker_name" text NOT NULL,
	"category_id" uuid,
	"work_date" date NOT NULL,
	"ordinary_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"ordinary_rate" numeric(10, 2) NOT NULL,
	"overtime_rate" numeric(10, 2) NOT NULL,
	"total_cost" numeric(14, 2) NOT NULL,
	"notes" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comparativo_oferta_lineas" ADD CONSTRAINT "comparativo_oferta_lineas_oferta_id_comparativo_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "public"."comparativo_ofertas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparativo_oferta_lineas" ADD CONSTRAINT "comparativo_oferta_lineas_budget_item_id_budget_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparativo_ofertas" ADD CONSTRAINT "comparativo_ofertas_comparativo_id_comparativos_id_fk" FOREIGN KEY ("comparativo_id") REFERENCES "public"."comparativos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparativo_ofertas" ADD CONSTRAINT "comparativo_ofertas_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparativos" ADD CONSTRAINT "comparativos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparativos" ADD CONSTRAINT "comparativos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparativos" ADD CONSTRAINT "comparativos_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparativos" ADD CONSTRAINT "comparativos_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_maquinaria" ADD CONSTRAINT "partes_maquinaria_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_maquinaria" ADD CONSTRAINT "partes_maquinaria_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_maquinaria" ADD CONSTRAINT "partes_maquinaria_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_maquinaria" ADD CONSTRAINT "partes_maquinaria_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_personal" ADD CONSTRAINT "partes_personal_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_personal" ADD CONSTRAINT "partes_personal_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_personal" ADD CONSTRAINT "partes_personal_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_personal" ADD CONSTRAINT "partes_personal_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_personal" ADD CONSTRAINT "partes_personal_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comparativo_ofertas_awarded_unique" ON "comparativo_ofertas" USING btree ("comparativo_id") WHERE is_awarded = true;