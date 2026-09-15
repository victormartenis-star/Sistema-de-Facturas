CREATE TYPE "public"."postventa_incident_category" AS ENUM('albanileria', 'fontaneria', 'electricidad', 'carpinteria', 'climatizacion', 'otros');--> statement-breakpoint
CREATE TYPE "public"."postventa_incident_status" AS ENUM('abierta', 'en_reparacion', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."real_estate_payment_status" AS ENUM('previsto', 'cobrado');--> statement-breakpoint
CREATE TYPE "public"."real_estate_reservation_status" AS ENUM('reservada', 'contrato_firmado', 'escriturada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."real_estate_unit_kind" AS ENUM('vivienda', 'local', 'garaje', 'trastero', 'otro');--> statement-breakpoint
CREATE TYPE "public"."real_estate_unit_status" AS ENUM('disponible', 'reservada', 'vendida', 'entregada');--> statement-breakpoint
CREATE TABLE "postventa_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"reported_by_contact_id" uuid,
	"category" "postventa_incident_category" DEFAULT 'otros' NOT NULL,
	"description" text NOT NULL,
	"status" "postventa_incident_status" DEFAULT 'abierta' NOT NULL,
	"reported_at" date NOT NULL,
	"resolved_at" date,
	"warranty_deadline" date,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_estate_key_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"handover_date" date NOT NULL,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_estate_payment_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"concept" text NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" real_estate_payment_status DEFAULT 'previsto' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_estate_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"buyer_contact_id" uuid NOT NULL,
	"status" real_estate_reservation_status DEFAULT 'reservada' NOT NULL,
	"reservation_date" date NOT NULL,
	"agreed_price" numeric(14, 2) NOT NULL,
	"signal_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"contract_date" date,
	"deed_date" date,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_estate_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" real_estate_unit_kind DEFAULT 'vivienda' NOT NULL,
	"surface_m2" numeric(8, 2),
	"sale_price" numeric(14, 2) NOT NULL,
	"status" real_estate_unit_status DEFAULT 'disponible' NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postventa_incidents" ADD CONSTRAINT "postventa_incidents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postventa_incidents" ADD CONSTRAINT "postventa_incidents_unit_id_real_estate_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."real_estate_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postventa_incidents" ADD CONSTRAINT "postventa_incidents_reported_by_contact_id_contacts_id_fk" FOREIGN KEY ("reported_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_key_handovers" ADD CONSTRAINT "real_estate_key_handovers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_key_handovers" ADD CONSTRAINT "real_estate_key_handovers_reservation_id_real_estate_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."real_estate_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_key_handovers" ADD CONSTRAINT "real_estate_key_handovers_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_payment_milestones" ADD CONSTRAINT "real_estate_payment_milestones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_payment_milestones" ADD CONSTRAINT "real_estate_payment_milestones_reservation_id_real_estate_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."real_estate_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_reservations" ADD CONSTRAINT "real_estate_reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_reservations" ADD CONSTRAINT "real_estate_reservations_unit_id_real_estate_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."real_estate_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_reservations" ADD CONSTRAINT "real_estate_reservations_buyer_contact_id_contacts_id_fk" FOREIGN KEY ("buyer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_units" ADD CONSTRAINT "real_estate_units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_units" ADD CONSTRAINT "real_estate_units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "real_estate_key_handovers_reservation_unique" ON "real_estate_key_handovers" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "real_estate_units_project_code_unique" ON "real_estate_units" USING btree ("project_id","code") WHERE deleted_at IS NULL;