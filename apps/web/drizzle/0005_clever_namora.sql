CREATE TYPE "public"."nx_comment_status" AS ENUM('visible', 'pending', 'hidden', 'deleted');--> statement-breakpoint
CREATE TABLE "nx_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"parent_id" uuid,
	"member_id" uuid NOT NULL,
	"body_md" text NOT NULL,
	"body_html" text NOT NULL,
	"status" "nx_comment_status" DEFAULT 'visible' NOT NULL,
	"hidden_by_user_id" uuid,
	"hidden_by_member_id" uuid,
	"hidden_reason" text,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nx_comments" ADD CONSTRAINT "nx_comments_parent_id_nx_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."nx_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_comments" ADD CONSTRAINT "nx_comments_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_comments" ADD CONSTRAINT "nx_comments_hidden_by_user_id_nx_users_id_fk" FOREIGN KEY ("hidden_by_user_id") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_comments" ADD CONSTRAINT "nx_comments_hidden_by_member_id_nx_members_id_fk" FOREIGN KEY ("hidden_by_member_id") REFERENCES "public"."nx_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_comments_target_idx" ON "nx_comments" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "nx_comments_member_idx" ON "nx_comments" USING btree ("member_id","created_at");