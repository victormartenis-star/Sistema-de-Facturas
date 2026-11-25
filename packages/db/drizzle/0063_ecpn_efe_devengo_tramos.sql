CREATE TABLE "bank_guarantee_accrual_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"posted_count" integer DEFAULT 0 NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_guarantee_accrual_runs_valores" CHECK ("bank_guarantee_accrual_runs"."month" BETWEEN 1 AND 12 AND "bank_guarantee_accrual_runs"."trigger" IN ('manual', 'automatico')
        AND "bank_guarantee_accrual_runs"."posted_count" >= 0 AND "bank_guarantee_accrual_runs"."skipped_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "close_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cut_off_date" date NOT NULL,
	"balanced" boolean NOT NULL,
	"mismatches" integer NOT NULL,
	"items" jsonb NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "close_reconciliations_coherencia" CHECK ("close_reconciliations"."mismatches" >= 0 AND ("close_reconciliations"."balanced" = ("close_reconciliations"."mismatches" = 0)))
);
--> statement-breakpoint
ALTER TABLE "bank_guarantee_accruals" ADD COLUMN "segments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "result_applications" ADD COLUMN "out_of_term" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accrual_runs" ADD CONSTRAINT "bank_guarantee_accrual_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accrual_runs" ADD CONSTRAINT "bank_guarantee_accrual_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_reconciliations" ADD CONSTRAINT "close_reconciliations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_reconciliations" ADD CONSTRAINT "close_reconciliations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_guarantee_accrual_runs_company_period_idx" ON "bank_guarantee_accrual_runs" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE INDEX "close_reconciliations_company_date_idx" ON "close_reconciliations" USING btree ("company_id","cut_off_date");