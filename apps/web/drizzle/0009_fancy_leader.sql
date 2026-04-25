CREATE TABLE "nx_user_oauth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_user_oauth_identities_provider_subject_unique" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "nx_user_oauth_identities_user_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "nx_user_oauth_identities" ADD CONSTRAINT "nx_user_oauth_identities_user_id_nx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."nx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_user_oauth_identities_user_idx" ON "nx_user_oauth_identities" USING btree ("user_id");