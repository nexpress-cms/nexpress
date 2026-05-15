ALTER TABLE "np_c_discussions" ALTER COLUMN "pinned" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "np_c_discussions" ALTER COLUMN "locked" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "np_c_docs" ADD COLUMN "lede" text;--> statement-breakpoint
ALTER TABLE "np_c_docs" ADD COLUMN "stable_since" text;--> statement-breakpoint
ALTER TABLE "np_c_docs" ADD COLUMN "badge" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "kind" text DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "parent" uuid;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "order" double precision;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "discipline" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "span" double precision;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "cover_variant" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "cover_figure" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "badge" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_parent_np_c_posts_id_fk" FOREIGN KEY ("parent") REFERENCES "public"."np_c_posts"("id") ON DELETE no action ON UPDATE no action;