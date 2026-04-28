CREATE TABLE "nx_job_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "nx_job_logs_job_idx" ON "nx_job_logs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "nx_job_logs_created_idx" ON "nx_job_logs" USING btree ("created_at");