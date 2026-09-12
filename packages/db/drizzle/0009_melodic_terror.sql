CREATE TABLE "certification_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certification_id" uuid NOT NULL,
	"budget_item_id" uuid NOT NULL,
	"cumulative_pct" numeric(5, 2) NOT NULL,
	"cumulative_amount" numeric(14, 2) NOT NULL,
	"period_amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certification_lines_certification_id_budget_item_id_unique" UNIQUE("certification_id","budget_item_id")
);
--> statement-breakpoint
ALTER TABLE "certification_lines" ADD CONSTRAINT "certification_lines_certification_id_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certification_lines" ADD CONSTRAINT "certification_lines_budget_item_id_budget_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE restrict ON UPDATE no action;