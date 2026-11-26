CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"stock_movement_id" uuid,
	CONSTRAINT "goods_receipt_lines_valores" CHECK ("goods_receipt_lines"."quantity" > 0 AND "goods_receipt_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"delivery_note_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"receipt_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_importe" CHECK ("goods_receipts"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" varchar(12) NOT NULL,
	"article_id" uuid,
	"description" varchar(500) NOT NULL,
	"unit" varchar(10) DEFAULT 'ud' NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"phase_id" uuid,
	"requires_receipt" boolean DEFAULT true NOT NULL,
	"requisition_line_id" uuid,
	"rfq_quote_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_order_lines_valores" CHECK ("purchase_order_lines"."kind" IN ('material', 'servicio', 'subcontrata', 'gasto') AND "purchase_order_lines"."quantity" > 0
    AND ("purchase_order_lines"."article_id" IS NULL OR "purchase_order_lines"."kind" = 'material') AND "purchase_order_lines"."unit_price" >= 0 AND "purchase_order_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"requisition_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" varchar(12) NOT NULL,
	"article_id" uuid,
	"description" varchar(500) NOT NULL,
	"unit" varchar(10) DEFAULT 'ud' NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"estimated_unit_price" numeric(14, 4),
	"phase_id" uuid,
	CONSTRAINT "purchase_requisition_lines_valores" CHECK ("purchase_requisition_lines"."kind" IN ('material', 'servicio', 'subcontrata', 'gasto') AND "purchase_requisition_lines"."quantity" > 0
    AND ("purchase_requisition_lines"."article_id" IS NULL OR "purchase_requisition_lines"."kind" = 'material'))
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" varchar(12) DEFAULT 'borrador' NOT NULL,
	"needed_by" date,
	"requested_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" varchar(240),
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requisitions_status" CHECK ("purchase_requisitions"."status" IN ('borrador', 'solicitada', 'aprobada', 'rechazada', 'convertida', 'anulada'))
);
--> statement-breakpoint
CREATE TABLE "purchase_rfq_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"requisition_line_id" uuid,
	"line_no" smallint NOT NULL,
	"kind" varchar(12) NOT NULL,
	"article_id" uuid,
	"description" varchar(500) NOT NULL,
	"unit" varchar(10) DEFAULT 'ud' NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"phase_id" uuid,
	CONSTRAINT "purchase_rfq_lines_valores" CHECK ("purchase_rfq_lines"."kind" IN ('material', 'servicio', 'subcontrata', 'gasto') AND "purchase_rfq_lines"."quantity" > 0
    AND ("purchase_rfq_lines"."article_id" IS NULL OR "purchase_rfq_lines"."kind" = 'material'))
);
--> statement-breakpoint
CREATE TABLE "purchase_rfq_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rfq_line_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"awarded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_rfq_quotes_precio" CHECK ("purchase_rfq_quotes"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_rfq_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"lead_time_days" integer,
	"valid_until" date,
	"terms" varchar(500),
	"quoted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_rfq_suppliers_plazo" CHECK ("purchase_rfq_suppliers"."lead_time_days" IS NULL OR "purchase_rfq_suppliers"."lead_time_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requisition_id" uuid,
	"seq" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" varchar(12) DEFAULT 'abierta' NOT NULL,
	"deadline" date,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_rfqs_status" CHECK ("purchase_rfqs"."status" IN ('abierta', 'adjudicada', 'cancelada'))
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "purchase_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "quantity" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "unit_price" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "price_tolerance_pct" numeric(5, 2) DEFAULT '2' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "price_tolerance_amount" numeric(14, 2) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "quantity_tolerance_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "requisition_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "rfq_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "public"."delivery_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_article_id_stock_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."stock_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_requisition_line_id_purchase_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."purchase_requisition_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_rfq_quote_id_purchase_rfq_quotes_id_fk" FOREIGN KEY ("rfq_quote_id") REFERENCES "public"."purchase_rfq_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_article_id_stock_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."stock_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_lines" ADD CONSTRAINT "purchase_rfq_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_lines" ADD CONSTRAINT "purchase_rfq_lines_rfq_id_purchase_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."purchase_rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_lines" ADD CONSTRAINT "purchase_rfq_lines_requisition_line_id_purchase_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."purchase_requisition_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_lines" ADD CONSTRAINT "purchase_rfq_lines_article_id_stock_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."stock_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_lines" ADD CONSTRAINT "purchase_rfq_lines_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_quotes" ADD CONSTRAINT "purchase_rfq_quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_quotes" ADD CONSTRAINT "purchase_rfq_quotes_rfq_line_id_purchase_rfq_lines_id_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "public"."purchase_rfq_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_quotes" ADD CONSTRAINT "purchase_rfq_quotes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_suppliers" ADD CONSTRAINT "purchase_rfq_suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_suppliers" ADD CONSTRAINT "purchase_rfq_suppliers_rfq_id_purchase_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."purchase_rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfq_suppliers" ADD CONSTRAINT "purchase_rfq_suppliers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_order_line_idx" ON "goods_receipt_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_receipt_idx" ON "goods_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_company_order_idx" ON "goods_receipts" USING btree ("company_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_delivery_note_unique" ON "goods_receipts" USING btree ("delivery_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_order_line_unique" ON "purchase_order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_company_article_idx" ON "purchase_order_lines" USING btree ("company_id","article_id") WHERE article_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requisition_lines_req_line_unique" ON "purchase_requisition_lines" USING btree ("requisition_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requisitions_project_seq_unique" ON "purchase_requisitions" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_company_status_idx" ON "purchase_requisitions" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_rfq_lines_rfq_line_unique" ON "purchase_rfq_lines" USING btree ("rfq_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_rfq_quotes_line_contact_unique" ON "purchase_rfq_quotes" USING btree ("rfq_line_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_rfq_quotes_line_awarded_unique" ON "purchase_rfq_quotes" USING btree ("rfq_line_id") WHERE awarded = true;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_rfq_suppliers_rfq_contact_unique" ON "purchase_rfq_suppliers" USING btree ("rfq_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_rfqs_project_seq_unique" ON "purchase_rfqs" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX "purchase_rfqs_company_status_idx" ON "purchase_rfqs" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_purchase_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."purchase_rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_po_line_idx" ON "invoice_lines" USING btree ("purchase_order_line_id") WHERE purchase_order_line_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_po_line_coherence" CHECK ("invoice_lines"."purchase_order_line_id" IS NULL OR ("invoice_lines"."quantity" IS NOT NULL AND "invoice_lines"."unit_price" IS NOT NULL AND "invoice_lines"."unit_price" >= 0));