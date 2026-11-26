CREATE TYPE "public"."orden_trabajo_estado" AS ENUM('abierta', 'planificada', 'en_curso', 'cerrada', 'cancelada');--> statement-breakpoint
CREATE TABLE "equipo_asignaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"equipo_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"desde" date NOT NULL,
	"hasta" date,
	"notas" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipo_asignaciones_fechas" CHECK ("equipo_asignaciones"."hasta" IS NULL OR "equipo_asignaciones"."hasta" >= "equipo_asignaciones"."desde")
);
--> statement-breakpoint
CREATE TABLE "equipo_lecturas_contador" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"equipo_id" uuid NOT NULL,
	"tipo" varchar(5) NOT NULL,
	"fecha" date NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"anterior" numeric(12, 2),
	"origen" varchar(12) NOT NULL,
	"motivo" varchar(240),
	"orden_trabajo_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipo_lecturas_valores" CHECK ("equipo_lecturas_contador"."tipo" IN ('horas', 'km') AND "equipo_lecturas_contador"."valor" >= 0 AND "equipo_lecturas_contador"."origen" IN ('manual', 'orden', 'correccion') AND ("equipo_lecturas_contador"."origen" <> 'correccion' OR "equipo_lecturas_contador"."motivo" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ordenes_trabajo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"numero" varchar(20) NOT NULL,
	"equipo_id" uuid NOT NULL,
	"plan_id" uuid,
	"tipo" varchar(12) NOT NULL,
	"prioridad" varchar(8) DEFAULT 'media' NOT NULL,
	"status" "orden_trabajo_estado" DEFAULT 'abierta' NOT NULL,
	"project_id" uuid,
	"descripcion" text NOT NULL,
	"fecha_aviso" date NOT NULL,
	"fecha_planificada" date,
	"inicio" date,
	"fin" date,
	"horas_parada" numeric(10, 2) DEFAULT '0' NOT NULL,
	"horas_mano_obra" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tarifa_mano_obra" numeric(10, 2) DEFAULT '0' NOT NULL,
	"coste_mano_obra" numeric(14, 2) DEFAULT '0' NOT NULL,
	"coste_repuestos" numeric(14, 2) DEFAULT '0' NOT NULL,
	"coste_externo" numeric(14, 2) DEFAULT '0' NOT NULL,
	"coste_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"proveedor_id" uuid,
	"lectura_horas" numeric(12, 2),
	"lectura_km" numeric(12, 2),
	"notas_cierre" text,
	"motivo_cancelacion" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordenes_trabajo_valores" CHECK ("ordenes_trabajo"."tipo" IN ('preventiva', 'correctiva', 'itv', 'revision') AND "ordenes_trabajo"."prioridad" IN ('baja', 'media', 'alta', 'urgente') AND "ordenes_trabajo"."horas_parada" >= 0 AND "ordenes_trabajo"."horas_mano_obra" >= 0 AND "ordenes_trabajo"."tarifa_mano_obra" >= 0 AND "ordenes_trabajo"."coste_mano_obra" >= 0 AND "ordenes_trabajo"."coste_repuestos" >= 0 AND "ordenes_trabajo"."coste_externo" >= 0 AND "ordenes_trabajo"."coste_total" = "ordenes_trabajo"."coste_mano_obra" + "ordenes_trabajo"."coste_repuestos" + "ordenes_trabajo"."coste_externo" AND ("ordenes_trabajo"."fin" IS NULL OR "ordenes_trabajo"."inicio" IS NULL OR "ordenes_trabajo"."fin" >= "ordenes_trabajo"."inicio") AND ("ordenes_trabajo"."status" <> 'cerrada' OR ("ordenes_trabajo"."inicio" IS NOT NULL AND "ordenes_trabajo"."fin" IS NOT NULL)) AND ("ordenes_trabajo"."status" <> 'cancelada' OR "ordenes_trabajo"."motivo_cancelacion" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "planes_mantenimiento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"equipo_id" uuid NOT NULL,
	"nombre" varchar(120) NOT NULL,
	"tipo" varchar(12) DEFAULT 'preventiva' NOT NULL,
	"periodicidad_dias" integer,
	"intervalo_horas" numeric(10, 2),
	"intervalo_km" numeric(12, 2),
	"aviso_dias" integer DEFAULT 15 NOT NULL,
	"aviso_horas" numeric(10, 2) DEFAULT '25' NOT NULL,
	"aviso_km" numeric(12, 2) DEFAULT '500' NOT NULL,
	"ultima_fecha" date,
	"ultima_horas" numeric(12, 2),
	"ultima_km" numeric(12, 2),
	"activo" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planes_mantenimiento_intervalos" CHECK ("planes_mantenimiento"."tipo" IN ('preventiva', 'itv', 'revision') AND ("planes_mantenimiento"."periodicidad_dias" IS NOT NULL OR "planes_mantenimiento"."intervalo_horas" IS NOT NULL OR "planes_mantenimiento"."intervalo_km" IS NOT NULL) AND coalesce("planes_mantenimiento"."periodicidad_dias", 1) > 0 AND coalesce("planes_mantenimiento"."intervalo_horas", 1) > 0 AND coalesce("planes_mantenimiento"."intervalo_km", 1) > 0)
);
--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "codigo" varchar(30);--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "numero_serie" varchar(60);--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "padre_id" uuid;--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "contador_horas" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "contador_km" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "contador_fecha" date;--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mantenimientos_equipo" ADD COLUMN "orden_trabajo_id" uuid;--> statement-breakpoint
ALTER TABLE "equipo_asignaciones" ADD CONSTRAINT "equipo_asignaciones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipo_asignaciones" ADD CONSTRAINT "equipo_asignaciones_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipo_asignaciones" ADD CONSTRAINT "equipo_asignaciones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipo_asignaciones" ADD CONSTRAINT "equipo_asignaciones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipo_lecturas_contador" ADD CONSTRAINT "equipo_lecturas_contador_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipo_lecturas_contador" ADD CONSTRAINT "equipo_lecturas_contador_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipo_lecturas_contador" ADD CONSTRAINT "equipo_lecturas_contador_orden_trabajo_id_ordenes_trabajo_id_fk" FOREIGN KEY ("orden_trabajo_id") REFERENCES "public"."ordenes_trabajo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipo_lecturas_contador" ADD CONSTRAINT "equipo_lecturas_contador_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_plan_id_planes_mantenimiento_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."planes_mantenimiento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planes_mantenimiento" ADD CONSTRAINT "planes_mantenimiento_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planes_mantenimiento" ADD CONSTRAINT "planes_mantenimiento_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planes_mantenimiento" ADD CONSTRAINT "planes_mantenimiento_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipo_asignaciones_company_equipo_idx" ON "equipo_asignaciones" USING btree ("company_id","equipo_id","desde");--> statement-breakpoint
CREATE INDEX "equipo_asignaciones_company_project_idx" ON "equipo_asignaciones" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "equipo_lecturas_company_equipo_idx" ON "equipo_lecturas_contador" USING btree ("company_id","equipo_id","tipo","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "ordenes_trabajo_company_numero_unique" ON "ordenes_trabajo" USING btree ("company_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "ordenes_trabajo_plan_viva_unique" ON "ordenes_trabajo" USING btree ("plan_id") WHERE "ordenes_trabajo"."plan_id" IS NOT NULL AND "ordenes_trabajo"."status" IN ('abierta', 'planificada', 'en_curso');--> statement-breakpoint
CREATE INDEX "ordenes_trabajo_company_equipo_idx" ON "ordenes_trabajo" USING btree ("company_id","equipo_id","status");--> statement-breakpoint
CREATE INDEX "ordenes_trabajo_company_project_idx" ON "ordenes_trabajo" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "planes_mantenimiento_company_equipo_idx" ON "planes_mantenimiento" USING btree ("company_id","equipo_id");--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_padre_id_equipos_id_fk" FOREIGN KEY ("padre_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mantenimientos_equipo" ADD CONSTRAINT "mantenimientos_equipo_orden_trabajo_id_ordenes_trabajo_id_fk" FOREIGN KEY ("orden_trabajo_id") REFERENCES "public"."ordenes_trabajo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipos_company_codigo_unique" ON "equipos" USING btree ("company_id","codigo") WHERE "equipos"."codigo" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "equipos_company_padre_idx" ON "equipos" USING btree ("company_id","padre_id");--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_eam" CHECK ("equipos"."contador_horas" >= 0 AND "equipos"."contador_km" >= 0 AND ("equipos"."padre_id" IS NULL OR "equipos"."padre_id" <> "equipos"."id"));