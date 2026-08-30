CREATE TYPE "public"."user_role" AS ENUM('direccion', 'jefe_grupo', 'jefe_obra', 'encargado', 'estudios', 'compras', 'administracion');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "group_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "site_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "foreman_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_group_manager_id_users_id_fk" FOREIGN KEY ("group_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_site_manager_id_users_id_fk" FOREIGN KEY ("site_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_foreman_id_users_id_fk" FOREIGN KEY ("foreman_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;