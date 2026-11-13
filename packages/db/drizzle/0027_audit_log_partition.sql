-- Fase 16: audit_log es la única tabla realmente append-only y sin techo
-- de crecimiento del esquema (comparada con las demás — todas acotadas por
-- el volumen de negocio de una empresa constructora), y hasta ahora no
-- tenía ni un índice más allá de la PK pese a consultarse siempre por
-- company_id + entity_type/entity_id + orden temporal (AuditService.list()).
--
-- Se particiona por mes (occurred_at) con particionado declarativo nativo
-- de Postgres — pg_partman no está disponible en este entorno (comprobado
-- con `SELECT * FROM pg_available_extensions`), así que el alta de
-- particiones futuras la hace un cron propio (AuditPartitionService, ver
-- apps/api/src/audit/audit-partition.service.ts), no una extensión externa.
--
-- Postgres exige que la clave de partición forme parte de cualquier
-- PK/UNIQUE de la tabla particionada: la PK pasa de (id) a (id, occurred_at).
-- Nada en el esquema referencia audit_log.id por FK (comprobado), así que
-- el cambio de PK no rompe ninguna relación.
--> statement-breakpoint

ALTER TABLE "audit_log" RENAME TO "audit_log_legacy";
--> statement-breakpoint

-- `ALTER TABLE RENAME` no renombra los índices/constraints implícitos de la
-- tabla (siguen llamándose audit_log_pkey, etc.) — hay que liberar esos
-- nombres a mano antes de crear la tabla nueva con ellos.
ALTER TABLE "audit_log_legacy" RENAME CONSTRAINT "audit_log_pkey" TO "audit_log_legacy_pkey";
--> statement-breakpoint

ALTER TABLE "audit_log_legacy" RENAME CONSTRAINT "audit_log_company_id_companies_id_fk" TO "audit_log_legacy_company_id_companies_id_fk";
--> statement-breakpoint

ALTER TABLE "audit_log_legacy" RENAME CONSTRAINT "audit_log_user_id_users_id_fk" TO "audit_log_legacy_user_id_users_id_fk";
--> statement-breakpoint

CREATE TABLE "audit_log" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"company_id" uuid NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(10) NOT NULL,
	"old_data" jsonb,
	"new_data" jsonb,
	"meta" jsonb,
	CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE no action;
--> statement-breakpoint

-- Índice compuesto que resuelve el filtro real de AuditService.list()
-- (company_id + entity_type/entity_id opcionales + orden por occurred_at).
-- Creado sobre la tabla particionada: Postgres lo propaga automáticamente
-- a cada partición, existente o futura.
CREATE INDEX "audit_log_company_entity_occurred_idx" ON "audit_log" ("company_id","entity_type","entity_id","occurred_at" DESC);
--> statement-breakpoint

-- Partición por defecto primero: cualquier fila fuera de los rangos
-- mensuales de abajo cae aquí en vez de rechazar el INSERT. Defensivo,
-- no debe recibir filas en el uso normal.
CREATE TABLE "audit_log_default" PARTITION OF "audit_log" DEFAULT;
--> statement-breakpoint

-- Particiones mensuales desde el mes de la fila más antigua de
-- audit_log_legacy (o el mes actual si la tabla estaba vacía) hasta 2
-- meses vista, para que el INSERT...SELECT de más abajo tenga dónde caer
-- y arranquemos con margen antes de que AuditPartitionService tome el relevo.
DO $$
DECLARE
  start_month date;
  end_month date;
  cursor_month date;
  partition_name text;
BEGIN
  SELECT date_trunc('month', COALESCE(MIN(occurred_at), now()))::date
    INTO start_month FROM "audit_log_legacy";
  end_month := (date_trunc('month', now()) + interval '2 months')::date;
  cursor_month := start_month;
  WHILE cursor_month <= end_month LOOP
    partition_name := 'audit_log_' || to_char(cursor_month, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
      partition_name, cursor_month, (cursor_month + interval '1 month')::date
    );
    cursor_month := (cursor_month + interval '1 month')::date;
  END LOOP;
END $$;
--> statement-breakpoint

INSERT INTO "audit_log" ("id","occurred_at","user_id","company_id","entity_type","entity_id","action","old_data","new_data","meta")
  SELECT "id","occurred_at","user_id","company_id","entity_type","entity_id","action","old_data","new_data","meta"
  FROM "audit_log_legacy";
--> statement-breakpoint

DROP TABLE "audit_log_legacy";
