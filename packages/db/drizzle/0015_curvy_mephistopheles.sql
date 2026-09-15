CREATE TYPE "public"."change_order_estado" AS ENUM('borrador', 'enviado_df', 'aprobado', 'rechazado');--> statement-breakpoint
CREATE TYPE "public"."change_order_tipo" AS ENUM('contradictorio', 'modificado');--> statement-breakpoint
CREATE TYPE "public"."esg_categoria" AS ENUM('combustible', 'energia', 'agua', 'material', 'residuo');--> statement-breakpoint
CREATE TYPE "public"."iot_alerta_estado" AS ENUM('abierta', 'reconocida', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."iot_alerta_gravedad" AS ENUM('leve', 'grave', 'critica');--> statement-breakpoint
CREATE TYPE "public"."iot_alerta_tipo" AS ENUM('averia', 'anomalia_telemetria', 'mantenimiento_vencido');--> statement-breakpoint
CREATE TYPE "public"."portal_submission_estado" AS ENUM('pendiente_revision', 'aceptada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."signature_entity_tipo" AS ENUM('parte_diario', 'acta_recepcion', 'contrato_obra', 'entrega_epi', 'otro');--> statement-breakpoint
CREATE TYPE "public"."signature_estado" AS ENUM('pendiente', 'completada', 'cancelada', 'expirada');--> statement-breakpoint
CREATE TYPE "public"."signer_estado" AS ENUM('pendiente', 'firmado', 'rechazado');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'subcontrata';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'cliente';--> statement-breakpoint
CREATE TABLE "change_order_lineas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_order_id" uuid NOT NULL,
	"budget_item_id" uuid,
	"descripcion" text NOT NULL,
	"unidad" text NOT NULL,
	"cantidad" numeric(14, 4) NOT NULL,
	"precio_unitario" numeric(14, 4) NOT NULL,
	"importe" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"seq" integer NOT NULL,
	"numero" text NOT NULL,
	"tipo" "change_order_tipo" DEFAULT 'contradictorio' NOT NULL,
	"estado" "change_order_estado" DEFAULT 'borrador' NOT NULL,
	"titulo" text NOT NULL,
	"descripcion" text NOT NULL,
	"motivo" text,
	"direccion_facultativa_contact_id" uuid,
	"importe_estimado" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"importe_aprobado" numeric(14, 2),
	"document_id" uuid,
	"fecha_envio" timestamp with time zone,
	"fecha_resolucion" timestamp with time zone,
	"comentario_resolucion" text,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_orders_project_id_seq_unique" UNIQUE("project_id","seq")
);
--> statement-breakpoint
CREATE TABLE "esg_factores_emision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"categoria" "esg_categoria" NOT NULL,
	"nombre" text NOT NULL,
	"unidad" text NOT NULL,
	"factor_kg_co2e" numeric(14, 6) NOT NULL,
	"fuente" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esg_registros_emision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"factor_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"cantidad" numeric(14, 4) NOT NULL,
	"emisiones_kg_co2e" numeric(14, 3) NOT NULL,
	"document_id" uuid,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_alertas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"equipo_id" uuid NOT NULL,
	"lectura_id" uuid,
	"tipo" "iot_alerta_tipo" NOT NULL,
	"gravedad" "iot_alerta_gravedad" DEFAULT 'leve' NOT NULL,
	"estado" "iot_alerta_estado" DEFAULT 'abierta' NOT NULL,
	"mensaje" text NOT NULL,
	"reconocida_por_user_id" uuid,
	"cerrada_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_lecturas_telemetria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"equipo_id" uuid NOT NULL,
	"project_id" uuid,
	"capturado_en" timestamp with time zone NOT NULL,
	"horas_uso" numeric(10, 2),
	"km_recorridos" numeric(10, 2),
	"combustible_nivel_pct" numeric(5, 2),
	"temperatura_motor" numeric(6, 2),
	"ubicacion_lat" numeric(9, 6),
	"ubicacion_lng" numeric(9, 6),
	"codigo_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_factura_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"numero_factura_declarado" text NOT NULL,
	"fecha_declarada" date NOT NULL,
	"importe_declarado" numeric(14, 2) NOT NULL,
	"estado" "portal_submission_estado" DEFAULT 'pendiente_revision' NOT NULL,
	"notas" text,
	"revisado_por_user_id" uuid,
	"revisado_at" timestamp with time zone,
	"invoice_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"entity_tipo" "signature_entity_tipo" NOT NULL,
	"entity_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"document_id" uuid,
	"estado" "signature_estado" DEFAULT 'pendiente' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"fecha_limite" date,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_request_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"email" text,
	"rol" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"estado" "signer_estado" DEFAULT 'pendiente' NOT NULL,
	"firmado_at" timestamp with time zone,
	"ip_firma" text,
	"hash_firma" text,
	"motivo_rechazo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "change_order_lineas" ADD CONSTRAINT "change_order_lineas_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_lineas" ADD CONSTRAINT "change_order_lineas_budget_item_id_budget_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_direccion_facultativa_contact_id_contacts_id_fk" FOREIGN KEY ("direccion_facultativa_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_factores_emision" ADD CONSTRAINT "esg_factores_emision_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_registros_emision" ADD CONSTRAINT "esg_registros_emision_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_registros_emision" ADD CONSTRAINT "esg_registros_emision_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_registros_emision" ADD CONSTRAINT "esg_registros_emision_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_registros_emision" ADD CONSTRAINT "esg_registros_emision_factor_id_esg_factores_emision_id_fk" FOREIGN KEY ("factor_id") REFERENCES "public"."esg_factores_emision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_registros_emision" ADD CONSTRAINT "esg_registros_emision_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alertas" ADD CONSTRAINT "iot_alertas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alertas" ADD CONSTRAINT "iot_alertas_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alertas" ADD CONSTRAINT "iot_alertas_lectura_id_iot_lecturas_telemetria_id_fk" FOREIGN KEY ("lectura_id") REFERENCES "public"."iot_lecturas_telemetria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alertas" ADD CONSTRAINT "iot_alertas_reconocida_por_user_id_users_id_fk" FOREIGN KEY ("reconocida_por_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_lecturas_telemetria" ADD CONSTRAINT "iot_lecturas_telemetria_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_lecturas_telemetria" ADD CONSTRAINT "iot_lecturas_telemetria_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_lecturas_telemetria" ADD CONSTRAINT "iot_lecturas_telemetria_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_factura_submissions" ADD CONSTRAINT "portal_factura_submissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_factura_submissions" ADD CONSTRAINT "portal_factura_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_factura_submissions" ADD CONSTRAINT "portal_factura_submissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_factura_submissions" ADD CONSTRAINT "portal_factura_submissions_revisado_por_user_id_users_id_fk" FOREIGN KEY ("revisado_por_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_factura_submissions" ADD CONSTRAINT "portal_factura_submissions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_signature_request_id_signature_requests_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."signature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;