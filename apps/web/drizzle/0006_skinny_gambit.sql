CREATE TABLE "nx_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_follows_unique" UNIQUE("follower_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "nx_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_reactions_unique" UNIQUE("target_type","target_id","member_id","kind")
);
--> statement-breakpoint
ALTER TABLE "nx_follows" ADD CONSTRAINT "nx_follows_follower_id_nx_members_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_notifications" ADD CONSTRAINT "nx_notifications_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_reactions" ADD CONSTRAINT "nx_reactions_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_follows_target_idx" ON "nx_follows" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "nx_notifications_inbox_idx" ON "nx_notifications" USING btree ("member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "nx_reactions_target_idx" ON "nx_reactions" USING btree ("target_type","target_id");