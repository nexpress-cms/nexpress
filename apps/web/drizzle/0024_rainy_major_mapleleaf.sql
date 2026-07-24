CREATE TABLE "np_community_realtime_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"channel" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"member_id" uuid,
	"site_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_community_realtime_channel_check" CHECK ("np_community_realtime_events"."channel" in ('comments', 'reactions', 'notifications')),
	CONSTRAINT "np_community_realtime_route_check" CHECK ((
        ("np_community_realtime_events"."channel" in ('comments', 'reactions')
          and "np_community_realtime_events"."target_type" is not null
          and "np_community_realtime_events"."target_id" is not null
          and "np_community_realtime_events"."member_id" is null)
        or
        ("np_community_realtime_events"."channel" = 'notifications'
          and "np_community_realtime_events"."target_type" is null
          and "np_community_realtime_events"."target_id" is null
          and "np_community_realtime_events"."member_id" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "np_community_realtime_events" ADD CONSTRAINT "np_community_realtime_events_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_community_realtime_document_idx" ON "np_community_realtime_events" USING btree ("site_id","target_type","target_id","sequence");--> statement-breakpoint
CREATE INDEX "np_community_realtime_inbox_idx" ON "np_community_realtime_events" USING btree ("site_id","member_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "np_community_realtime_sequence_uidx" ON "np_community_realtime_events" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "np_community_realtime_retention_idx" ON "np_community_realtime_events" USING btree ("created_at");