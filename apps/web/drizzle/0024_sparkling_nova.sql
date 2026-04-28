CREATE TABLE IF NOT EXISTS "nx_worker_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
