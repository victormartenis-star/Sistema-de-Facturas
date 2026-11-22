CREATE TYPE "public"."fiscal_period_status" AS ENUM('abierto', 'cerrado');--> statement-breakpoint
CREATE TYPE "public"."journal_entry_source" AS ENUM('manual', 'factura_venta', 'factura_compra', 'cobro', 'pago', 'anulacion');--> statement-breakpoint
CREATE TYPE "public"."journal_entry_status" AS ENUM('contabilizado', 'anulado');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_type" AS ENUM('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto');--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"status" "fiscal_period_status" DEFAULT 'abierto' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_periods_month_range" CHECK ("fiscal_periods"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"entry_date" date NOT NULL,
	"description" varchar(240) NOT NULL,
	"source" "journal_entry_source" NOT NULL,
	"source_id" uuid,
	"status" "journal_entry_status" DEFAULT 'contabilizado' NOT NULL,
	"reversed_by_id" uuid,
	"reverses_id" uuid,
	"reversal_reason" varchar(240),
	"total_amount" numeric(14, 2) NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_source_id_coherence" CHECK (("journal_entries"."source" = 'manual') = ("journal_entries"."source_id" IS NULL) OR "journal_entries"."source" = 'anulacion')
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"project_id" uuid,
	"description" varchar(240),
	CONSTRAINT "journal_entry_lines_un_lado" CHECK ("journal_entry_lines"."debit" >= 0 AND "journal_entry_lines"."credit" >= 0 AND ("journal_entry_lines"."debit" > 0) <> ("journal_entry_lines"."credit" > 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"postable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_digits" CHECK ("ledger_accounts"."code" ~ '^[0-9]{3,12}$')
);
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_id_journal_entries_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_id_journal_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_company_year_month_unique" ON "fiscal_periods" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_year_number_unique" ON "journal_entries" USING btree ("company_id","fiscal_year","number");--> statement-breakpoint
CREATE INDEX "journal_entries_company_date_idx" ON "journal_entries" USING btree ("company_id","entry_date","number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_source_vivo_unique" ON "journal_entries" USING btree ("company_id","source","source_id") WHERE source_id IS NOT NULL AND status = 'contabilizado' AND reverses_id IS NULL;--> statement-breakpoint
CREATE INDEX "journal_entry_lines_entry_idx" ON "journal_entry_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_company_account_idx" ON "journal_entry_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_company_project_idx" ON "journal_entry_lines" USING btree ("company_id","project_id") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_company_code_unique" ON "ledger_accounts" USING btree ("company_id","code");--> statement-breakpoint
-- Garantías contables en la base (no las genera drizzle-kit).
-- 1) Cuadre: al confirmar la transacción, cada asiento tocado tiene al menos
--    dos líneas y Σ debe = Σ haber. Diferido para permitir insertar cabecera
--    y líneas en la misma transacción.
CREATE OR REPLACE FUNCTION erp_asiento_cuadrado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entry uuid;
  v_lineas integer;
  v_debe numeric;
  v_haber numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry := NEW.id;
  ELSE
    v_entry := NEW.entry_id;
  END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    INTO v_lineas, v_debe, v_haber
    FROM journal_entry_lines WHERE entry_id = v_entry;
  IF v_lineas < 2 THEN
    RAISE EXCEPTION 'Asiento % sin al menos dos líneas', v_entry
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_debe <> v_haber THEN
    RAISE EXCEPTION 'Asiento % descuadrado: debe % <> haber %', v_entry, v_debe, v_haber
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_cuadre
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION erp_asiento_cuadrado();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entry_lines_cuadre
  AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION erp_asiento_cuadrado();
--> statement-breakpoint
-- 2) Inmutabilidad: las líneas no se modifican ni se borran; del asiento solo
--    cambia el paso a 'anulado' (con su contra-asiento) y la versión.
CREATE OR REPLACE FUNCTION erp_asiento_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'journal_entry_lines' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los asientos contabilizados son inmutables: corrígelos con un contra-asiento'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'anulado'
     OR NEW.status <> 'anulado'
     OR NEW.reversed_by_id IS NULL
     OR (NEW.id, NEW.company_id, NEW.number, NEW.fiscal_year, NEW.entry_date,
         NEW.description, NEW.source, NEW.source_id, NEW.reverses_id,
         NEW.total_amount, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.company_id, OLD.number, OLD.fiscal_year, OLD.entry_date,
         OLD.description, OLD.source, OLD.source_id, OLD.reverses_id,
         OLD.total_amount, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Los asientos contabilizados son inmutables: solo se anulan con un contra-asiento'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_lines_inmutable
  BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION erp_asiento_inmutable();
--> statement-breakpoint
CREATE TRIGGER journal_entries_inmutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION erp_asiento_inmutable();
