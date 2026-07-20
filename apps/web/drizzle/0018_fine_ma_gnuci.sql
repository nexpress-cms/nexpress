CREATE TABLE "np_c_forum-posts__attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"file" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "np_c_forum-boards" ADD COLUMN "attachments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "np_c_forum-boards" ADD COLUMN "max_attachments" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "np_c_forum-boards" ADD COLUMN "max_attachment_size_mb" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts__attachments" ADD CONSTRAINT "np_c_forum-posts__attachments_parent_id_np_c_forum-posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_c_forum-posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts__attachments" ADD CONSTRAINT "np_c_forum-posts__attachments_file_np_media_id_fk" FOREIGN KEY ("file") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_c_forum-posts__attachments_parent_idx" ON "np_c_forum-posts__attachments" USING btree ("parent_id");