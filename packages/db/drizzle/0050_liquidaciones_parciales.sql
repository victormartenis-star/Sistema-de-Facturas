CREATE TYPE "public"."settlement_status" AS ENUM('vigente', 'anulada');--> statement-breakpoint
CREATE TABLE "payment_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"settled_on" date NOT NULL,
	"status" "settlement_status" DEFAULT 'vigente' NOT NULL,
	"bank_account_id" uuid,
	"bank_transaction_id" uuid,
	"payment_instrument" "payment_instrument" DEFAULT 'transferencia' NOT NULL,
	"reference" varchar(80),
	"notes" text,
	"reversal_reason" varchar(240),
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_settlements_amount_not_zero" CHECK ("payment_settlements"."amount" <> 0),
	CONSTRAINT "payment_settlements_reversal_coherence" CHECK (("payment_settlements"."status" = 'anulada') = ("payment_settlements"."reversed_at" IS NOT NULL AND "payment_settlements"."reversal_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD COLUMN "settled_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_settlements_company_milestone_idx" ON "payment_settlements" USING btree ("company_id","milestone_id","settled_on");--> statement-breakpoint
CREATE INDEX "payment_settlements_company_date_idx" ON "payment_settlements" USING btree ("company_id","settled_on","status");--> statement-breakpoint
CREATE INDEX "payment_settlements_bank_transaction_idx" ON "payment_settlements" USING btree ("bank_transaction_id") WHERE bank_transaction_id IS NOT NULL;--> statement-breakpoint
-- Traspaso (a mano, no lo genera drizzle-kit): cada vencimiento ya pagado
-- queda liquidado del todo con una liquidación histórica, enlazada al
-- movimiento bancario si estaba conciliado. Va antes de los CHECK.
UPDATE "payment_milestones" SET "settled_amount" = "amount" WHERE "status" = 'pagado';--> statement-breakpoint
INSERT INTO "payment_settlements" ("company_id", "milestone_id", "amount", "settled_on", "payment_instrument", "bank_transaction_id", "reference")
SELECT m."company_id", m."id", m."amount", coalesce(m."paid_at", m."due_date"), m."payment_instrument",
       (SELECT bt."id" FROM "bank_transactions" bt WHERE bt."reconciled_milestone_id" = m."id" ORDER BY bt."reconciled_at" LIMIT 1),
       'Migración 0050: liquidación previa'
FROM "payment_milestones" m
WHERE m."status" = 'pagado' AND m."amount" <> 0;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_settled_range" CHECK (("payment_milestones"."amount" >= 0 AND "payment_milestones"."settled_amount" BETWEEN 0 AND "payment_milestones"."amount") OR ("payment_milestones"."amount" < 0 AND "payment_milestones"."settled_amount" BETWEEN "payment_milestones"."amount" AND 0));--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_status_settled" CHECK (("payment_milestones"."status" = 'pagado' AND "payment_milestones"."settled_amount" = "payment_milestones"."amount") OR ("payment_milestones"."status" = 'previsto' AND ("payment_milestones"."settled_amount" <> "payment_milestones"."amount" OR "payment_milestones"."amount" = 0)));