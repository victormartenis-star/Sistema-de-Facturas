CREATE TYPE "public"."material_request_status" AS ENUM('abierta', 'servida_parcial', 'servida', 'cancelada');--> statement-breakpoint
ALTER TYPE "public"."alert_rule_type" ADD VALUE 'almacen';--> statement-breakpoint
CREATE TABLE "material_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"quantity_requested" numeric(14, 3) NOT NULL,
	"quantity_reserved" numeric(14, 3) DEFAULT '0' NOT NULL,
	"quantity_served" numeric(14, 3) DEFAULT '0' NOT NULL,
	"purchase_order_id" uuid,
	CONSTRAINT "material_request_lines_cantidades" CHECK ("material_request_lines"."quantity_requested" > 0 AND "material_request_lines"."quantity_reserved" >= 0 AND "material_request_lines"."quantity_served" >= 0
        AND "material_request_lines"."quantity_reserved" + "material_request_lines"."quantity_served" <= "material_request_lines"."quantity_requested")
);
--> statement-breakpoint
CREATE TABLE "material_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" varchar(20) NOT NULL,
	"project_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "material_request_status" DEFAULT 'abierta' NOT NULL,
	"needed_by" date,
	"notes" varchar(500),
	"cancel_reason" varchar(240),
	"requested_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_requests_cancelacion" CHECK (("material_requests"."status" = 'cancelada') = ("material_requests"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_request_id_material_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."material_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_article_id_stock_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."stock_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_request_lines_article_unique" ON "material_request_lines" USING btree ("request_id","article_id");--> statement-breakpoint
CREATE INDEX "material_request_lines_po_idx" ON "material_request_lines" USING btree ("purchase_order_id") WHERE purchase_order_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_requests_company_seq_unique" ON "material_requests" USING btree ("company_id","seq");--> statement-breakpoint
CREATE INDEX "material_requests_company_status_idx" ON "material_requests" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "material_requests_project_idx" ON "material_requests" USING btree ("company_id","project_id");