CREATE TYPE "public"."nx_ban_kind" AS ENUM('temporary', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."nx_ban_scope" AS ENUM('site', 'category', 'collection');--> statement-breakpoint
CREATE TYPE "public"."nx_member_role_scope" AS ENUM('site', 'category', 'collection', 'thread');--> statement-breakpoint
CREATE TYPE "public"."nx_member_status" AS ENUM('active', 'pending', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "nx_bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"scope_type" "nx_ban_scope" NOT NULL,
	"scope_id" text,
	"kind" "nx_ban_kind" NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text,
	"by_user_id" uuid,
	"by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_member_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_member_identities_provider_subject_uq" UNIQUE("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "nx_member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	"scope_type" "nx_member_role_scope" NOT NULL,
	"scope_id" text,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "nx_member_roles_grant_uq" UNIQUE NULLS NOT DISTINCT("member_id","role","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "nx_member_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password" text,
	"display_name" text NOT NULL,
	"avatar" uuid,
	"bio" text,
	"status" "nx_member_status" DEFAULT 'pending' NOT NULL,
	"reputation" integer DEFAULT 0 NOT NULL,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"password_reset_token_hash" text,
	"password_reset_expires_at" timestamp with time zone,
	"email_verify_token_hash" text,
	"email_verify_expires_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_members_handle_unique" UNIQUE("handle"),
	CONSTRAINT "nx_members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "nx_bans" ADD CONSTRAINT "nx_bans_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_bans" ADD CONSTRAINT "nx_bans_by_user_id_nx_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_bans" ADD CONSTRAINT "nx_bans_by_member_id_nx_members_id_fk" FOREIGN KEY ("by_member_id") REFERENCES "public"."nx_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_member_identities" ADD CONSTRAINT "nx_member_identities_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_member_roles" ADD CONSTRAINT "nx_member_roles_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_member_roles" ADD CONSTRAINT "nx_member_roles_granted_by_nx_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_member_sessions" ADD CONSTRAINT "nx_member_sessions_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_members" ADD CONSTRAINT "nx_members_avatar_nx_media_id_fk" FOREIGN KEY ("avatar") REFERENCES "public"."nx_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_bans_member_scope_idx" ON "nx_bans" USING btree ("member_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "nx_bans_active_idx" ON "nx_bans" USING btree ("member_id","expires_at");--> statement-breakpoint
CREATE INDEX "nx_member_roles_member_idx" ON "nx_member_roles" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "nx_member_roles_scope_idx" ON "nx_member_roles" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "nx_members_status_idx" ON "nx_members" USING btree ("status");