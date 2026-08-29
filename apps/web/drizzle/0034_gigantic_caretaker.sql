ALTER TABLE "np_agent_connection_secret_versions" DROP CONSTRAINT "np_agent_connection_secret_versions_subject_check";--> statement-breakpoint
ALTER TABLE "np_agent_connection_secret_versions" ADD CONSTRAINT "np_agent_connection_secret_versions_subject_check" CHECK ((
        "np_agent_connection_secret_versions"."purpose" = 'connection-credential' and
          (("np_agent_connection_secret_versions"."account_subject_key_id" is null and "np_agent_connection_secret_versions"."account_subject_digest" is null and
             "np_agent_connection_secret_versions"."status" in ('pending', 'revoked', 'destroyed') and "np_agent_connection_secret_versions"."activated_at" is null) or
           ("np_agent_connection_secret_versions"."account_subject_key_id" is not null and "np_agent_connection_secret_versions"."account_subject_digest" is not null))
      ) or (
        "np_agent_connection_secret_versions"."purpose" <> 'connection-credential' and "np_agent_connection_secret_versions"."account_subject_key_id" is null and "np_agent_connection_secret_versions"."account_subject_digest" is null
      ));--> statement-breakpoint
ALTER TABLE "np_agent_connection_secret_versions" DROP CONSTRAINT "np_agent_connection_secret_versions_locator_check";--> statement-breakpoint
ALTER TABLE "np_agent_connection_secret_versions" ADD CONSTRAINT "np_agent_connection_secret_versions_locator_check" CHECK (("np_agent_connection_secret_versions"."status" = 'destroyed' and "np_agent_connection_secret_versions"."secret_ref" is null) or
        ("np_agent_connection_secret_versions"."status" <> 'destroyed' and
          ("np_agent_connection_secret_versions"."secret_ref" is not null or "np_agent_connection_secret_versions"."status" in ('pending', 'revoked'))));
