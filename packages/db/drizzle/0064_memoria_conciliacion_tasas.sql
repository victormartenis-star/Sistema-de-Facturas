CREATE TABLE "bank_guarantee_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"guarantee_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"rate_pct" numeric(7, 4),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_guarantee_rates_rango" CHECK ("bank_guarantee_rates"."rate_pct" IS NULL OR ("bank_guarantee_rates"."rate_pct" >= 0 AND "bank_guarantee_rates"."rate_pct" <= 100))
);
--> statement-breakpoint
ALTER TABLE "bank_guarantee_movements" ADD COLUMN "accrual_settled_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_guarantee_rates" ADD CONSTRAINT "bank_guarantee_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_rates" ADD CONSTRAINT "bank_guarantee_rates_guarantee_id_bank_guarantees_id_fk" FOREIGN KEY ("guarantee_id") REFERENCES "public"."bank_guarantees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_guarantee_rates" ADD CONSTRAINT "bank_guarantee_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_guarantee_rates_effective_unique" ON "bank_guarantee_rates" USING btree ("company_id","guarantee_id","effective_date");