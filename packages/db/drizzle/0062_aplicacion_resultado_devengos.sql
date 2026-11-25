CREATE TYPE "public"."result_application_status" AS ENUM('aplicado', 'anulado');--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'aplicacion_resultado';--> statement-breakpoint
CREATE TABLE "bank_guarantee_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"guarantee_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"days" smallint NOT NULL,
	"base_amount" numeric(14, 2) NOT NULL,
	"rate_pct" numeric(7, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "wip_status" DEFAULT 'contabilizado' NOT NULL,
	"journal_entry_id" uuid,
	"reversal_entry_id" uuid,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_guarantee_accruals_importes" CHECK ("bank_guarantee_accruals"."month" BETWEEN 1 AND 12 AND "bank_guarantee_accruals"."days" BETWEEN 0 AND 31
        AND "bank_guarantee_accruals"."amount" >= 0 AND "bank_guarantee_accruals"."base_amount" >= 0 AND "bank_guarantee_accruals"."period_to" >= "bank_guarantee_accruals"."period_from"),
	CONSTRAINT "bank_guarantee_accruals_anulacion" CHECK (("bank_guarantee_accruals"."status" = 'anulado') = ("bank_guarantee_accruals"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "result_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"status" "result_application_status" DEFAULT 'aplicado' NOT NULL,
	"result" numeric(14, 2) NOT NULL,
	"application_date" date NOT NULL,
	"agreement" varchar(240) NOT NULL,
	"allocation" jsonb NOT NULL,
	"journal_entry_id" uuid,
	"reversal_entry_id" uuid,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_applications_anulacion" CHECK (("result_applications"."status" = 'anulado') = ("result_applications"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD COLUMN "accrued_commission" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_guarantees" ADD COLUMN "accrual_settled" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accruals" ADD CONSTRAINT "bank_guarantee_accruals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accruals" ADD CONSTRAINT "bank_guarantee_accruals_guarantee_id_bank_guarantees_id_fk" FOREIGN KEY ("guarantee_id") REFERENCES "public"."bank_guarantees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accruals" ADD CONSTRAINT "bank_guarantee_accruals_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accruals" ADD CONSTRAINT "bank_guarantee_accruals_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accruals" ADD CONSTRAINT "bank_guarantee_accruals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_applications" ADD CONSTRAINT "result_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_applications" ADD CONSTRAINT "result_applications_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_applications" ADD CONSTRAINT "result_applications_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_applications" ADD CONSTRAINT "result_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_guarantee_accruals_vigente_unique" ON "bank_guarantee_accruals" USING btree ("company_id","guarantee_id","year","month") WHERE status = 'contabilizado';--> statement-breakpoint
CREATE INDEX "bank_guarantee_accruals_company_period_idx" ON "bank_guarantee_accruals" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "result_applications_vigente_unique" ON "result_applications" USING btree ("company_id","year") WHERE status = 'aplicado';--> statement-breakpoint
CREATE INDEX "result_applications_company_year_idx" ON "result_applications" USING btree ("company_id","year");