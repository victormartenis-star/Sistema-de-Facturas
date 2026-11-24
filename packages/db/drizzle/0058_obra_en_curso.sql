CREATE TYPE "public"."wip_status" AS ENUM('contabilizado', 'anulado');--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'obra_en_curso';--> statement-breakpoint
CREATE TABLE "work_in_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"closing_date" date NOT NULL,
	"production" numeric(14, 2) NOT NULL,
	"invoiced" numeric(14, 2) NOT NULL,
	"wip_amount" numeric(14, 2) NOT NULL,
	"previous_wip" numeric(14, 2) NOT NULL,
	"adjustment" numeric(14, 2) NOT NULL,
	"actual_cost" numeric(14, 2) NOT NULL,
	"status" "wip_status" DEFAULT 'contabilizado' NOT NULL,
	"journal_entry_id" uuid,
	"reversal_entry_id" uuid,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_in_progress_cuadre" CHECK ("work_in_progress"."month" BETWEEN 1 AND 12
        AND "work_in_progress"."wip_amount" = "work_in_progress"."production" - "work_in_progress"."invoiced"
        AND "work_in_progress"."adjustment" = "work_in_progress"."wip_amount" - "work_in_progress"."previous_wip"),
	CONSTRAINT "work_in_progress_anulacion" CHECK (("work_in_progress"."status" = 'anulado') = ("work_in_progress"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "work_in_progress" ADD CONSTRAINT "work_in_progress_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_in_progress" ADD CONSTRAINT "work_in_progress_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_in_progress" ADD CONSTRAINT "work_in_progress_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_in_progress" ADD CONSTRAINT "work_in_progress_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_in_progress" ADD CONSTRAINT "work_in_progress_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_in_progress_vigente_unique" ON "work_in_progress" USING btree ("company_id","project_id","year","month") WHERE status = 'contabilizado';--> statement-breakpoint
CREATE INDEX "work_in_progress_company_period_idx" ON "work_in_progress" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE INDEX "work_in_progress_project_idx" ON "work_in_progress" USING btree ("project_id","year","month");