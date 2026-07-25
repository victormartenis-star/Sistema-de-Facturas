CREATE TYPE "public"."cert_status" AS ENUM('borrador', 'facturada');--> statement-breakpoint
CREATE TYPE "public"."delivery_note_status" AS ENUM('pendiente', 'validado', 'facturado');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('compra', 'venta');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('borrador', 'aprobada', 'pagada', 'anulada');--> statement-breakpoint
CREATE TYPE "public"."milestone_direction" AS ENUM('cobro', 'pago');--> statement-breakpoint
CREATE TYPE "public"."milestone_kind" AS ENUM('ordinario', 'retencion');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('previsto', 'pagado');--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"cert_date" date NOT NULL,
	"cumulative_pct" numeric(5, 2) NOT NULL,
	"cumulative_amount" numeric(14, 2) NOT NULL,
	"period_amount" numeric(14, 2) NOT NULL,
	"retention_pct" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"retention_amount" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"status" "cert_status" DEFAULT 'borrador' NOT NULL,
	"invoice_id" uuid,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"project_id" uuid,
	"phase_id" uuid,
	"note_number" text NOT NULL,
	"note_date" date NOT NULL,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"status" "delivery_note_status" DEFAULT 'pendiente' NOT NULL,
	"validated_at" timestamp with time zone,
	"invoice_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"base_amount" numeric(14, 2) NOT NULL,
	"vat_pct" numeric(5, 2) DEFAULT '21.00' NOT NULL,
	"project_id" uuid,
	"phase_id" uuid,
	"category_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"status" "invoice_status" DEFAULT 'borrador' NOT NULL,
	"contact_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"base_amount" numeric(14, 2) NOT NULL,
	"vat_amount" numeric(14, 2) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"isp" boolean DEFAULT false NOT NULL,
	"retention_pct" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"retention_amount" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"retention_release_date" date,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"direction" "milestone_direction" NOT NULL,
	"kind" "milestone_kind" DEFAULT 'ordinario' NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "milestone_status" DEFAULT 'previsto' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"budget_amount" numeric(14, 2),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certifications_project_seq_unique" ON "certifications" USING btree ("project_id","seq") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_notes_contact_number_unique" ON "delivery_notes" USING btree ("company_id","contact_id","note_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_contact_number_unique" ON "invoices" USING btree ("company_id","kind","contact_id","invoice_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_phases_project_code_unique" ON "project_phases" USING btree ("project_id","code") WHERE deleted_at IS NULL;