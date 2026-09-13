import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import {
  npAgentApprovals,
  npAgentChangesetExecutions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npNormalizeJobPayload } from "../../../packages/core/src/jobs-contract/contract.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import { runtimeFingerprint } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Runtime scheduled execution current policy", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("does not apply an approved reservation after its current execution mode is narrowed", async () => {
    const f = await runtimeApprovalResumeFixture("schedule");
    await f.approve();
    const acquired = await f.store.claimApproval({
      ...f.input,
      requestActionId: f.requestActionId,
    });
    if (!acquired.claim) throw new Error("Expected approved Runtime claim");
    await f.service.resumeRuntimeApproval({
      ...f.input,
      claim: acquired.claim,
      requestActionId: f.requestActionId,
      sequence: 5,
    });
    expect(f.applyJobs).toHaveLength(1);
    const job = npNormalizeJobPayload("agent:changesetApply", f.applyJobs[0]);
    await npWithAgentRuntimeControlTransactionV1(f.input.siteId, ({ db, revision, settings }) => {
      settings.defaultPolicyRules.capabilityModes = settings.defaultPolicyRules.capabilityModes.map(
        (entry) =>
          entry.capabilityId === "changeset.schedule" ? { ...entry, mode: "observe" } : entry,
      );
      return f.controls.updateInTransaction({
        db,
        siteId: f.input.siteId,
        expectedRevision: revision,
        actorFingerprint: runtimeFingerprint,
        settings,
      });
    });
    f.advance(61);
    await f.service.processExecution(job);
    const [execution] = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(
        and(
          eq(npAgentChangesetExecutions.siteId, f.input.siteId),
          eq(npAgentChangesetExecutions.changesetId, f.sealed.id),
        ),
      );
    expect(execution.state).toBe("failed");
    expect(execution.committedAt).toBeNull();
    const [approval] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, f.required.approvalId));
    expect(approval.state).not.toBe("consumed");
    expect(
      await f.db
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, f.input.siteId), eq(npSettings.key, "seo"))),
    ).toEqual([]);
    expect(f.providerInvoke).not.toHaveBeenCalled();
  });
});
