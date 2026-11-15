CREATE TABLE "audit_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"anchor_date" date NOT NULL,
	"sequence_number" bigint NOT NULL,
	"entry_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_anchors_company_date_unique" UNIQUE("company_id","anchor_date"),
	CONSTRAINT "audit_anchors_seq_check" CHECK ("audit_anchors"."sequence_number" >= 1),
	CONSTRAINT "audit_anchors_hash_check" CHECK ("audit_anchors"."entry_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit_anchors" ADD CONSTRAINT "audit_anchors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION audit_anchors_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND audit_purga_permitida() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'audit_anchors es inmutable: % no permitido', TG_OP USING ERRCODE = 'AUD01';
END $$;
--> statement-breakpoint
CREATE TRIGGER "audit_anchors_bud_inmutable" BEFORE UPDATE OR DELETE ON "audit_anchors"
  FOR EACH ROW EXECUTE FUNCTION audit_anchors_inmutable();
--> statement-breakpoint
CREATE TRIGGER "audit_anchors_bt_truncate" BEFORE TRUNCATE ON "audit_anchors"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_bloquear_truncate();
