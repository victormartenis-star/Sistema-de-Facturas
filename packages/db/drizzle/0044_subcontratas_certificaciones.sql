CREATE TYPE "public"."cert_subcontrata_status" AS ENUM('borrador', 'aprobada', 'pagada', 'anulada');--> statement-breakpoint
CREATE TABLE "certificaciones_subcontrata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contrato_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"fecha" date NOT NULL,
	"periodo_desde" date NOT NULL,
	"periodo_hasta" date NOT NULL,
	"importe_origen" numeric(14, 2) NOT NULL,
	"importe_anterior" numeric(14, 2) NOT NULL,
	"importe_periodo" numeric(14, 2) NOT NULL,
	"retencion_pct" numeric(5, 2) NOT NULL,
	"retencion_importe" numeric(14, 2) NOT NULL,
	"importe_liquido" numeric(14, 2) NOT NULL,
	"status" "cert_subcontrata_status" DEFAULT 'borrador' NOT NULL,
	"aprobada_at" timestamp with time zone,
	"fecha_pago" date,
	"anulada_at" timestamp with time zone,
	"motivo_anulacion" text,
	"notas" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cert_subcontrata_numero_check" CHECK ("certificaciones_subcontrata"."numero" >= 1),
	CONSTRAINT "cert_subcontrata_periodo_check" CHECK ("certificaciones_subcontrata"."periodo_desde" <= "certificaciones_subcontrata"."periodo_hasta"),
	CONSTRAINT "cert_subcontrata_importes_check" CHECK ("certificaciones_subcontrata"."importe_origen" >= 0 AND "certificaciones_subcontrata"."importe_anterior" >= 0 AND "certificaciones_subcontrata"."importe_periodo" > 0 AND "certificaciones_subcontrata"."importe_periodo" = "certificaciones_subcontrata"."importe_origen" - "certificaciones_subcontrata"."importe_anterior"),
	CONSTRAINT "cert_subcontrata_retencion_check" CHECK ("certificaciones_subcontrata"."retencion_pct" BETWEEN 0 AND 50 AND "certificaciones_subcontrata"."retencion_importe" >= 0 AND "certificaciones_subcontrata"."importe_liquido" = "certificaciones_subcontrata"."importe_periodo" - "certificaciones_subcontrata"."retencion_importe"),
	CONSTRAINT "cert_subcontrata_estado_check" CHECK (("certificaciones_subcontrata"."status" NOT IN ('aprobada', 'pagada') OR "certificaciones_subcontrata"."aprobada_at" IS NOT NULL) AND ("certificaciones_subcontrata"."status" <> 'borrador' OR "certificaciones_subcontrata"."aprobada_at" IS NULL) AND ("certificaciones_subcontrata"."status" = 'pagada') = ("certificaciones_subcontrata"."fecha_pago" IS NOT NULL) AND ("certificaciones_subcontrata"."status" = 'anulada') = ("certificaciones_subcontrata"."anulada_at" IS NOT NULL AND "certificaciones_subcontrata"."motivo_anulacion" IS NOT NULL)),
	CONSTRAINT "cert_subcontrata_version_check" CHECK ("certificaciones_subcontrata"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "devoluciones_garantia_subcontrata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contrato_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"importe" numeric(14, 2) NOT NULL,
	"motivo" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devoluciones_garantia_importe_check" CHECK ("devoluciones_garantia_subcontrata"."importe" > 0)
);
--> statement-breakpoint
ALTER TABLE "certificaciones_subcontrata" ADD CONSTRAINT "certificaciones_subcontrata_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificaciones_subcontrata" ADD CONSTRAINT "certificaciones_subcontrata_contrato_id_contratos_subcontrata_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos_subcontrata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devoluciones_garantia_subcontrata" ADD CONSTRAINT "devoluciones_garantia_subcontrata_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devoluciones_garantia_subcontrata" ADD CONSTRAINT "devoluciones_garantia_subcontrata_contrato_id_contratos_subcontrata_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos_subcontrata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devoluciones_garantia_subcontrata" ADD CONSTRAINT "devoluciones_garantia_subcontrata_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cert_subcontrata_contrato_numero_unique" ON "certificaciones_subcontrata" USING btree ("contrato_id","numero") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cert_subcontrata_un_borrador_unique" ON "certificaciones_subcontrata" USING btree ("contrato_id") WHERE status = 'borrador' AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "cert_subcontrata_company_contrato_idx" ON "certificaciones_subcontrata" USING btree ("company_id","contrato_id","numero");--> statement-breakpoint
CREATE INDEX "devoluciones_garantia_company_contrato_idx" ON "devoluciones_garantia_subcontrata" USING btree ("company_id","contrato_id");