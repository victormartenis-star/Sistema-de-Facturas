CREATE TYPE "public"."stock_movement_type" AS ENUM('entrada_compra', 'salida_obra', 'traspaso', 'regularizacion', 'devolucion');--> statement-breakpoint
CREATE TYPE "public"."warehouse_kind" AS ENUM('central', 'obra');--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'entrada_almacen';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'consumo_obra';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'devolucion_obra';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'regularizacion_inventario';--> statement-breakpoint
CREATE TABLE "stock_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(160) NOT NULL,
	"unit" varchar(10) NOT NULL,
	"inventory_account" varchar(10) DEFAULT '3000' NOT NULL,
	"variation_account" varchar(10) DEFAULT '6100' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_articles_cuentas_pgc" CHECK ("stock_articles"."inventory_account" ~ '^3[0-9]{3,7}$' AND "stock_articles"."variation_account" ~ '^61[0-9]{2,6}$')
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reserved_quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"stock_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"average_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"min_stock" numeric(14, 3) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_items_no_negativo" CHECK ("stock_items"."quantity" >= 0 AND "stock_items"."stock_value" >= 0 AND "stock_items"."average_cost" >= 0 AND "stock_items"."min_stock" >= 0),
	CONSTRAINT "stock_items_reserva" CHECK ("stock_items"."reserved_quantity" >= 0 AND "stock_items"."reserved_quantity" <= "stock_items"."quantity"),
	CONSTRAINT "stock_items_valor_sin_cantidad" CHECK ("stock_items"."quantity" > 0 OR "stock_items"."stock_value" = 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"movement_date" date NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"target_warehouse_id" uuid,
	"article_id" uuid NOT NULL,
	"project_id" uuid,
	"delivery_note_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"total_value" numeric(14, 2) NOT NULL,
	"quantity_after" numeric(14, 3) NOT NULL,
	"average_cost_after" numeric(14, 4) NOT NULL,
	"reason" varchar(240),
	"notes" text,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_signo" CHECK ("stock_movements"."quantity" <> 0 AND "stock_movements"."unit_cost" >= 0 AND (
        ("stock_movements"."type" IN ('entrada_compra', 'devolucion') AND "stock_movements"."quantity" > 0 AND "stock_movements"."total_value" >= 0)
        OR ("stock_movements"."type" IN ('salida_obra', 'traspaso') AND "stock_movements"."quantity" < 0 AND "stock_movements"."total_value" <= 0)
        OR ("stock_movements"."type" = 'regularizacion' AND sign("stock_movements"."total_value") IN (0, sign("stock_movements"."quantity")))
      )),
	CONSTRAINT "stock_movements_referencias" CHECK (("stock_movements"."type" = 'traspaso') = ("stock_movements"."target_warehouse_id" IS NOT NULL)
        AND ("stock_movements"."target_warehouse_id" IS NULL OR "stock_movements"."target_warehouse_id" <> "stock_movements"."warehouse_id")
        AND ("stock_movements"."type" NOT IN ('salida_obra', 'devolucion') OR "stock_movements"."project_id" IS NOT NULL)
        AND ("stock_movements"."delivery_note_id" IS NULL OR "stock_movements"."type" = 'entrada_compra')
        AND ("stock_movements"."type" <> 'regularizacion' OR "stock_movements"."reason" IS NOT NULL)),
	CONSTRAINT "stock_movements_saldo" CHECK ("stock_movements"."quantity_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" "warehouse_kind" NOT NULL,
	"project_id" uuid,
	"address" varchar(240),
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_kind_project" CHECK (("warehouses"."kind" = 'obra') = ("warehouses"."project_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "stock_articles" ADD CONSTRAINT "stock_articles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_article_id_stock_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."stock_articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_target_warehouse_id_warehouses_id_fk" FOREIGN KEY ("target_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_article_id_stock_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."stock_articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "public"."delivery_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_articles_company_code_unique" ON "stock_articles" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_warehouse_article_unique" ON "stock_items" USING btree ("warehouse_id","article_id");--> statement-breakpoint
CREATE INDEX "stock_items_company_article_idx" ON "stock_items" USING btree ("company_id","article_id");--> statement-breakpoint
CREATE INDEX "stock_movements_company_date_idx" ON "stock_movements" USING btree ("company_id","movement_date" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_movements_warehouse_article_idx" ON "stock_movements" USING btree ("warehouse_id","article_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_target_warehouse_idx" ON "stock_movements" USING btree ("target_warehouse_id") WHERE target_warehouse_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_movements_company_project_idx" ON "stock_movements" USING btree ("company_id","project_id","movement_date") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_delivery_note_article_unique" ON "stock_movements" USING btree ("delivery_note_id","article_id") WHERE delivery_note_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_company_code_unique" ON "warehouses" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "warehouses_company_project_idx" ON "warehouses" USING btree ("company_id","project_id");--> statement-breakpoint
-- Kárdex inmutable: un movimiento de stock no se modifica ni se borra; un
-- error se corrige con otro movimiento (regularización, devolución…).
CREATE OR REPLACE FUNCTION erp_movimiento_stock_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de stock son inmutables: corrígelos con otro movimiento'
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_inmutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION erp_movimiento_stock_inmutable();
