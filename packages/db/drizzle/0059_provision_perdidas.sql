ALTER TYPE "public"."journal_entry_source" ADD VALUE 'provision_perdidas';--> statement-breakpoint
CREATE TABLE "loss_provisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"closing_date" date NOT NULL,
	"contract_amount" numeric(14, 2),
	"estimated_cost" numeric(14, 2) NOT NULL,
	"production" numeric(14, 2) NOT NULL,
	"actual_cost" numeric(14, 2) NOT NULL,
	"project_finished" boolean DEFAULT false NOT NULL,
	"total_loss" numeric(14, 2) NOT NULL,
	"recognized_loss" numeric(14, 2) NOT NULL,
	"required_provision" numeric(14, 2) NOT NULL,
	"previous_provision" numeric(14, 2) NOT NULL,
	"adjustment" numeric(14, 2) NOT NULL,
	"status" "wip_status" DEFAULT 'contabilizado' NOT NULL,
	"journal_entry_id" uuid,
	"reversal_entry_id" uuid,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loss_provisions_cuadre" CHECK ("loss_provisions"."month" BETWEEN 1 AND 12
        AND "loss_provisions"."total_loss" >= 0 AND "loss_provisions"."recognized_loss" >= 0
        AND "loss_provisions"."required_provision" >= 0 AND "loss_provisions"."previous_provision" >= 0
        AND "loss_provisions"."adjustment" = "loss_provisions"."required_provision" - "loss_provisions"."previous_provision"),
	CONSTRAINT "loss_provisions_anulacion" CHECK (("loss_provisions"."status" = 'anulado') = ("loss_provisions"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "loss_provisions" ADD CONSTRAINT "loss_provisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_provisions" ADD CONSTRAINT "loss_provisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_provisions" ADD CONSTRAINT "loss_provisions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_provisions" ADD CONSTRAINT "loss_provisions_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_provisions" ADD CONSTRAINT "loss_provisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loss_provisions_vigente_unique" ON "loss_provisions" USING btree ("company_id","project_id","year","month") WHERE status = 'contabilizado';--> statement-breakpoint
CREATE INDEX "loss_provisions_company_period_idx" ON "loss_provisions" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE INDEX "loss_provisions_project_idx" ON "loss_provisions" USING btree ("project_id","year","month");