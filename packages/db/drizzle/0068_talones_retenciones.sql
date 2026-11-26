ALTER TYPE "public"."journal_entry_source" ADD VALUE 'talon';--> statement-breakpoint
ALTER TYPE "public"."payment_instrument" ADD VALUE 'talon';--> statement-breakpoint
CREATE TABLE "checkbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"prefix" varchar(10) DEFAULT '' NOT NULL,
	"first_number" integer NOT NULL,
	"last_number" integer NOT NULL,
	"next_number" integer NOT NULL,
	"status" varchar(10) DEFAULT 'activo' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkbooks_rango" CHECK ("checkbooks"."first_number" >= 1 AND "checkbooks"."last_number" >= "checkbooks"."first_number"
        AND "checkbooks"."next_number" BETWEEN "checkbooks"."first_number" AND "checkbooks"."last_number" + 1
        AND "checkbooks"."status" IN ('activo', 'agotado', 'anulado'))
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"direction" varchar(10) NOT NULL,
	"checkbook_id" uuid,
	"sequence" integer,
	"number" varchar(40) NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"delivered_on" date,
	"cleared_on" date,
	"voided_on" date,
	"status" varchar(10) DEFAULT 'emitido' NOT NULL,
	"reason" varchar(240),
	"memo" varchar(240),
	"clearing_entry_id" uuid,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checks_valores" CHECK ("checks"."amount" > 0
        AND "checks"."direction" IN ('emitido', 'recibido')
        AND "checks"."status" IN ('emitido', 'entregado', 'cobrado', 'anulado', 'detenido', 'devuelto')
        AND ("checks"."direction" = 'emitido') = ("checks"."checkbook_id" IS NOT NULL AND "checks"."sequence" IS NOT NULL)
        AND ("checks"."due_date" IS NULL OR "checks"."due_date" >= "checks"."issue_date")
        AND ("checks"."status" <> 'cobrado' OR "checks"."cleared_on" IS NOT NULL)
        AND ("checks"."status" NOT IN ('anulado', 'detenido', 'devuelto') OR ("checks"."voided_on" IS NOT NULL AND "checks"."reason" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "retention_release_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"previous_due_date" date NOT NULL,
	CONSTRAINT "retention_release_lines_importe" CHECK ("retention_release_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "retention_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"side" "milestone_direction" NOT NULL,
	"project_id" uuid,
	"contact_id" uuid NOT NULL,
	"guarantee_id" uuid,
	"release_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reason" varchar(240) NOT NULL,
	"status" varchar(10) DEFAULT 'vigente' NOT NULL,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_releases_valores" CHECK ("retention_releases"."amount" > 0 AND "retention_releases"."kind" IN ('aval', 'hito')
        AND ("retention_releases"."kind" = 'aval') = ("retention_releases"."guarantee_id" IS NOT NULL)
        AND "retention_releases"."status" IN ('vigente', 'anulado')
        AND ("retention_releases"."status" = 'anulado') = ("retention_releases"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "subcontract_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"change_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"previous_amount" numeric(14, 2) NOT NULL,
	"new_amount" numeric(14, 2) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subcontract_changes_valores" CHECK ("subcontract_changes"."amount" <> 0 AND "subcontract_changes"."new_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD COLUMN "check_id" uuid;--> statement-breakpoint
ALTER TABLE "checkbooks" ADD CONSTRAINT "checkbooks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkbooks" ADD CONSTRAINT "checkbooks_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkbooks" ADD CONSTRAINT "checkbooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_checkbook_id_checkbooks_id_fk" FOREIGN KEY ("checkbook_id") REFERENCES "public"."checkbooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_clearing_entry_id_journal_entries_id_fk" FOREIGN KEY ("clearing_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_release_lines" ADD CONSTRAINT "retention_release_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_release_lines" ADD CONSTRAINT "retention_release_lines_release_id_retention_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."retention_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_release_lines" ADD CONSTRAINT "retention_release_lines_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_guarantee_id_bank_guarantees_id_fk" FOREIGN KEY ("guarantee_id") REFERENCES "public"."bank_guarantees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_changes" ADD CONSTRAINT "subcontract_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_changes" ADD CONSTRAINT "subcontract_changes_contract_id_contratos_subcontrata_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contratos_subcontrata"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_changes" ADD CONSTRAINT "subcontract_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkbooks_company_account_idx" ON "checkbooks" USING btree ("company_id","bank_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_checkbook_sequence_unique" ON "checks" USING btree ("checkbook_id","sequence") WHERE checkbook_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "checks_account_direction_number_unique" ON "checks" USING btree ("company_id","bank_account_id","direction","number");--> statement-breakpoint
CREATE INDEX "checks_company_status_idx" ON "checks" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "checks_milestone_idx" ON "checks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "retention_release_lines_release_idx" ON "retention_release_lines" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "retention_release_lines_milestone_idx" ON "retention_release_lines" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "retention_releases_company_project_idx" ON "retention_releases" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "retention_releases_guarantee_idx" ON "retention_releases" USING btree ("guarantee_id") WHERE guarantee_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subcontract_changes_contract_number_unique" ON "subcontract_changes" USING btree ("contract_id","number");--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;