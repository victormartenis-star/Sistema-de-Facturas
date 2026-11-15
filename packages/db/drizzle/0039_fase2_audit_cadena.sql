-- Fase 2 enterprise, bloque 1: cadena hash inmutable de auditoria por empresa.
-- Orden: tabla de cabeceras -> quitar FKs incompatibles con la inmutabilidad ->
-- columnas -> numeracion historica -> NOT NULL -> cabeceras iniciales ->
-- indices -> funciones -> triggers. La numeracion y las cabeceras iniciales
-- van ANTES de los triggers, que las rechazarian.
-- El sellado de hashes de las filas historicas lo hace la aplicacion
-- (apps/api/src/audit/audit-chain.ts): el canonico solo existe en TypeScript.
CREATE TABLE "audit_chain_heads" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"last_sequence_number" bigint DEFAULT 0 NOT NULL,
	"last_entry_hash" char(64) DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_chain_heads_seq_check" CHECK ("audit_chain_heads"."last_sequence_number" >= 0),
	CONSTRAINT "audit_chain_heads_hash_check" CHECK ("audit_chain_heads"."last_entry_hash" IS NULL OR "audit_chain_heads"."last_entry_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "sequence_number" bigint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "previous_hash" char(64);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entry_hash" char(64);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash_version" smallint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "correlation_id" varchar(64);--> statement-breakpoint
UPDATE "audit_log" a
   SET "sequence_number" = n.rn
  FROM (SELECT "id", "occurred_at",
               row_number() OVER (PARTITION BY "company_id" ORDER BY "occurred_at", "id") AS rn
          FROM "audit_log") n
 WHERE a."id" = n."id" AND a."occurred_at" = n."occurred_at";
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "sequence_number" SET NOT NULL;
--> statement-breakpoint
INSERT INTO "audit_chain_heads" ("company_id", "last_sequence_number", "last_entry_hash")
SELECT "company_id", max("sequence_number"), NULL FROM "audit_log" GROUP BY "company_id";
--> statement-breakpoint
ALTER TABLE "audit_chain_heads" ADD CONSTRAINT "audit_chain_heads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_company_seq_unique" ON "audit_log" USING btree ("company_id","sequence_number","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_company_correlation_idx" ON "audit_log" USING btree ("company_id","correlation_id") WHERE "audit_log"."correlation_id" IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION audit_purga_permitida() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_database() LIKE '%\_test'
     AND coalesce(current_setting('erp.audit_purge', true), '') = 'on'
$$;
--> statement-breakpoint
CREATE FUNCTION audit_log_encadenar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  h audit_chain_heads%ROWTYPE;
BEGIN
  IF NEW.entry_hash IS NULL OR NEW.entry_hash !~ '^[0-9a-f]{64}$'
     OR NEW.previous_hash IS NULL OR NEW.previous_hash !~ '^[0-9a-f]{64}$'
     OR NEW.hash_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'audit_log: fila sin hash valido' USING ERRCODE = 'AUD02';
  END IF;
  IF NEW.occurred_at <> date_trunc('milliseconds', NEW.occurred_at) THEN
    RAISE EXCEPTION 'audit_log: occurred_at debe tener precision de milisegundos' USING ERRCODE = 'AUD02';
  END IF;
  INSERT INTO audit_chain_heads (company_id) VALUES (NEW.company_id) ON CONFLICT DO NOTHING;
  SELECT * INTO h FROM audit_chain_heads WHERE company_id = NEW.company_id FOR UPDATE;
  IF h.last_entry_hash IS NULL THEN
    RAISE EXCEPTION 'audit_log: cadena con filas historicas sin sellar' USING ERRCODE = 'AUD03';
  END IF;
  IF NEW.sequence_number <> h.last_sequence_number + 1
     OR NEW.previous_hash <> h.last_entry_hash THEN
    RAISE EXCEPTION 'audit_log: eslabon fuera de secuencia (esperado %, recibido %)',
      h.last_sequence_number + 1, NEW.sequence_number USING ERRCODE = 'AUD02';
  END IF;
  UPDATE audit_chain_heads
     SET last_sequence_number = NEW.sequence_number,
         last_entry_hash = NEW.entry_hash,
         updated_at = now()
   WHERE company_id = NEW.company_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION audit_log_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev char(64);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF audit_purga_permitida() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'audit_log es inmutable: DELETE no permitido' USING ERRCODE = 'AUD01';
  END IF;
  IF OLD.entry_hash IS NULL AND NEW.entry_hash IS NOT NULL
     AND NEW.entry_hash ~ '^[0-9a-f]{64}$'
     AND NEW.hash_version = 1
     AND (to_jsonb(NEW) - 'entry_hash' - 'previous_hash' - 'hash_version')
       = (to_jsonb(OLD) - 'entry_hash' - 'previous_hash' - 'hash_version') THEN
    IF NEW.sequence_number = 1 THEN
      prev := repeat('0', 64);
    ELSE
      SELECT entry_hash INTO prev FROM audit_log
       WHERE company_id = NEW.company_id AND sequence_number = NEW.sequence_number - 1;
    END IF;
    IF prev IS NULL OR NEW.previous_hash IS DISTINCT FROM prev THEN
      RAISE EXCEPTION 'audit_log: sellado fuera de orden' USING ERRCODE = 'AUD02';
    END IF;
    UPDATE audit_chain_heads
       SET last_entry_hash = NEW.entry_hash, updated_at = now()
     WHERE company_id = NEW.company_id
       AND last_sequence_number = NEW.sequence_number
       AND last_entry_hash IS NULL;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log es inmutable: UPDATE no permitido' USING ERRCODE = 'AUD01';
END $$;
--> statement-breakpoint
CREATE FUNCTION audit_bloquear_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF audit_purga_permitida() THEN RETURN NULL; END IF;
  RAISE EXCEPTION '% es inmutable: TRUNCATE no permitido', TG_TABLE_NAME USING ERRCODE = 'AUD01';
END $$;
--> statement-breakpoint
CREATE FUNCTION audit_chain_heads_guardia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_sequence_number <> 0 OR NEW.last_entry_hash IS DISTINCT FROM repeat('0', 64) THEN
      RAISE EXCEPTION 'audit_chain_heads: alta solo en genesis' USING ERRCODE = 'AUD01';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF pg_trigger_depth() < 2 OR NEW.company_id <> OLD.company_id THEN
      RAISE EXCEPTION 'audit_chain_heads: UPDATE directo no permitido' USING ERRCODE = 'AUD01';
    END IF;
    RETURN NEW;
  ELSE
    IF audit_purga_permitida() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'audit_chain_heads: DELETE no permitido' USING ERRCODE = 'AUD01';
  END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_bi_encadenar" BEFORE INSERT ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_encadenar();
--> statement-breakpoint
CREATE TRIGGER "audit_log_bud_inmutable" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_inmutable();
--> statement-breakpoint
CREATE TRIGGER "audit_log_bt_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_bloquear_truncate();
--> statement-breakpoint
DO $$
DECLARE p regclass;
BEGIN
  FOR p IN SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'audit_log'::regclass LOOP
    EXECUTE format(
      'CREATE TRIGGER audit_log_bt_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION audit_bloquear_truncate()', p);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER "audit_chain_heads_biud" BEFORE INSERT OR UPDATE OR DELETE ON "audit_chain_heads"
  FOR EACH ROW EXECUTE FUNCTION audit_chain_heads_guardia();
--> statement-breakpoint
CREATE TRIGGER "audit_chain_heads_bt_truncate" BEFORE TRUNCATE ON "audit_chain_heads"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_bloquear_truncate();
