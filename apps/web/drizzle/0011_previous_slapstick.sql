ALTER TABLE "np_import_runs" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "np_import_runs" ADD COLUMN "resume_state" jsonb;--> statement-breakpoint
CREATE INDEX "np_import_runs_source_hash_idx" ON "np_import_runs" USING btree ("kind","source_hash","created_at");