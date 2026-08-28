ALTER TABLE "np_agent_principals" DROP CONSTRAINT "np_agent_principals_token_version_check";--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" DROP CONSTRAINT "np_agent_service_tokens_versions_check";--> statement-breakpoint
ALTER TABLE "np_agent_principals" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" ADD COLUMN "principal_token_version" integer;--> statement-breakpoint
UPDATE "np_agent_service_tokens" AS token
SET "principal_token_version" = principal."token_version"
FROM "np_agent_principals" AS principal
WHERE token."site_id" = principal."site_id"
  AND token."principal_id" = principal."id";--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" ALTER COLUMN "principal_token_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "np_agent_principals" ADD CONSTRAINT "np_agent_principals_versions_check" CHECK ("np_agent_principals"."row_version" > 0 and "np_agent_principals"."token_version" > 0);--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" ADD CONSTRAINT "np_agent_service_tokens_versions_check" CHECK ("np_agent_service_tokens"."family_authority_version" > 0 and "np_agent_service_tokens"."family_generation" > 0 and "np_agent_service_tokens"."principal_token_version" > 0 and "np_agent_service_tokens"."row_version" > 0);
