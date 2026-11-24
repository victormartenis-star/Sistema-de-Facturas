CREATE TYPE "public"."consolidation_adjustment_status" AS ENUM('vigente', 'anulado');--> statement-breakpoint
CREATE TYPE "public"."consolidation_method" AS ENUM('global', 'proporcional');--> statement-breakpoint
CREATE TABLE "consolidation_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"adjustment_date" date NOT NULL,
	"description" varchar(240) NOT NULL,
	"debit_account" varchar(10) NOT NULL,
	"credit_account" varchar(10) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"member_company_id" uuid,
	"status" "consolidation_adjustment_status" DEFAULT 'vigente' NOT NULL,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consolidation_adjustments_importe" CHECK ("consolidation_adjustments"."amount" > 0 AND "consolidation_adjustments"."debit_account" <> "consolidation_adjustments"."credit_account"
        AND "consolidation_adjustments"."debit_account" ~ '^[1-7][0-9]{2,9}$' AND "consolidation_adjustments"."credit_account" ~ '^[1-7][0-9]{2,9}$'),
	CONSTRAINT "consolidation_adjustments_anulacion" CHECK (("consolidation_adjustments"."status" = 'anulado') = ("consolidation_adjustments"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "consolidation_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consolidation_closings_periodo" CHECK ("consolidation_closings"."period_to" >= "consolidation_closings"."period_from")
);
--> statement-breakpoint
CREATE TABLE "corporate_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_company_id" uuid NOT NULL,
	"ownership_pct" numeric(5, 2) NOT NULL,
	"method" "consolidation_method" DEFAULT 'global' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_group_members_pct" CHECK ("corporate_group_members"."ownership_pct" >= 0.01 AND "corporate_group_members"."ownership_pct" <= 100),
	CONSTRAINT "corporate_group_members_fechas" CHECK ("corporate_group_members"."end_date" IS NULL OR "corporate_group_members"."end_date" >= "corporate_group_members"."start_date")
);
--> statement-breakpoint
CREATE TABLE "corporate_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"base_currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_company_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_group_id_corporate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."corporate_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_member_company_id_companies_id_fk" FOREIGN KEY ("member_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_adjustments" ADD CONSTRAINT "consolidation_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_closings" ADD CONSTRAINT "consolidation_closings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_closings" ADD CONSTRAINT "consolidation_closings_group_id_corporate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."corporate_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_closings" ADD CONSTRAINT "consolidation_closings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_group_members" ADD CONSTRAINT "corporate_group_members_group_id_corporate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."corporate_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_group_members" ADD CONSTRAINT "corporate_group_members_member_company_id_companies_id_fk" FOREIGN KEY ("member_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_groups" ADD CONSTRAINT "corporate_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_groups" ADD CONSTRAINT "corporate_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_grants" ADD CONSTRAINT "user_company_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_grants" ADD CONSTRAINT "user_company_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_grants" ADD CONSTRAINT "user_company_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_grants" ADD CONSTRAINT "user_company_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consolidation_adjustments_group_date_idx" ON "consolidation_adjustments" USING btree ("group_id","adjustment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "consolidation_closings_periodo_unique" ON "consolidation_closings" USING btree ("group_id","period_from","period_to");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_group_members_activa_unique" ON "corporate_group_members" USING btree ("group_id","member_company_id") WHERE end_date IS NULL;--> statement-breakpoint
CREATE INDEX "corporate_group_members_company_idx" ON "corporate_group_members" USING btree ("member_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_groups_company_name_unique" ON "corporate_groups" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "user_company_grants_vigente_unique" ON "user_company_grants" USING btree ("company_id","user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "user_company_grants_user_idx" ON "user_company_grants" USING btree ("user_id");