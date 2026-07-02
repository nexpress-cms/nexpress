CREATE TABLE "np_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'wordpress' NOT NULL,
	"mode" text DEFAULT 'apply' NOT NULL,
	"source_name" text NOT NULL,
	"source_size" integer NOT NULL,
	"source_mime_type" text,
	"source_xml" text,
	"options" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"report" jsonb,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "np_import_runs" ADD CONSTRAINT "np_import_runs_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_import_runs_status_created_idx" ON "np_import_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "np_import_runs_created_idx" ON "np_import_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "np_import_runs_created_by_idx" ON "np_import_runs" USING btree ("created_by");