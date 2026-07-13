UPDATE "np_revisions" AS "revision"
SET "changed_fields" = ARRAY(
  SELECT DISTINCT "field"
  FROM unnest("revision"."changed_fields") AS "fields"("field")
  ORDER BY "field"
);--> statement-breakpoint
ALTER TABLE "np_revisions" DROP CONSTRAINT "np_revisions_document_id_version_unique";--> statement-breakpoint
ALTER TABLE "np_revisions" ADD CONSTRAINT "np_revisions_document_id_version_unique" UNIQUE("collection","document_id","version");
