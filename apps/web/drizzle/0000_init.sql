CREATE TYPE "public"."np_ban_kind" AS ENUM('temporary', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."np_ban_scope" AS ENUM('site', 'category', 'collection');--> statement-breakpoint
CREATE TYPE "public"."np_comment_status" AS ENUM('visible', 'pending', 'hidden', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."np_media_status" AS ENUM('processing', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."np_member_role_scope" AS ENUM('site', 'category', 'collection', 'thread');--> statement-breakpoint
CREATE TYPE "public"."np_member_status" AS ENUM('active', 'pending', 'suspended', 'deleted', 'imported');--> statement-breakpoint
CREATE TYPE "public"."np_password_reset_purpose" AS ENUM('invite', 'reset');--> statement-breakpoint
CREATE TYPE "public"."np_revision_status" AS ENUM('draft', 'published', 'autosave');--> statement-breakpoint
CREATE TYPE "public"."np_user_role" AS ENUM('admin', 'editor', 'moderator', 'author', 'viewer');--> statement-breakpoint
CREATE TABLE "np_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_member_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"site_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"scope_type" "np_ban_scope" NOT NULL,
	"scope_id" text,
	"kind" "np_ban_kind" NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text,
	"by_user_id" uuid,
	"by_member_id" uuid,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"parent_id" uuid,
	"member_id" uuid NOT NULL,
	"body_md" text NOT NULL,
	"body_html" text NOT NULL,
	"status" "np_comment_status" DEFAULT 'visible' NOT NULL,
	"hidden_by_user_id" uuid,
	"hidden_by_member_id" uuid,
	"hidden_reason" text,
	"edited_at" timestamp with time zone,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_follows_unique" UNIQUE("follower_id","target_type","target_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "np_job_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"filesize" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"alt" text,
	"caption" jsonb,
	"focal_point" jsonb,
	"sizes" jsonb,
	"storage_key" text NOT NULL,
	"hash" text NOT NULL,
	"status" "np_media_status" NOT NULL,
	"folder_id" uuid,
	"uploaded_by" uuid,
	"uploaded_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "np_media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_media_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"document_id" text NOT NULL,
	"field" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_member_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_member_identities_provider_subject_uq" UNIQUE("provider","subject"),
	CONSTRAINT "np_member_identities_member_provider_uq" UNIQUE("member_id","provider")
);
--> statement-breakpoint
CREATE TABLE "np_member_mutes" (
	"member_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_member_mutes_member_id_target_id_site_id_pk" PRIMARY KEY("member_id","target_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "np_member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	"scope_type" "np_member_role_scope" NOT NULL,
	"scope_id" text,
	"site_id" text DEFAULT 'default' NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "np_member_roles_grant_uq" UNIQUE NULLS NOT DISTINCT("member_id","role","scope_type","scope_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "np_member_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password" text,
	"display_name" text NOT NULL,
	"avatar" uuid,
	"bio" text,
	"status" "np_member_status" DEFAULT 'pending' NOT NULL,
	"reputation" integer DEFAULT 0 NOT NULL,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"password_reset_token_hash" text,
	"password_reset_expires_at" timestamp with time zone,
	"email_verify_token_hash" text,
	"email_verify_expires_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_members_handle_unique" UNIQUE("handle"),
	CONSTRAINT "np_members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "np_navigation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"location" text NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "np_navigation_site_location_idx" UNIQUE("site_id","location")
);
--> statement-breakpoint
CREATE TABLE "np_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_plugin_storage" (
	"plugin_id" text NOT NULL,
	"site_id" text DEFAULT '_global_' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_plugin_storage_plugin_id_site_id_key_pk" PRIMARY KEY("plugin_id","site_id","key")
);
--> statement-breakpoint
CREATE TABLE "np_plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_reactions_unique" UNIQUE("target_type","target_id","member_id","kind")
);
--> statement-breakpoint
CREATE TABLE "np_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolved_by_member_id" uuid,
	"resolution" text,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "np_revision_status" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_fields" text[] NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_revisions_document_id_version_unique" UNIQUE("document_id","version")
);
--> statement-breakpoint
CREATE TABLE "np_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_settings" (
	"site_id" text DEFAULT 'default' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "np_settings_site_id_key_pk" PRIMARY KEY("site_id","key")
);
--> statement-breakpoint
CREATE TABLE "np_site_memberships" (
	"site_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "np_user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_site_memberships_site_id_user_id_pk" PRIMARY KEY("site_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "np_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_sites_hostname_idx" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "np_slug_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"collection" text NOT NULL,
	"document_id" text NOT NULL,
	"old_slug" text NOT NULL,
	"new_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_string_overrides" (
	"site_id" text DEFAULT 'default' NOT NULL,
	"locale" text NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "np_string_overrides_site_id_locale_key_pk" PRIMARY KEY("site_id","locale","key")
);
--> statement-breakpoint
CREATE TABLE "np_user_oauth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_user_oauth_identities_provider_subject_unique" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "np_user_oauth_identities_user_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "np_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"role" "np_user_role" NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"avatar" uuid,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"password_reset_token_hash" text,
	"password_reset_expires_at" timestamp with time zone,
	"password_reset_purpose" "np_password_reset_purpose",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "np_worker_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_discussions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"member_author_id" uuid,
	"title" text NOT NULL,
	"body" jsonb,
	"category" text,
	"pinned" boolean,
	"locked" boolean,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"_status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"title" text NOT NULL,
	"seo_description" text,
	"template" text,
	"blocks" jsonb,
	"slug" text NOT NULL,
	"locale" text NOT NULL,
	"translation_group_id" uuid NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"_status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_posts__categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"posts_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content" jsonb NOT NULL,
	"cover_image" uuid,
	"published_at" timestamp with time zone,
	"author" uuid,
	"wp_original_author" text,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"_status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_posts__tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"posts_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "np_audit_events" ADD CONSTRAINT "np_audit_events_actor_user_id_np_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_audit_events" ADD CONSTRAINT "np_audit_events_actor_member_id_np_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_bans" ADD CONSTRAINT "np_bans_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_bans" ADD CONSTRAINT "np_bans_by_user_id_np_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_bans" ADD CONSTRAINT "np_bans_by_member_id_np_members_id_fk" FOREIGN KEY ("by_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_parent_id_np_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_hidden_by_user_id_np_users_id_fk" FOREIGN KEY ("hidden_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_hidden_by_member_id_np_members_id_fk" FOREIGN KEY ("hidden_by_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_follows" ADD CONSTRAINT "np_follows_follower_id_np_members_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media" ADD CONSTRAINT "np_media_folder_id_np_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."np_media_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media" ADD CONSTRAINT "np_media_uploaded_by_np_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media" ADD CONSTRAINT "np_media_uploaded_by_member_id_np_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."np_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media_folders" ADD CONSTRAINT "np_media_folders_parent_id_np_media_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_media_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media_refs" ADD CONSTRAINT "np_media_refs_media_id_np_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."np_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_identities" ADD CONSTRAINT "np_member_identities_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_mutes" ADD CONSTRAINT "np_member_mutes_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_mutes" ADD CONSTRAINT "np_member_mutes_target_id_np_members_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_roles" ADD CONSTRAINT "np_member_roles_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_roles" ADD CONSTRAINT "np_member_roles_granted_by_np_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_sessions" ADD CONSTRAINT "np_member_sessions_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_members" ADD CONSTRAINT "np_members_avatar_np_media_id_fk" FOREIGN KEY ("avatar") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_navigation" ADD CONSTRAINT "np_navigation_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_notifications" ADD CONSTRAINT "np_notifications_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reactions" ADD CONSTRAINT "np_reactions_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reports" ADD CONSTRAINT "np_reports_reporter_id_np_members_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reports" ADD CONSTRAINT "np_reports_resolved_by_user_id_np_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reports" ADD CONSTRAINT "np_reports_resolved_by_member_id_np_members_id_fk" FOREIGN KEY ("resolved_by_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_revisions" ADD CONSTRAINT "np_revisions_author_id_np_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_sessions" ADD CONSTRAINT "np_sessions_user_id_np_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."np_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_settings" ADD CONSTRAINT "np_settings_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_site_memberships" ADD CONSTRAINT "np_site_memberships_user_id_np_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."np_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_string_overrides" ADD CONSTRAINT "np_string_overrides_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_user_oauth_identities" ADD CONSTRAINT "np_user_oauth_identities_user_id_np_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."np_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_users" ADD CONSTRAINT "np_users_avatar_np_media_id_fk" FOREIGN KEY ("avatar") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_categories" ADD CONSTRAINT "np_c_categories_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_categories" ADD CONSTRAINT "np_c_categories_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_discussions" ADD CONSTRAINT "np_c_discussions_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_discussions" ADD CONSTRAINT "np_c_discussions_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_discussions" ADD CONSTRAINT "np_c_discussions_member_author_id_np_members_id_fk" FOREIGN KEY ("member_author_id") REFERENCES "public"."np_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_pages" ADD CONSTRAINT "np_c_pages_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_pages" ADD CONSTRAINT "np_c_pages_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__categories" ADD CONSTRAINT "np_c_posts__categories_posts_id_np_c_posts_id_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."np_c_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__categories" ADD CONSTRAINT "np_c_posts__categories_target_id_np_c_categories_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_cover_image_np_media_id_fk" FOREIGN KEY ("cover_image") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_author_np_users_id_fk" FOREIGN KEY ("author") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__tags" ADD CONSTRAINT "np_c_posts__tags_posts_id_np_c_posts_id_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."np_c_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__tags" ADD CONSTRAINT "np_c_posts__tags_target_id_np_c_tags_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_tags" ADD CONSTRAINT "np_c_tags_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_tags" ADD CONSTRAINT "np_c_tags_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_audit_target_idx" ON "np_audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "np_audit_actor_user_idx" ON "np_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "np_audit_actor_member_idx" ON "np_audit_events" USING btree ("actor_member_id","created_at");--> statement-breakpoint
CREATE INDEX "np_audit_site_idx" ON "np_audit_events" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "np_bans_member_scope_idx" ON "np_bans" USING btree ("member_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "np_bans_active_idx" ON "np_bans" USING btree ("member_id","expires_at");--> statement-breakpoint
CREATE INDEX "np_bans_site_idx" ON "np_bans" USING btree ("site_id","member_id");--> statement-breakpoint
CREATE INDEX "np_comments_target_idx" ON "np_comments" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "np_comments_member_idx" ON "np_comments" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "np_comments_site_idx" ON "np_comments" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "np_follows_target_idx" ON "np_follows" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "np_follows_site_idx" ON "np_follows" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_job_logs_job_idx" ON "np_job_logs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "np_job_logs_created_idx" ON "np_job_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "np_media_hash_idx" ON "np_media" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "np_media_status_idx" ON "np_media" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_media_uploaded_by_member_idx" ON "np_media" USING btree ("uploaded_by_member_id");--> statement-breakpoint
CREATE INDEX "np_media_refs_media_id_idx" ON "np_media_refs" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "np_media_refs_document_id_idx" ON "np_media_refs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "np_member_identities_member_idx" ON "np_member_identities" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "np_member_mutes_target_idx" ON "np_member_mutes" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "np_member_roles_member_idx" ON "np_member_roles" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "np_member_roles_scope_idx" ON "np_member_roles" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "np_member_roles_site_idx" ON "np_member_roles" USING btree ("site_id","member_id");--> statement-breakpoint
CREATE INDEX "np_members_status_idx" ON "np_members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_notifications_inbox_idx" ON "np_notifications" USING btree ("member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "np_notifications_site_inbox_idx" ON "np_notifications" USING btree ("site_id","member_id","read_at");--> statement-breakpoint
CREATE INDEX "np_plugin_storage_plugin_id_idx" ON "np_plugin_storage" USING btree ("plugin_id");--> statement-breakpoint
CREATE INDEX "np_plugin_storage_site_idx" ON "np_plugin_storage" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_reactions_target_idx" ON "np_reactions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "np_reactions_site_idx" ON "np_reactions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_reports_queue_idx" ON "np_reports" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "np_reports_target_idx" ON "np_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "np_reports_site_queue_idx" ON "np_reports" USING btree ("site_id","resolved_at");--> statement-breakpoint
CREATE INDEX "np_revisions_collection_idx" ON "np_revisions" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "np_revisions_document_id_idx" ON "np_revisions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "np_slug_history_lookup_idx" ON "np_slug_history" USING btree ("site_id","collection","old_slug");--> statement-breakpoint
CREATE INDEX "np_slug_history_doc_idx" ON "np_slug_history" USING btree ("site_id","collection","document_id");--> statement-breakpoint
CREATE INDEX "np_user_oauth_identities_user_idx" ON "np_user_oauth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "np_c_categories_status_idx" ON "np_c_categories" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_categories_site_slug_idx" ON "np_c_categories" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_categories_site_idx" ON "np_c_categories" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_discussions_status_idx" ON "np_c_discussions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_c_discussions_member_author_idx" ON "np_c_discussions" USING btree ("member_author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_discussions_site_slug_idx" ON "np_c_discussions" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_discussions_site_idx" ON "np_c_discussions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_pages_status_idx" ON "np_c_pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_pages_site_locale_slug_idx" ON "np_c_pages" USING btree ("site_id","locale","slug");--> statement-breakpoint
CREATE INDEX "np_c_pages_translation_group_idx" ON "np_c_pages" USING btree ("translation_group_id");--> statement-breakpoint
CREATE INDEX "np_c_pages_locale_idx" ON "np_c_pages" USING btree ("locale");--> statement-breakpoint
CREATE INDEX "np_c_pages_site_idx" ON "np_c_pages" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_posts__categories_posts_id_idx" ON "np_c_posts__categories" USING btree ("posts_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_posts__categories_parent_target_uidx" ON "np_c_posts__categories" USING btree ("posts_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_posts_status_idx" ON "np_c_posts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_posts_site_slug_idx" ON "np_c_posts" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_posts_site_idx" ON "np_c_posts" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_posts__tags_posts_id_idx" ON "np_c_posts__tags" USING btree ("posts_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_posts__tags_parent_target_uidx" ON "np_c_posts__tags" USING btree ("posts_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_tags_status_idx" ON "np_c_tags" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_tags_site_slug_idx" ON "np_c_tags" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_tags_site_idx" ON "np_c_tags" USING btree ("site_id");--> statement-breakpoint
-- Seed: default site row. Single-tenant installs depend on this row
-- existing without operator intervention; additional sites are added
-- via the super-admin UI. The squashed migration history dropped the
-- original seed (formerly in 0015), so re-inject it here. drizzle-kit
-- doesn't emit data INSERTs, so this seed must be hand-maintained.
INSERT INTO "np_sites" ("id", "name", "is_default", "settings")
  VALUES ('default', 'Default site', true, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;