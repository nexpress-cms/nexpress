ALTER TABLE "np_c_forum-boards" ADD COLUMN "audience" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "audience" text DEFAULT 'public' NOT NULL;