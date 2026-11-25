CREATE TABLE "bank_guarantee_accrual_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"reference_date" date NOT NULL,
	"period_from" varchar(7),
	"period_to" varchar(7) NOT NULL,
	"posted_count" integer DEFAULT 0 NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_guarantee_accrual_batches_valores" CHECK ("bank_guarantee_accrual_batches"."trigger" IN ('manual', 'automatico')
        AND "bank_guarantee_accrual_batches"."posted_count" >= 0 AND "bank_guarantee_accrual_batches"."alert_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bank_guarantee_accrual_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accrual_batches" ADD CONSTRAINT "bank_guarantee_accrual_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_accrual_batches" ADD CONSTRAINT "bank_guarantee_accrual_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_guarantee_accrual_batches_company_created_idx" ON "bank_guarantee_accrual_batches" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "bank_guarantee_accrual_runs" ADD CONSTRAINT "bank_guarantee_accrual_runs_batch_id_bank_guarantee_accrual_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bank_guarantee_accrual_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_guarantee_accrual_runs_batch_idx" ON "bank_guarantee_accrual_runs" USING btree ("batch_id");