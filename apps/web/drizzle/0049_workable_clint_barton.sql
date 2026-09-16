CREATE TABLE "np_agent_reference_fence" (
	"id" integer PRIMARY KEY NOT NULL,
	"epoch" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "np_agent_reference_fence_singleton_check" CHECK ("np_agent_reference_fence"."id"=1 and "np_agent_reference_fence"."epoch">=0)
);
--> statement-breakpoint
CREATE TABLE "np_agent_source_release_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"source_release_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"edge_code" text NOT NULL,
	"owner_evidence_digest" text NOT NULL,
	"verifier_version" integer DEFAULT 1 NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_source_release_edges_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_source_release_edges_owner_unique" UNIQUE("site_id","source_release_id","owner_kind","owner_id","edge_code"),
	CONSTRAINT "np_agent_source_release_edges_owner_check" CHECK ("np_agent_source_release_edges"."owner_kind" in ('runtime-audit','read-action','read-invocation')),
	CONSTRAINT "np_agent_source_release_edges_code_check" CHECK (("np_agent_source_release_edges"."owner_kind"='runtime-audit' and "np_agent_source_release_edges"."edge_code" in ('audit-target','audit-run','audit-reservation')) or ("np_agent_source_release_edges"."owner_kind"='read-action' and "np_agent_source_release_edges"."edge_code"='action-run') or ("np_agent_source_release_edges"."owner_kind"='read-invocation' and "np_agent_source_release_edges"."edge_code"='invocation-authority-run')),
	CONSTRAINT "np_agent_source_release_edges_digest_check" CHECK ("np_agent_source_release_edges"."owner_evidence_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_source_release_edges"."verifier_version"=1)
);
--> statement-breakpoint
CREATE TABLE "np_agent_source_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"evidence_body" jsonb NOT NULL,
	"evidence_digest" text NOT NULL,
	"principal_id" uuid,
	"admission_key_digest" text,
	"released_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_source_releases_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_source_releases_source_unique" UNIQUE("site_id","source_kind","source_id"),
	CONSTRAINT "np_agent_source_releases_kind_check" CHECK ("np_agent_source_releases"."source_kind" in ('runtime-run','provider-call','usage-reservation','circuit-breaker')),
	CONSTRAINT "np_agent_source_releases_body_check" CHECK ((jsonb_typeof("np_agent_source_releases"."evidence_body")='object' and octet_length("np_agent_source_releases"."evidence_body"::text)<=16384 and "np_agent_source_releases"."evidence_body"->>'schemaVersion'='np.agent-source-release.v1' and "np_agent_source_releases"."evidence_body"->>'kind'="np_agent_source_releases"."source_kind" and "np_agent_source_releases"."evidence_body"->>'siteId'="np_agent_source_releases"."site_id" and "np_agent_source_releases"."evidence_body"->>'sourceId'="np_agent_source_releases"."source_id"::text and ("np_agent_source_releases"."evidence_body"->>'releasedAt')::timestamptz="np_agent_source_releases"."released_at" and "np_agent_source_releases"."evidence_body"->>'verifierVersion'='1') is true),
	CONSTRAINT "np_agent_source_releases_key_check" CHECK (((("np_agent_source_releases"."source_kind"='runtime-run') and "np_agent_source_releases"."principal_id" is not null and "np_agent_source_releases"."admission_key_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_source_releases"."evidence_body"->>'principalId'="np_agent_source_releases"."principal_id"::text and "np_agent_source_releases"."evidence_body"->>'admissionKeyDigest'="np_agent_source_releases"."admission_key_digest") or ("np_agent_source_releases"."source_kind"<>'runtime-run' and "np_agent_source_releases"."principal_id" is null and "np_agent_source_releases"."admission_key_digest" is null)) is true),
	CONSTRAINT "np_agent_source_releases_digest_check" CHECK ("np_agent_source_releases"."evidence_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
ALTER TABLE "np_agent_actions" DROP CONSTRAINT "np_agent_actions_attribution_check";--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD COLUMN "run_source_release_id" uuid;--> statement-breakpoint
ALTER TABLE "np_agent_source_release_edges" ADD CONSTRAINT "np_agent_source_release_edges_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_source_release_edges" ADD CONSTRAINT "np_agent_source_release_edges_release_fk" FOREIGN KEY ("site_id","source_release_id") REFERENCES "public"."np_agent_source_releases"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_source_releases" ADD CONSTRAINT "np_agent_source_releases_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_source_releases" ADD CONSTRAINT "np_agent_source_releases_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_source_release_edges_owner_idx" ON "np_agent_source_release_edges" USING btree ("site_id","owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "np_agent_source_releases_source_idx" ON "np_agent_source_releases" USING btree ("source_id","site_id");--> statement-breakpoint
CREATE INDEX "np_agent_source_releases_reservation_idx" ON "np_agent_source_releases" USING btree ("site_id",("evidence_body"->>'reservationId')) WHERE "np_agent_source_releases"."source_kind"='provider-call';--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_source_releases_key_unique" ON "np_agent_source_releases" USING btree ("site_id","principal_id","admission_key_digest") WHERE "np_agent_source_releases"."source_kind"='runtime-run';--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_run_release_fk" FOREIGN KEY ("site_id","run_source_release_id") REFERENCES "public"."np_agent_source_releases"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_attribution_check" CHECK (((("np_agent_actions"."run_id" is not null and "np_agent_actions"."run_fingerprint" is not null and "np_agent_actions"."run_source_release_id" is null) or
        ("np_agent_actions"."run_id" is null and "np_agent_actions"."run_fingerprint" is null and "np_agent_actions"."run_source_release_id" is null) or
        ("np_agent_actions"."run_id" is null and "np_agent_actions"."run_fingerprint" is not null and "np_agent_actions"."run_source_release_id" is not null)) and
        ("np_agent_actions"."execution_invocation_id" is null) = ("np_agent_actions"."execution_invocation_fingerprint" is null)) is true);