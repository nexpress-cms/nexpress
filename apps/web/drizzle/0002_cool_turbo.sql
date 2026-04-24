CREATE TYPE "public"."nx_password_reset_purpose" AS ENUM('invite', 'reset');--> statement-breakpoint
ALTER TABLE "nx_users" ADD COLUMN "password_reset_token_hash" text;--> statement-breakpoint
ALTER TABLE "nx_users" ADD COLUMN "password_reset_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nx_users" ADD COLUMN "password_reset_purpose" "nx_password_reset_purpose";