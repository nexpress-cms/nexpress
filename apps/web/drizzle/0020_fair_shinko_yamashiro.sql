CREATE TABLE "nx_member_mutes" (
	"member_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nx_member_mutes_member_id_target_id_pk" PRIMARY KEY("member_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "nx_member_mutes" ADD CONSTRAINT "nx_member_mutes_member_id_nx_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nx_member_mutes" ADD CONSTRAINT "nx_member_mutes_target_id_nx_members_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."nx_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nx_member_mutes_target_idx" ON "nx_member_mutes" USING btree ("target_id");