CREATE TYPE "public"."trabajador_tipo" AS ENUM('propio', 'subcontratado');--> statement-breakpoint
CREATE TABLE "trabajadores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"documento_identidad" text,
	"category_id" uuid,
	"tipo" "trabajador_tipo" DEFAULT 'propio' NOT NULL,
	"proveedor_id" uuid,
	"ordinary_rate_default" numeric(10, 2),
	"overtime_rate_default" numeric(10, 2),
	"activo" boolean DEFAULT true NOT NULL,
	"fecha_alta" date,
	"fecha_baja" date,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partes_personal" ADD COLUMN "trabajador_id" uuid;--> statement-breakpoint
ALTER TABLE "trabajadores" ADD CONSTRAINT "trabajadores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trabajadores" ADD CONSTRAINT "trabajadores_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trabajadores" ADD CONSTRAINT "trabajadores_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_personal" ADD CONSTRAINT "partes_personal_trabajador_id_trabajadores_id_fk" FOREIGN KEY ("trabajador_id") REFERENCES "public"."trabajadores"("id") ON DELETE set null ON UPDATE no action;