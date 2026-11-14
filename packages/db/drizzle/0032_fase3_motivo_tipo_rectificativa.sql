CREATE TYPE "public"."rectification_motive" AS ENUM('R1', 'R2', 'R3', 'R4');--> statement-breakpoint
CREATE TYPE "public"."rectification_type" AS ENUM('S', 'I');--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rectification_motive" "rectification_motive";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rectification_type" "rectification_type";
