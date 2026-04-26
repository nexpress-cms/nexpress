ALTER TABLE "nx_member_identities" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "nx_member_identities" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "nx_member_identities_member_idx" ON "nx_member_identities" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "nx_member_identities" ADD CONSTRAINT "nx_member_identities_member_provider_uq" UNIQUE("member_id","provider");