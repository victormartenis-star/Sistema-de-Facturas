CREATE TYPE "public"."sepa_remittance_status" AS ENUM('borrador', 'generada', 'remitida', 'devuelta', 'anulada');--> statement-breakpoint
CREATE TYPE "public"."sepa_remittance_type" AS ENUM('transferencia', 'adeudo');--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'conciliacion';--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"format" varchar(10) NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"from_date" date,
	"to_date" date,
	"line_count" integer NOT NULL,
	"imported_count" integer NOT NULL,
	"closing_balance" numeric(14, 2),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_lineas" CHECK ("bank_statements"."line_count" >= 0 AND "bank_statements"."imported_count" >= 0 AND "bank_statements"."imported_count" <= "bank_statements"."line_count")
);
--> statement-breakpoint
CREATE TABLE "sepa_remittance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"remittance_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"milestone_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"end_to_end_id" varchar(35) NOT NULL,
	"name" varchar(200) NOT NULL,
	"iban" varchar(34),
	"mandate_ref" varchar(35),
	"mandate_date" date,
	"sequence_type" varchar(4),
	"remittance_info" varchar(140) NOT NULL,
	"status" varchar(10) DEFAULT 'incluida' NOT NULL,
	"settlement_id" uuid,
	"returned_on" date,
	"return_reason" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_remittance_items_valores" CHECK ("sepa_remittance_items"."amount" > 0 AND "sepa_remittance_items"."status" IN ('incluida', 'devuelta', 'excluida') AND ("sepa_remittance_items"."status" <> 'devuelta' OR ("sepa_remittance_items"."returned_on" IS NOT NULL AND "sepa_remittance_items"."return_reason" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "sepa_remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" varchar(35) NOT NULL,
	"type" "sepa_remittance_type" NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"execution_date" date NOT NULL,
	"memo" varchar(100),
	"total_amount" numeric(14, 2) NOT NULL,
	"item_count" integer NOT NULL,
	"status" "sepa_remittance_status" DEFAULT 'borrador' NOT NULL,
	"xml" text,
	"xml_hash" varchar(64),
	"generated_at" timestamp with time zone,
	"sent_on" date,
	"reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_remittances_valores" CHECK ("sepa_remittances"."total_amount" > 0 AND "sepa_remittances"."item_count" > 0 AND ("sepa_remittances"."status" = 'borrador' OR "sepa_remittances"."status" = 'anulada' OR "sepa_remittances"."xml_hash" IS NOT NULL) AND ("sepa_remittances"."status" <> 'anulada' OR "sepa_remittances"."reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "bic" varchar(11);--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "statement_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reconciliation_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reconciled_settlement_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reconciled_remittance_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reconciled_remittance_item_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reconciled_check_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "fee_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "fee_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reconciled_by" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sepa_mandate_ref" varchar(35);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sepa_mandate_date" date;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD COLUMN "remittance_item_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_items" ADD CONSTRAINT "sepa_remittance_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_items" ADD CONSTRAINT "sepa_remittance_items_remittance_id_sepa_remittances_id_fk" FOREIGN KEY ("remittance_id") REFERENCES "public"."sepa_remittances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_items" ADD CONSTRAINT "sepa_remittance_items_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_items" ADD CONSTRAINT "sepa_remittance_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_items" ADD CONSTRAINT "sepa_remittance_items_settlement_id_payment_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."payment_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittances" ADD CONSTRAINT "sepa_remittances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittances" ADD CONSTRAINT "sepa_remittances_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittances" ADD CONSTRAINT "sepa_remittances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statements_account_hash_unique" ON "bank_statements" USING btree ("company_id","bank_account_id","file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sepa_remittance_items_position_unique" ON "sepa_remittance_items" USING btree ("remittance_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sepa_remittance_items_e2e_unique" ON "sepa_remittance_items" USING btree ("company_id","end_to_end_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sepa_remittance_items_milestone_live_unique" ON "sepa_remittance_items" USING btree ("milestone_id") WHERE "sepa_remittance_items"."status" = 'incluida';--> statement-breakpoint
CREATE INDEX "sepa_remittance_items_company_contact_idx" ON "sepa_remittance_items" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sepa_remittances_company_number_unique" ON "sepa_remittances" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "sepa_remittances_company_status_idx" ON "sepa_remittances" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "sepa_remittances_company_account_idx" ON "sepa_remittances" USING btree ("company_id","bank_account_id");--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_settlement_id_payment_settlements_id_fk" FOREIGN KEY ("reconciled_settlement_id") REFERENCES "public"."payment_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_remittance_id_sepa_remittances_id_fk" FOREIGN KEY ("reconciled_remittance_id") REFERENCES "public"."sepa_remittances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_remittance_item_id_sepa_remittance_items_id_fk" FOREIGN KEY ("reconciled_remittance_item_id") REFERENCES "public"."sepa_remittance_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_check_id_checks_id_fk" FOREIGN KEY ("reconciled_check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_fee_entry_id_journal_entries_id_fk" FOREIGN KEY ("fee_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_remittance_item_id_sepa_remittance_items_id_fk" FOREIGN KEY ("remittance_item_id") REFERENCES "public"."sepa_remittance_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_transactions_company_account_kind_idx" ON "bank_transactions" USING btree ("company_id","bank_account_id","reconciliation_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_settlement_unique" ON "bank_transactions" USING btree ("reconciled_settlement_id") WHERE "bank_transactions"."reconciled_settlement_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_remittance_unique" ON "bank_transactions" USING btree ("reconciled_remittance_id") WHERE "bank_transactions"."reconciled_remittance_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_remittance_item_unique" ON "bank_transactions" USING btree ("reconciled_remittance_item_id") WHERE "bank_transactions"."reconciled_remittance_item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_check_unique" ON "bank_transactions" USING btree ("reconciled_check_id") WHERE "bank_transactions"."reconciled_check_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_conciliacion" CHECK ("bank_transactions"."fee_amount" >= 0 AND ("bank_transactions"."reconciliation_kind" IS NULL OR "bank_transactions"."reconciliation_kind" IN ('vencimiento', 'liquidacion', 'remesa', 'devolucion', 'talon', 'comision')));--> statement-breakpoint
-- Traspaso: los movimientos ya conciliados con un vencimiento lo están con su liquidación.
UPDATE "bank_transactions" SET "reconciliation_kind" = 'vencimiento' WHERE "reconciled_milestone_id" IS NOT NULL;--> statement-breakpoint
UPDATE "bank_transactions" bt SET "reconciled_settlement_id" = s."id" FROM "payment_settlements" s WHERE s."bank_transaction_id" = bt."id" AND s."status" = 'vigente' AND bt."reconciled_milestone_id" IS NOT NULL AND bt."reconciled_settlement_id" IS NULL;