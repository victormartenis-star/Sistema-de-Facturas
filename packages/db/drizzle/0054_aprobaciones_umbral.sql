CREATE TYPE "public"."approval_operation" AS ENUM('pedido_compra', 'factura_compra', 'certificacion_subcontrata');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('pendiente', 'aprobada', 'rechazada', 'invalidada', 'anulada');--> statement-breakpoint
CREATE TYPE "public"."approval_role" AS ENUM('administracion', 'gerente', 'admin');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"operation" "approval_operation" NOT NULL,
	"entity_id" uuid NOT NULL,
	"reference" varchar(80) NOT NULL,
	"project_id" uuid,
	"rule_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"required_role" "approval_role" NOT NULL,
	"status" "approval_request_status" DEFAULT 'pendiente' NOT NULL,
	"comment" varchar(500),
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" varchar(500),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_amount" CHECK ("approval_requests"."amount" >= 0),
	CONSTRAINT "approval_requests_decision" CHECK (("approval_requests"."status" = 'pendiente') = ("approval_requests"."decided_at" IS NULL)
        AND ("approval_requests"."status" NOT IN ('rechazada', 'invalidada', 'anulada') OR "approval_requests"."decision_reason" IS NOT NULL)
        AND ("approval_requests"."decided_by" IS NULL OR "approval_requests"."requested_by" IS NULL OR "approval_requests"."decided_by" <> "approval_requests"."requested_by" OR "approval_requests"."status" IN ('invalidada', 'anulada')))
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"operation" "approval_operation" NOT NULL,
	"min_amount" numeric(14, 2) NOT NULL,
	"required_role" "approval_role" NOT NULL,
	"project_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_rules_min_amount" CHECK ("approval_rules"."min_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_viva_unique" ON "approval_requests" USING btree ("company_id","operation","entity_id") WHERE status IN ('pendiente', 'aprobada');--> statement-breakpoint
CREATE INDEX "approval_requests_company_status_idx" ON "approval_requests" USING btree ("company_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "approval_requests_entity_idx" ON "approval_requests" USING btree ("company_id","operation","entity_id","requested_at");--> statement-breakpoint
CREATE INDEX "approval_rules_company_operation_idx" ON "approval_rules" USING btree ("company_id","operation","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rules_tramo_unique" ON "approval_rules" USING btree ("company_id","operation",coalesce("project_id", '00000000-0000-0000-0000-000000000000'::uuid),"min_amount") WHERE is_active;