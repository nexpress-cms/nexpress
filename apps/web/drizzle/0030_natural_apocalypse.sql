ALTER TABLE "np_c_forum-posts" ADD COLUMN "context_type" text;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "context_id" text;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "context_label" text;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "context_href" text;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "context_proof" text;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "answer_body" jsonb;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "np_c_forum-posts" ADD COLUMN "answered_by_user_id" text;