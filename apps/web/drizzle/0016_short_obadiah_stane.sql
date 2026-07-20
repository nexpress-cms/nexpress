CREATE TABLE "np_c_forum-boards__categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_forum-boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"skin" text DEFAULT 'classic' NOT NULL,
	"write_mode" text DEFAULT 'members' NOT NULL,
	"moderation" text DEFAULT 'published' NOT NULL,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"page_size" integer DEFAULT 20 NOT NULL,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_forum-posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"member_author_id" uuid,
	"board" uuid NOT NULL,
	"board_key" text,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"category" text,
	"pinned" boolean DEFAULT false,
	"locked" boolean DEFAULT false,
	"site_id" text DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "np_c_forum-boards__categories" ADD CONSTRAINT "np_c_forum-boards__categories_parent_id_np_c_forum-boards_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_c_forum-boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_forum-boards" ADD CONSTRAINT "np_c_forum-boards_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_forum-boards" ADD CONSTRAINT "np_c_forum-boards_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD CONSTRAINT "np_c_forum-posts_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD CONSTRAINT "np_c_forum-posts_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD CONSTRAINT "np_c_forum-posts_member_author_id_np_members_id_fk" FOREIGN KEY ("member_author_id") REFERENCES "public"."np_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD CONSTRAINT "np_c_forum-posts_board_np_c_forum-boards_id_fk" FOREIGN KEY ("board") REFERENCES "public"."np_c_forum-boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_c_forum-boards__categories_parent_idx" ON "np_c_forum-boards__categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "np_c_forum-boards_status_idx" ON "np_c_forum-boards" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_forum-boards_site_slug_idx" ON "np_c_forum-boards" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_forum-boards_site_idx" ON "np_c_forum-boards" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_forum-posts_status_idx" ON "np_c_forum-posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_c_forum-posts_member_author_idx" ON "np_c_forum-posts" USING btree ("member_author_id");--> statement-breakpoint
CREATE INDEX "np_c_forum-posts_site_idx" ON "np_c_forum-posts" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_forum-posts_board_list_idx" ON "np_c_forum-posts" USING btree ("site_id","board","status","pinned","created_at" DESC);
