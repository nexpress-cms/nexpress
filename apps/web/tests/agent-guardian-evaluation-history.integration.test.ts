import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgentGuardianEvaluationV1 } from "../../../packages/core/src/agent/guardian-evaluation.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "../../../packages/core/src/agent/evaluation-workbench.js";
import { createAgentEvaluationHistoryServiceV1 } from "../../../packages/core/src/agent/evaluation-history-service.js";
import type { NpAgentEvaluationHistorySaveV1 } from "../../../packages/core/src/agent-contract/evaluation-history-contract.js";
import {
  npAgentEvaluationSources,
  npAgentEvaluationReviews,
  npAgentApprovals,
  npAgentProviderCalls,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function setup() {
  const f = await fixture();
  const evaluation = await runAgentGuardianEvaluationV1();
  const workbench = await npBuildAgentEvaluationWorkbenchV1({
    schemaVersion: "np.agent-eval-workbench-request.v1",
    recipe: "guardian",
    evaluation,
    review: null,
    baseline: null,
    baselineReview: null,
    labels: null,
  });
  const target = workbench.cases[0];
  if (!target.predictionHash) throw new Error("Expected reviewable synthetic prediction");
  const command: NpAgentEvaluationHistorySaveV1 = {
    schemaVersion: "np.agent-evaluation-history-save.v1",
    recipe: "guardian",
    evaluationJson: JSON.stringify(evaluation),
    sourceHash: workbench.sourceHash,
    expectedVersion: 0,
    caseId: target.caseId,
    caseVersion: target.caseVersion,
    caseHash: target.caseHash,
    predictionHash: target.predictionHash,
    decision: {
      outcome: "accept",
      notes: "Synthetic prediction support only; no live authority.",
      editedProposalJson: null,
    },
    idempotencyKey: randomUUID(),
  };
  const history = createAgentEvaluationHistoryServiceV1();
  const input = { siteId, actor: f.actor.actor };
  return { ...f, evaluation, command, history, input };
}
describe.skipIf(skipIfNoTestDb())("Guardian exact-bound authenticated evaluation history", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("persists a distinct Guardian source and exact staff review with replay and no approval or execution", async () => {
    const f = await setup();
    const result = await f.history.save({ ...f.input, command: f.command });
    expect(await f.history.save({ ...f.input, command: f.command })).toMatchObject({
      ...result,
      replayed: true,
    });
    expect((await f.history.list({ ...f.input, recipe: "guardian" })).sources).toMatchObject([
      { recipe: "guardian", sourceHash: f.command.sourceHash, caseCount: 64, version: 1 },
    ]);
    const detail = await f.history.get({ ...f.input, sourceId: result.resourceId });
    expect(detail.authority).toBe("authenticated-staff-review-no-approval");
    expect(JSON.parse(detail.evaluationJson)).toEqual(f.evaluation);
    const revisions = await f.history.history({
      ...f.input,
      sourceId: result.resourceId,
      caseId: f.command.caseId,
      caseVersion: f.command.caseVersion,
    });
    expect(revisions.revisions).toHaveLength(1);
    expect(JSON.parse(revisions.revisions[0].labelJson!)).toMatchObject({
      caseHash: f.command.caseHash,
      predictionHash: f.command.predictionHash,
      sourceHash: f.command.sourceHash,
      outcome: "accept",
      editedProposal: null,
    });
    expect(await f.db.select().from(npAgentEvaluationSources)).toHaveLength(1);
    expect(await f.db.select().from(npAgentEvaluationReviews)).toHaveLength(1);
    for (const table of [npAgentApprovals, npAgentProviderCalls, npAgentRuns])
      expect(await f.db.select().from(table)).toEqual([]);
    await expect(
      f.history.get({ ...f.input, siteId: "draft-other", sourceId: result.resourceId }),
    ).rejects.toThrow();
    await f.db
      .update(npSessions)
      .set({ accessExpiresAt: new Date(0) })
      .where(eq(npSessions.id, f.actor.actor.sessionId));
    await expect(f.history.list({ ...f.input, recipe: "guardian" })).rejects.toThrow();
  });
  it("rejects forged source/case/prediction binding and action edits without creating history", async () => {
    const f = await setup();
    for (const field of ["sourceHash", "caseHash", "predictionHash"] as const)
      await expect(
        f.history.save({
          ...f.input,
          command: {
            ...f.command,
            [field]: `cj1:sha256:${"A".repeat(43)}`,
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toThrow();
    await expect(
      f.history.save({
        ...f.input,
        command: {
          ...f.command,
          decision: { outcome: "edit", notes: "Attempt authority edit", editedProposalJson: "{}" },
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    expect(await f.db.select().from(npAgentEvaluationSources)).toEqual([]);
    expect(await f.db.select().from(npAgentEvaluationReviews)).toEqual([]);
  });
});
