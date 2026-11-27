CREATE TYPE "public"."approval_step_status" AS ENUM('en_espera', 'activo', 'aprobado', 'rechazado', 'cancelado');--> statement-breakpoint
CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delegator_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" varchar(240) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delegations_valores" CHECK ("approval_delegations"."delegator_id" <> "approval_delegations"."delegate_id" AND "approval_delegations"."to_date" >= "approval_delegations"."from_date")
);
--> statement-breakpoint
CREATE TABLE "approval_rule_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"min_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"required_role" "approval_role" NOT NULL,
	"approver_user_id" uuid,
	"sla_hours" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_rule_levels_valores" CHECK ("approval_rule_levels"."level" BETWEEN 1 AND 9 AND "approval_rule_levels"."min_amount" >= 0 AND ("approval_rule_levels"."sla_hours" IS NULL OR "approval_rule_levels"."sla_hours" > 0))
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"required_role" "approval_role" NOT NULL,
	"approver_user_id" uuid,
	"status" "approval_step_status" DEFAULT 'en_espera' NOT NULL,
	"activated_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"escalated" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"on_behalf_of" uuid,
	"decided_at" timestamp with time zone,
	"comment" varchar(500),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_steps_valores" CHECK ("approval_steps"."level" BETWEEN 1 AND 9 AND ("approval_steps"."status" IN ('aprobado', 'rechazado')) = ("approval_steps"."decided_at" IS NOT NULL AND "approval_steps"."decided_by" IS NOT NULL) AND ("approval_steps"."status" <> 'activo' OR "approval_steps"."activated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sod_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conflict" varchar(40) NOT NULL,
	"mode" varchar(12) NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sod_policies_valores" CHECK ("sod_policies"."conflict" IN ('solicitante_aprueba', 'mismo_aprobador_niveles', 'creador_aprueba', 'aprobador_paga') AND "sod_policies"."mode" IN ('bloquear', 'justificar', 'auditar') AND ("sod_policies"."conflict" NOT IN ('solicitante_aprueba', 'mismo_aprobador_niveles') OR "sod_policies"."mode" = 'bloquear'))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "current_level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "total_levels" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dirigida" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_id_users_id_fk" FOREIGN KEY ("delegator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_levels" ADD CONSTRAINT "approval_rule_levels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_levels" ADD CONSTRAINT "approval_rule_levels_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_levels" ADD CONSTRAINT "approval_rule_levels_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_on_behalf_of_users_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_policies" ADD CONSTRAINT "sod_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_policies" ADD CONSTRAINT "sod_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_company_delegate_idx" ON "approval_delegations" USING btree ("company_id","delegate_id","is_active");--> statement-breakpoint
CREATE INDEX "approval_delegations_company_delegator_idx" ON "approval_delegations" USING btree ("company_id","delegator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rule_levels_rule_level_unique" ON "approval_rule_levels" USING btree ("rule_id","level");--> statement-breakpoint
CREATE INDEX "approval_rule_levels_company_rule_idx" ON "approval_rule_levels" USING btree ("company_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_steps_request_level_unique" ON "approval_steps" USING btree ("request_id","level");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_steps_activo_unique" ON "approval_steps" USING btree ("request_id") WHERE "approval_steps"."status" = 'activo';--> statement-breakpoint
CREATE INDEX "approval_steps_company_status_due_idx" ON "approval_steps" USING btree ("company_id","status","due_at");--> statement-breakpoint
CREATE INDEX "approval_steps_company_approver_idx" ON "approval_steps" USING btree ("company_id","approver_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipients_unique" ON "notification_recipients" USING btree ("notification_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_recipients_company_user_idx" ON "notification_recipients" USING btree ("company_id","user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sod_policies_company_conflict_unique" ON "sod_policies" USING btree ("company_id","conflict");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_niveles" CHECK ("approval_requests"."total_levels" BETWEEN 1 AND 9 AND "approval_requests"."current_level" BETWEEN 1 AND "approval_requests"."total_levels");--> statement-breakpoint
-- Traspaso: cada solicitud existente pasa a tener su paso único (nivel 1).
INSERT INTO "approval_steps" ("company_id", "request_id", "level", "required_role", "status", "activated_at", "decided_by", "decided_at", "comment")
SELECT r."company_id", r."id", 1, r."required_role",
  (CASE
    WHEN r."status" = 'pendiente' THEN 'activo'
    WHEN r."status" = 'aprobada' AND r."decided_by" IS NOT NULL THEN 'aprobado'
    WHEN r."status" = 'rechazada' AND r."decided_by" IS NOT NULL THEN 'rechazado'
    ELSE 'cancelado'
  END)::"approval_step_status",
  r."requested_at",
  CASE WHEN r."status" IN ('aprobada', 'rechazada') THEN r."decided_by" END,
  CASE WHEN r."status" IN ('aprobada', 'rechazada') AND r."decided_by" IS NOT NULL THEN r."decided_at" END,
  CASE WHEN r."status" IN ('aprobada', 'rechazada') THEN left(r."decision_reason", 500) END
FROM "approval_requests" r
WHERE NOT EXISTS (SELECT 1 FROM "approval_steps" s WHERE s."request_id" = r."id");