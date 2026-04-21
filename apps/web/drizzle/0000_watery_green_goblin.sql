CREATE TYPE "public"."nx_media_status" AS ENUM('processing', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."nx_revision_status" AS ENUM('draft', 'published', 'autosave');--> statement-breakpoint
CREATE TYPE "public"."nx_user_role" AS ENUM('admin', 'editor', 'author', 'viewer');--> statement-breakpoint
CREATE TABLE "nx_media" (
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
	"status" "nx_media_status" NOT NULL,
	"folder_id" uuid,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nx_media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_media_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"document_id" text NOT NULL,
	"field" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_navigation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" text NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "nx_navigation_location_unique" UNIQUE("location")
);
--> statement-breakpoint
CREATE TABLE "nx_plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "nx_revision_status" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_fields" text[] NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_revisions_document_id_version_unique" UNIQUE("document_id","version")
);
--> statement-breakpoint
CREATE TABLE "nx_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "nx_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"role" "nx_user_role" NOT NULL,
	"avatar" uuid,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "nx_media" ADD CONSTRAINT "nx_media_folder_id_nx_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."nx_media_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_media" ADD CONSTRAINT "nx_media_uploaded_by_nx_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_media_folders" ADD CONSTRAINT "nx_media_folders_parent_id_nx_media_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."nx_media_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_media_refs" ADD CONSTRAINT "nx_media_refs_media_id_nx_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."nx_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_navigation" ADD CONSTRAINT "nx_navigation_updated_by_nx_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_revisions" ADD CONSTRAINT "nx_revisions_author_id_nx_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_sessions" ADD CONSTRAINT "nx_sessions_user_id_nx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."nx_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_settings" ADD CONSTRAINT "nx_settings_updated_by_nx_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_users" ADD CONSTRAINT "nx_users_avatar_nx_media_id_fk" FOREIGN KEY ("avatar") REFERENCES "public"."nx_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_media_hash_idx" ON "nx_media" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "nx_media_status_idx" ON "nx_media" USING btree ("status");--> statement-breakpoint
CREATE INDEX "nx_media_refs_media_id_idx" ON "nx_media_refs" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "nx_media_refs_document_id_idx" ON "nx_media_refs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "nx_revisions_collection_idx" ON "nx_revisions" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "nx_revisions_document_id_idx" ON "nx_revisions" USING btree ("document_id");