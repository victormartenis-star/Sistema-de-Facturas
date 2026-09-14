CREATE TYPE "public"."acta_recepcion_estado" AS ENUM('pendiente_firma', 'firmada_sin_reservas', 'firmada_con_reservas');--> statement-breakpoint
CREATE TYPE "public"."acta_recepcion_tipo" AS ENUM('provisional', 'definitiva');--> statement-breakpoint
CREATE TYPE "public"."contrato_obra_estado_firma" AS ENUM('borrador', 'pendiente_firma', 'firmado', 'rescindido');--> statement-breakpoint
CREATE TYPE "public"."contrato_obra_tipo" AS ENUM('subcontrata', 'suministro', 'cliente', 'alquiler', 'servicios', 'otro');--> statement-breakpoint
CREATE TYPE "public"."contrato_subcontrata_status" AS ENUM('borrador', 'activo', 'completado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."documento_prl_status" AS ENUM('vigente', 'proximo_vencimiento', 'vencido', 'rechazado');--> statement-breakpoint
CREATE TYPE "public"."documento_prl_type" AS ENUM('plan_seguridad', 'seguro_rc', 'certificado_ss', 'itinerario_formativo', 'epi', 'otro');--> statement-breakpoint
CREATE TYPE "public"."incidencia_prl_estado" AS ENUM('abierta', 'en_subsanacion', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."incidencia_prl_gravedad" AS ENUM('leve', 'grave', 'muy_grave');--> statement-breakpoint
CREATE TYPE "public"."permiso_status" AS ENUM('solicitado', 'en_tramite', 'concedido', 'denegado');--> statement-breakpoint
CREATE TYPE "public"."permiso_tipo" AS ENUM('licencia_obra', 'vado', 'ocupacion_via_publica', 'gestion_residuos');--> statement-breakpoint
CREATE TYPE "public"."proveedor_tipo" AS ENUM('proveedor', 'subcontrata');--> statement-breakpoint
CREATE TYPE "public"."repaso_estado" AS ENUM('pendiente', 'subsanado');--> statement-breakpoint
CREATE TABLE "acta_recepcion_repasos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acta_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"responsable" text,
	"fecha_limite" date,
	"estado" "repaso_estado" DEFAULT 'pendiente' NOT NULL,
	"fecha_subsanacion" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actas_recepcion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tipo" "acta_recepcion_tipo" NOT NULL,
	"fecha" date NOT NULL,
	"estado" "acta_recepcion_estado" DEFAULT 'pendiente_firma' NOT NULL,
	"document_id" uuid,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contrato_obra_anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contratos_obra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"tipo" "contrato_obra_tipo" NOT NULL,
	"importe" numeric(14, 2) NOT NULL,
	"fecha_firma" date,
	"document_id" uuid,
	"estado_firma" "contrato_obra_estado_firma" DEFAULT 'borrador' NOT NULL,
	"retencion_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"condiciones_abono" text,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contratos_subcontrata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"proyecto_id" uuid NOT NULL,
	"numero_contrato" text NOT NULL,
	"fecha_inicio" date NOT NULL,
	"fecha_fin_prevista" date NOT NULL,
	"fecha_fin_real" date,
	"importe_total" numeric(14, 2) NOT NULL,
	"importe_ejecutado" numeric(14, 2) DEFAULT '0' NOT NULL,
	"pct_ejecutado" numeric(5, 2) DEFAULT '0' NOT NULL,
	"retencion_garantia_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"status" "contrato_subcontrata_status" DEFAULT 'borrador' NOT NULL,
	"condiciones_especiales" text,
	"firma_fecha" date,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documentos_prl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"doc_type" "documento_prl_type" NOT NULL,
	"numero_expediente" text NOT NULL,
	"fecha_emision" date NOT NULL,
	"fecha_vencimiento" date NOT NULL,
	"status" "documento_prl_status" DEFAULT 'vigente' NOT NULL,
	"document_id" uuid,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidencias_prl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"punto_inspeccion" text NOT NULL,
	"descripcion" text NOT NULL,
	"gravedad" "incidencia_prl_gravedad" DEFAULT 'leve' NOT NULL,
	"estado" "incidencia_prl_estado" DEFAULT 'abierta' NOT NULL,
	"responsable_subsanacion" text,
	"fecha_limite_subsanacion" date,
	"fecha_cierre" date,
	"document_id" uuid,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permisos_publicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tipo" "permiso_tipo" NOT NULL,
	"organismo_publico" text NOT NULL,
	"numero_expediente" text,
	"fecha_solicitud" date NOT NULL,
	"fecha_resolucion" date,
	"fecha_vencimiento" date,
	"status" "permiso_status" DEFAULT 'solicitado' NOT NULL,
	"canon_importe" numeric(12, 2),
	"document_id" uuid,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proveedores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"razon_social" text NOT NULL,
	"cif_nif" text NOT NULL,
	"tipo" "proveedor_tipo" DEFAULT 'proveedor' NOT NULL,
	"categoria_principal" text,
	"pais" text DEFAULT 'ES' NOT NULL,
	"pais_ejecucion" text DEFAULT 'ES' NOT NULL,
	"pais_origen_materiales" text,
	"codigo_externo" text,
	"sede_central" text,
	"contacto_comercial" text,
	"telefono_contacto" text,
	"email_contacto" text,
	"condiciones_pago_dias" integer DEFAULT 30 NOT NULL,
	"retencion_garantia_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acta_recepcion_repasos" ADD CONSTRAINT "acta_recepcion_repasos_acta_id_actas_recepcion_id_fk" FOREIGN KEY ("acta_id") REFERENCES "public"."actas_recepcion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actas_recepcion" ADD CONSTRAINT "actas_recepcion_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actas_recepcion" ADD CONSTRAINT "actas_recepcion_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actas_recepcion" ADD CONSTRAINT "actas_recepcion_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato_obra_anexos" ADD CONSTRAINT "contrato_obra_anexos_contrato_id_contratos_obra_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos_obra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato_obra_anexos" ADD CONSTRAINT "contrato_obra_anexos_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_obra" ADD CONSTRAINT "contratos_obra_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_obra" ADD CONSTRAINT "contratos_obra_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_obra" ADD CONSTRAINT "contratos_obra_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_obra" ADD CONSTRAINT "contratos_obra_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_subcontrata" ADD CONSTRAINT "contratos_subcontrata_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_subcontrata" ADD CONSTRAINT "contratos_subcontrata_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_subcontrata" ADD CONSTRAINT "contratos_subcontrata_proyecto_id_projects_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_prl" ADD CONSTRAINT "documentos_prl_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_prl" ADD CONSTRAINT "documentos_prl_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_prl" ADD CONSTRAINT "documentos_prl_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencias_prl" ADD CONSTRAINT "incidencias_prl_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencias_prl" ADD CONSTRAINT "incidencias_prl_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencias_prl" ADD CONSTRAINT "incidencias_prl_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos_publicos" ADD CONSTRAINT "permisos_publicos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos_publicos" ADD CONSTRAINT "permisos_publicos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos_publicos" ADD CONSTRAINT "permisos_publicos_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contratos_subcontrata_company_numero_unique" ON "contratos_subcontrata" USING btree ("company_id","numero_contrato") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "documentos_prl_proveedor_numero_unique" ON "documentos_prl" USING btree ("proveedor_id","numero_expediente") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "proveedores_company_cif_nif_unique" ON "proveedores" USING btree ("company_id","cif_nif") WHERE deleted_at IS NULL;