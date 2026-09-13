import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentChangesetValidationAttempts,
  npAgentChangesetPreviews,
  npAgentPreviewArtifacts,
} from "../../../packages/core/src/db/schema/agent.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
describe.skipIf(skipIfNoTestDb())("Runtime queued ChangeSet current policy", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  for (const kind of ["validation", "preview"] as const)
    it(`blocks queued ${kind} after its capability is removed`, async () => {
      const done = new Error("queued policy assertion completed");
      await expect(
        runtimeApprovalResumeFixture("apply", {
          queuedWork: {
            kind,
            check: async ({ fixture: f, service, job }) => {
              const settings = structuredClone(f.settings);
              settings.defaultPolicyRules.capabilityModes =
                settings.defaultPolicyRules.capabilityModes.filter(
                  (row) =>
                    row.capabilityId !==
                    (kind === "validation" ? "changeset.validate" : "changeset.preview"),
                );
              await npWithAgentRuntimeControlTransactionV1(job.siteId, ({ db, revision }) =>
                f.controls.updateInTransaction({
                  db,
                  siteId: job.siteId,
                  expectedRevision: revision,
                  actorFingerprint: f.options.deploymentAuthority.fingerprint,
                  settings,
                }),
              );
              if (kind === "validation") {
                await service.processValidation({ siteId: job.siteId, attemptId: job.id });
                const [row] = await f.db
                  .select()
                  .from(npAgentChangesetValidationAttempts)
                  .where(eq(npAgentChangesetValidationAttempts.id, job.id));
                expect(row.state).toBe("failed");
                expect(row.errorCode).toBe("AUTHORITY_REVOKED");
              } else {
                await service.processPreview({ siteId: job.siteId, previewId: job.id });
                const [row] = await f.db
                  .select()
                  .from(npAgentChangesetPreviews)
                  .where(eq(npAgentChangesetPreviews.id, job.id));
                expect(row.state).not.toBe("ready");
                expect(
                  await f.db
                    .select()
                    .from(npAgentPreviewArtifacts)
                    .where(eq(npAgentPreviewArtifacts.previewId, job.id)),
                ).toEqual([]);
              }
              throw done;
            },
          },
        }),
      ).rejects.toBe(done);
    }, 90000);
});
