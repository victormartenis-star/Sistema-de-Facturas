ALTER TABLE "projects" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pem_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_contacts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;