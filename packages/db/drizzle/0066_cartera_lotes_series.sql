ALTER TYPE "public"."journal_entry_source" ADD VALUE 'anticipo';--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"code" varchar(60) NOT NULL,
	"expiry_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_kind" CHECK ("stock_lots"."kind" IN ('lote', 'serie'))
);
--> statement-breakpoint
CREATE TABLE "stock_movement_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_lots_cantidad" CHECK ("stock_movement_lots"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "third_party_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"project_id" uuid,
	"direction" "milestone_direction" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"applied_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"received_on" date NOT NULL,
	"bank_account_id" uuid,
	"reference" varchar(80),
	"notes" text,
	"status" varchar(10) DEFAULT 'vigente' NOT NULL,
	"journal_entry_id" uuid,
	"reversal_entry_id" uuid,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "third_party_advances_valores" CHECK ("third_party_advances"."amount" > 0 AND "third_party_advances"."applied_amount" >= 0 AND "third_party_advances"."applied_amount" <= "third_party_advances"."amount"
        AND "third_party_advances"."status" IN ('vigente', 'anulado')
        AND ("third_party_advances"."status" = 'anulado') = ("third_party_advances"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "third_party_nettings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"netting_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" varchar(10) DEFAULT 'vigente' NOT NULL,
	"notes" text,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "third_party_nettings_valores" CHECK ("third_party_nettings"."amount" > 0 AND "third_party_nettings"."status" IN ('vigente', 'anulado')
        AND ("third_party_nettings"."status" = 'anulado') = ("third_party_nettings"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD COLUMN "source" varchar(20) DEFAULT 'tesoreria' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD COLUMN "offset_account" varchar(10);--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD COLUMN "advance_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD COLUMN "netting_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_articles" ADD COLUMN "tracking" varchar(10) DEFAULT 'ninguno' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_article_id_stock_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."stock_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_advances" ADD CONSTRAINT "third_party_advances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_advances" ADD CONSTRAINT "third_party_advances_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_advances" ADD CONSTRAINT "third_party_advances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_advances" ADD CONSTRAINT "third_party_advances_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_advances" ADD CONSTRAINT "third_party_advances_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_advances" ADD CONSTRAINT "third_party_advances_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_advances" ADD CONSTRAINT "third_party_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_nettings" ADD CONSTRAINT "third_party_nettings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_nettings" ADD CONSTRAINT "third_party_nettings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_nettings" ADD CONSTRAINT "third_party_nettings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_company_article_code_unique" ON "stock_lots" USING btree ("company_id","article_id","code");--> statement-breakpoint
CREATE INDEX "stock_movement_lots_movement_idx" ON "stock_movement_lots" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "stock_movement_lots_lot_idx" ON "stock_movement_lots" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "stock_movement_lots_company_warehouse_lot_idx" ON "stock_movement_lots" USING btree ("company_id","warehouse_id","lot_id");--> statement-breakpoint
CREATE INDEX "third_party_advances_company_contact_idx" ON "third_party_advances" USING btree ("company_id","contact_id","direction");--> statement-breakpoint
CREATE INDEX "third_party_nettings_company_contact_idx" ON "third_party_nettings" USING btree ("company_id","contact_id");--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_advance_id_third_party_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."third_party_advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_netting_id_third_party_nettings_id_fk" FOREIGN KEY ("netting_id") REFERENCES "public"."third_party_nettings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entry_lines_company_contact_idx" ON "journal_entry_lines" USING btree ("company_id","contact_id") WHERE contact_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_settlements_advance_idx" ON "payment_settlements" USING btree ("advance_id") WHERE advance_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_settlements_netting_idx" ON "payment_settlements" USING btree ("netting_id") WHERE netting_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_origen" CHECK ("payment_settlements"."source" IN ('tesoreria', 'anticipo', 'compensacion')
        AND ("payment_settlements"."source" = 'tesoreria') = ("payment_settlements"."offset_account" IS NULL)
        AND ("payment_settlements"."source" <> 'anticipo' OR "payment_settlements"."advance_id" IS NOT NULL)
        AND ("payment_settlements"."source" <> 'compensacion' OR "payment_settlements"."netting_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "stock_articles" ADD CONSTRAINT "stock_articles_tracking" CHECK ("stock_articles"."tracking" IN ('ninguno', 'lote', 'serie'));--> statement-breakpoint
-- Relleno del tercero en las líneas de 430x/400x ya contabilizadas por la
-- interfaz (facturas y liquidaciones, y sus contra-asientos). Solo rellena
-- valores nulos: no modifica importes ni cuentas.
UPDATE "journal_entry_lines" l SET "contact_id" = i."contact_id"
FROM "journal_entries" je
LEFT JOIN "journal_entries" o ON o."id" = je."reverses_id"
JOIN "invoices" i ON i."id" = CASE
  WHEN coalesce(o."source", je."source") IN ('factura_venta', 'factura_compra') THEN coalesce(o."source_id", je."source_id")
  WHEN coalesce(o."source", je."source") IN ('cobro', 'pago') THEN (
    SELECT pm."invoice_id" FROM "payment_settlements" ps
    JOIN "payment_milestones" pm ON pm."id" = ps."milestone_id"
    WHERE ps."id" = coalesce(o."source_id", je."source_id"))
END
JOIN "ledger_accounts" la ON true
WHERE l."entry_id" = je."id" AND la."id" = l."account_id"
  AND l."contact_id" IS NULL
  AND (la."code" LIKE '430%' OR la."code" LIKE '400%');