ALTER TYPE "public"."nx_user_role" ADD VALUE 'moderator' BEFORE 'author';--> statement-breakpoint
CREATE TABLE "nx_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_member_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nx_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolved_by_member_id" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nx_audit_events" ADD CONSTRAINT "nx_audit_events_actor_user_id_nx_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_audit_events" ADD CONSTRAINT "nx_audit_events_actor_member_id_nx_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."nx_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_reports" ADD CONSTRAINT "nx_reports_reporter_id_nx_members_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_reports" ADD CONSTRAINT "nx_reports_resolved_by_user_id_nx_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."nx_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_reports" ADD CONSTRAINT "nx_reports_resolved_by_member_id_nx_members_id_fk" FOREIGN KEY ("resolved_by_member_id") REFERENCES "public"."nx_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_audit_target_idx" ON "nx_audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "nx_audit_actor_user_idx" ON "nx_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "nx_audit_actor_member_idx" ON "nx_audit_events" USING btree ("actor_member_id","created_at");--> statement-breakpoint
CREATE INDEX "nx_reports_queue_idx" ON "nx_reports" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "nx_reports_target_idx" ON "nx_reports" USING btree ("target_type","target_id");