CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"user_email" text,
	"user_name" text,
	"user_role" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"payload" jsonb,
	"status_code" integer NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- El registro de auditoría es de solo inserción. Que no exista código que
-- actualice o borre no basta: un log que se puede editar no prueba nada, así
-- que la propia base de datos lo impide.
CREATE OR REPLACE FUNCTION audit_log_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El registro de auditoría es inmutable: no admite % ', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_inmutable
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_solo_insercion();
