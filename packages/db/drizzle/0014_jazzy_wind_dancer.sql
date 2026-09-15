CREATE TYPE "public"."equipo_estado" AS ENUM('operativo', 'en_mantenimiento', 'averiado', 'baja');--> statement-breakpoint
CREATE TYPE "public"."equipo_tipo" AS ENUM('vehiculo', 'maquina_pesada', 'herramienta', 'otro');--> statement-breakpoint
CREATE TYPE "public"."mantenimiento_tipo" AS ENUM('preventivo', 'correctivo', 'itv');--> statement-breakpoint
CREATE TABLE "equipos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"matricula" text,
	"tipo" "equipo_tipo" DEFAULT 'maquina_pesada' NOT NULL,
	"ownership" "parte_maquinaria_ownership" DEFAULT 'propia' NOT NULL,
	"proveedor_alquiler_id" uuid,
	"estado" "equipo_estado" DEFAULT 'operativo' NOT NULL,
	"fecha_alta" date,
	"fecha_baja" date,
	"notas" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mantenimientos_equipo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"equipo_id" uuid NOT NULL,
	"tipo" "mantenimiento_tipo" DEFAULT 'preventivo' NOT NULL,
	"fecha" date NOT NULL,
	"proveedor_id" uuid,
	"coste" numeric(12, 2),
	"proxima_revision_fecha" date,
	"descripcion" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partes_maquinaria" ADD COLUMN "equipo_id" uuid;--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_proveedor_alquiler_id_proveedores_id_fk" FOREIGN KEY ("proveedor_alquiler_id") REFERENCES "public"."proveedores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mantenimientos_equipo" ADD CONSTRAINT "mantenimientos_equipo_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mantenimientos_equipo" ADD CONSTRAINT "mantenimientos_equipo_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mantenimientos_equipo" ADD CONSTRAINT "mantenimientos_equipo_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partes_maquinaria" ADD CONSTRAINT "partes_maquinaria_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE set null ON UPDATE no action;