import pg from "pg";
import { writeFileSync } from "node:fs";
import {
  createIntegrationWorkScope,
  settleIntegrationWork,
} from "../../../packages/core/src/integration/work-scope.js";
import { randomUUID } from "node:crypto";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import { npRequireAgentModeratorAssessmentEvidenceV2 } from "../../../packages/core/src/agent-contract/moderator-segmented-assessment-contract.js";
import { serializeAgentCanonicalJson } from "../../../packages/core/src/agent-contract/canonical-foundation.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderInvokeOutcomeV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidentTimeline,
  npAgentIncidents,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentEvents,
} from "../../../packages/core/src/db/schema/agent.js";
import { npRequireAgentIncidentSegmentedAssessmentEntryV2 } from "../../../packages/core/src/agent/incident-assessment-service.js";
import { npReadAgentModeratorSegmentCallEvidenceV2 } from "../../../packages/core/src/agent/moderator-segmented-assessment-proof.js";
import { moderatorAssessmentFixture } from "./agent-moderator-assessment-fixture.js";
import {
  npReadAgentModeratorCommentFactV1,
  npReadAgentModeratorCommentFactsBatchV1,
} from "../../../packages/core/src/agent/moderator-collector.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { npComments } from "../../../packages/core/src/db/schema/community.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
type Fixture = Awaited<ReturnType<typeof moderatorAssessmentFixture>>;
const active: Fixture[] = [];
async function setup(itemCount: number, maxProviderCalls = 20) {
  const f = await moderatorAssessmentFixture({ profileVersion: 2, itemCount, maxProviderCalls });
  active.push(f);
  return f;
}
const rows = (f: Fixture) =>
  f.db
    .select()
    .from(npAgentIncidentTimeline)
    .where(
      and(
        eq(npAgentIncidentTimeline.runId, f.runId),
        eq(npAgentIncidentTimeline.kind, "agent_assessment"),
      ),
    );
const calls = (f: Fixture) =>
  f.db
    .select()
    .from(npAgentProviderCalls)
    .where(eq(npAgentProviderCalls.runId, f.runId))
    .orderBy(asc(npAgentProviderCalls.sequence));
describe.skipIf(skipIfNoTestDb())("durable segmented semantic Moderator", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    await settleIntegrationWork();
    for (const f of active.splice(0)) await f.dispose();
    vi.useRealTimers();
  });
  afterAll(closeTestDb);
  it("matches individual observed facts in order and rejects changed comments and current ACL loss", async () => {
    const f = await setup(11);
    const sources = await f.db
      .select()
      .from(npAgentEvents)
      .where(
        and(
          eq(npAgentEvents.siteId, siteId),
          eq(npAgentEvents.sourceComponent, "community.comments"),
        ),
      )
      .orderBy(asc(npAgentEvents.id));
    expect(sources).toHaveLength(11);
    const read = () =>
      withCurrentSite(siteId, () =>
        npReadAgentModeratorCommentFactsBatchV1(f.db, {
          siteId,
          sources,
          user: f.actor.actor.user,
        }),
      );
    const expected = await withCurrentSite(siteId, () =>
      Promise.all(
        sources.map((source) =>
          npReadAgentModeratorCommentFactV1(f.db, source, f.actor.actor.user),
        ),
      ),
    );
    expect(expected.every((entry) => entry !== null)).toBe(true);
    expect(await read()).toEqual(expected);
    const target = expected[0]!.subject;
    if (target.kind !== "comment") throw new Error("Expected observed comment");
    await f.db
      .update(npComments)
      .set({ bodyMd: "Changed source", editedAt: new Date() })
      .where(eq(npComments.id, target.commentId));
    const changed = await read();
    expect(changed[0]).toBeNull();
    expect(changed.slice(1)).toEqual(expected.slice(1));
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", discussionsTable, {
      ...config,
      access: { ...config.access, read: () => false },
    });
    expect(await read()).toEqual(sources.map(() => null));
  });
  it("preserves mixed document reports, comment reports and observed comments in a complete aggregate", async () => {
    const f = await moderatorAssessmentFixture({
      profileVersion: 2,
      source: "content-combined",
      contentCounts: { documents: 4, observedComments: 4, reportedComments: 4 },
      maxProviderCalls: 4,
    });
    active.push(f);
    await f.assessmentExecutor.process({ siteId, runId: f.runId });
    const [row] = await rows(f);
    expect(await npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, row!)).toMatchObject({
      coverage: { complete: true, incomplete: false, targetCount: 12, segmentCount: 2 },
    });
    expect(await calls(f)).toHaveLength(2);
    expect(await f.db.select().from(npAgentActions)).toEqual([]);
  });
  it.each(["comment", "parent", "ACL"] as const)(
    "rechecks completed comment segments after %s drift before aggregation",
    async (mode) => {
      const f = await setup(11);
      let ordinal = 0,
        commentId: string | undefined;
      f.beforeResponse(async (evidence) => {
        ordinal++;
        if (ordinal === 1) {
          const subject = evidence.sources[0]!.subject;
          if (subject.kind !== "comment") throw new Error("Expected comment segment");
          commentId = subject.commentId;
        }
        if (ordinal !== 2 || !commentId) return;
        if (mode === "comment") {
          await f.db
            .update(npComments)
            .set({ bodyMd: "Prior segment changed", editedAt: new Date() })
            .where(eq(npComments.id, commentId));
        } else if (mode === "parent") {
          const [comment] = await f.db
            .select()
            .from(npComments)
            .where(eq(npComments.id, commentId));
          await f.db
            .update(discussionsTable)
            .set({ title: "Parent changed" })
            .where(eq(discussionsTable.id, comment!.targetId));
        } else {
          const config = getCollectionConfig("discussions");
          registerCollection("discussions", discussionsTable, {
            ...config,
            access: { ...config.access, read: () => false },
          });
        }
      });
      await f.assessmentExecutor.process({ siteId, runId: f.runId });
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      expect(await rows(f)).toEqual([]);
      expect(
        (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId)))[0]!.state,
      ).not.toBe("succeeded");
      expect(await f.db.select().from(npAgentActions)).toEqual([]);
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    },
  );
  // Sixteen persisted calls recheck the entire 151-target projection each time.
  // Shared CI runners need a larger budget than the small segment regressions.
  it("covers all 151 targets in 16 exact sequential calls and records one verified aggregate without effects", async () => {
    let owner: Fixture | undefined;
    const scope = createIntegrationWorkScope(() => owner?.assessmentExecutor.shutdown());
    await scope.run(async () => {
      const query = vi.spyOn(pg.Client.prototype, "query");
      const started = performance.now();
      let fixtureMs = 0,
        fixtureQueries = 0,
        executionMs = 0,
        executionQueries = 0;
      try {
        const f = await setup(151);
        owner = f;
        if (scope.signal.aborted) throw new Error("Assessment test scope closed");
        fixtureQueries = query.mock.calls.length;
        fixtureMs = performance.now() - started;
        const before = (await f.db.select().from(npAgentIncidents))[0]!;
        const selected = await f.readAssessment();
        expect(selected.metadata.incident).not.toBeNull();
        const executionStart = performance.now(),
          executionQueryStart = query.mock.calls.length;
        await f.assessmentExecutor.process({ siteId, runId: f.runId });
        executionMs = performance.now() - executionStart;
        executionQueries = query.mock.calls.length - executionQueryStart;
        expect(executionQueries).toBeGreaterThan(0);
        expect(executionQueries).toBeLessThan(30_000);
        const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId));
        expect(run).toMatchObject({ state: "succeeded", errorCode: null });
        const retained = await calls(f);
        expect(retained).toHaveLength(16);
        const evidence = retained.map(npReadAgentModeratorSegmentCallEvidenceV2);
        expect(evidence.map((entry) => entry.segmentIndex)).toEqual(
          Array.from({ length: 16 }, (_, index) => index),
        );
        expect(evidence.every((entry) => entry.sources.length <= 10)).toBe(true);
        expect(
          new Set(
            evidence.flatMap((entry) =>
              entry.sources.map((source) => JSON.stringify(source.subject)),
            ),
          ).size,
        ).toBe(151);
        expect(new Set(evidence.map((entry) => entry.manifest.digest)).size).toBe(1);
        const [row] = await rows(f);
        expect(await rows(f)).toHaveLength(1);
        const assessment = await npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, row!);
        expect(assessment).toMatchObject({
          label: "spam",
          coverage: {
            eventCount: 151,
            targetCount: 151,
            segmentCount: 16,
            complete: true,
            incomplete: false,
          },
          segmentProviderCallIds: retained.map((call) => call.id),
        });
        expect(JSON.stringify(row!.details)).not.toContain("bodyMd");
        expect((await f.db.select().from(npAgentIncidents))[0]!.versionNumber).toBe(
          before.versionNumber + 1,
        );
        expect(await f.db.select().from(npAgentActions)).toEqual([]);
        expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
        expect(await f.db.select().from(npAgentContainments)).toEqual([]);
        const replay = await f.assessmentAdmission.withRunAuthority(
          { siteId, runId: f.runId, allowTerminal: true },
          (context) => f.assessments.record(context, { providerCallId: retained.at(-1)!.id }),
        );
        expect(replay).toMatchObject({ replayed: true, complete: true });
        expect(await rows(f)).toHaveLength(1);
        const original = retained[1]!.requestRedacted!;
        await f.db
          .update(npAgentProviderCalls)
          .set({
            requestRedacted: JSON.parse(
              serializeAgentCanonicalJson({
                ...original,
                assessmentEvidence: { ...evidence[1]!, segmentIndex: 0 },
              }),
            ) as NpAgentJsonObject,
          })
          .where(eq(npAgentProviderCalls.id, retained[1]!.id));
        await expect(
          npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, row!),
        ).rejects.toThrow();
      } finally {
        query.mockRestore();
        const path = process.env.NP_MODERATOR_PERFORMANCE_LOG;
        if (path)
          writeFileSync(
            path,
            JSON.stringify({
              targets: 151,
              segments: 16,
              fixtureMs,
              fixtureQueries,
              executionMs,
              executionQueries,
            }),
          );
      }
    });
  }, 240_000);
  it("keeps successful partial segments durable without claiming an aggregate when the explicit call budget ends", async () => {
    const f = await setup(11, 1);
    const selected = await f.readAssessment();
    expect(selected.metadata.incident).not.toBeNull();
    await f.assessmentExecutor.process({ siteId, runId: f.runId });
    const retained = await calls(f);
    expect(retained).toHaveLength(1);
    expect(retained[0]!.state).toBe("succeeded");
    expect(npReadAgentModeratorSegmentCallEvidenceV2(retained[0]!)).toMatchObject({
      segmentIndex: 0,
      manifest: { targetCount: 11, segmentCount: 2 },
    });
    expect(await rows(f)).toEqual([]);
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId)))[0],
    ).toMatchObject({ state: "budget_blocked", errorCode: "RUNTIME_PROVIDER_CALL_LIMIT" });
    expect(f.providerInvoke).toHaveBeenCalledTimes(1);
  });
  it("retains full coverage but reports uncertainty when any segment is uncertain", async () => {
    const f = await setup(11);
    f.setAssessmentDecision({
      kind: "classification",
      label: "uncertain",
      confidenceBasisPoints: 0,
      reasonCodes: ["insufficient-evidence"],
      evidenceDigests: [],
      summary: "Evidence does not support a reliable classification.",
    });
    const selected = await f.readAssessment();
    expect(selected.metadata.incident).not.toBeNull();
    await f.assessmentExecutor.process({ siteId, runId: f.runId });
    const [row] = await rows(f);
    expect(await npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, row!)).toMatchObject({
      label: "uncertain",
      confidenceBasisPoints: 0,
      coverage: { targetCount: 11, segmentCount: 2, complete: true, incomplete: false },
    });
  });
  it("keeps conflicting segment judgments uncertain while preserving their separate proofs", async () => {
    const f = await setup(11);
    let ordinal = 0;
    f.beforeResponse(async (evidence) => {
      ordinal++;
      f.setAssessmentDecision({
        kind: "classification",
        label: ordinal === 1 ? "spam" : "benign",
        confidenceBasisPoints: 9000,
        reasonCodes: ["repeated-template"],
        evidenceDigests: evidence.sources.map((entry) => entry.excerptDigest).sort(),
        summary: "This exact segment has a distinct classification.",
      });
    });
    await f.assessmentExecutor.process({ siteId, runId: f.runId });
    const [row] = await rows(f);
    expect(await npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, row!)).toMatchObject({
      label: "uncertain",
      confidenceBasisPoints: 0,
      coverage: { complete: true, targetCount: 11 },
    });
    expect(await calls(f)).toHaveLength(2);
  });
  it("rechecks earlier segments' visible-field projection before aggregating a later call", async () => {
    const f = await moderatorAssessmentFixture({
      profileVersion: 2,
      source: "content-combined",
      contentCounts: { documents: 9, observedComments: 2, reportedComments: 0 },
      maxProviderCalls: 4,
    });
    active.push(f);
    let ordinal = 0;
    f.beforeResponse(async () => {
      ordinal++;
      if (ordinal === 2) {
        const config = getCollectionConfig("discussions");
        registerCollection("discussions", discussionsTable, {
          ...config,
          fields: config.fields.map((field) =>
            "name" in field && field.name === "title" ? { ...field, hidden: true } : field,
          ),
        });
      }
    });
    await f.assessmentExecutor.process({ siteId, runId: f.runId });
    expect(await calls(f)).toHaveLength(2);
    expect(await rows(f)).toEqual([]);
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId)))[0]!.state,
    ).not.toBe("succeeded");
  });
  it("resumes from a confirmed first-segment call after process-local context loss without dispatching it again", async () => {
    const f = await setup(11, 4);
    const request = await f.assessmentContext.prepare({
      siteId,
      runId: f.runId,
      providerCallId: randomUUID(),
      sequence: 1,
      retryOfId: null,
      idempotencyKey: randomUUID(),
    });
    const metadata = npRequireAgentModeratorAssessmentEvidenceV2(
      JSON.parse(request.trustedContext.find((entry) => entry.id === "moderator-assessment")!.text),
    );
    const decision = {
      task: "moderation-classification" as const,
      decision: {
        kind: "classification" as const,
        label: "spam" as const,
        confidenceBasisPoints: 9000,
        reasonCodes: ["repeated-template" as const],
        evidenceDigests: metadata.sources.map((entry) => entry.excerptDigest).sort(),
        summary: "First exact segment was confirmed before restart.",
      },
    };
    const outcome: NpAgentProviderInvokeOutcomeV1 = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "succeeded",
      provider: request.provider,
      model: request.model,
      providerRequestId: null,
      output: decision,
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        tokenSource: "provider",
        costMicros: 3,
        costSource: "adapter-estimate",
      },
      finishReason: "stop",
      latencyMs: 0,
    };
    await f.assessmentUsage.reserve({ siteId, runId: f.runId, request });
    await f.assessmentUsage.beginDispatch({ siteId, runId: f.runId, request });
    await f.assessmentUsage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, outcome, decision),
    });
    f.assessmentContext.dispose();
    const restarted = f.restartAssessmentExecutor();
    await restarted.process({ siteId, runId: f.runId });
    const retained = await calls(f);
    expect(retained).toHaveLength(2);
    expect(retained[0]!.id).toBe(request.providerCallId);
    expect(
      retained.map((call) => npReadAgentModeratorSegmentCallEvidenceV2(call).segmentIndex),
    ).toEqual([0, 1]);
    expect(f.providerInvoke).toHaveBeenCalledTimes(1);
    expect(await rows(f)).toHaveLength(1);
  });
  it("retries only the exact failed segment and charges the retry before advancing", async () => {
    const f = await setup(11, 4);
    const request = await f.assessmentContext.prepare({
      siteId,
      runId: f.runId,
      providerCallId: randomUUID(),
      sequence: 1,
      retryOfId: null,
      idempotencyKey: randomUUID(),
    });
    await f.assessmentUsage.reserve({ siteId, runId: f.runId, request });
    const outcome: NpAgentProviderInvokeOutcomeV1 = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "failed",
      provider: request.provider,
      model: request.model,
      providerRequestId: null,
      output: null,
      errorClass: "transient",
      safeCode: "SYNTHETIC_TRANSIENT",
      retryable: true,
      dispatchState: "not-dispatched",
      usage: null,
      finishReason: null,
      latencyMs: 0,
    };
    await f.assessmentUsage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, outcome),
    });
    f.advance(3);
    vi.setSystemTime(f.options.now());
    await f.restartAssessmentExecutor().process({ siteId, runId: f.runId });
    const retained = await calls(f);
    expect(retained).toHaveLength(3);
    expect(
      retained.map((call) => npReadAgentModeratorSegmentCallEvidenceV2(call).segmentIndex),
    ).toEqual([0, 0, 1]);
    expect(retained.map((call) => call.retryOfId)).toEqual([null, retained[0]!.id, null]);
    const [row] = await rows(f);
    expect(
      (await npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, row!)).segmentProviderCallIds,
    ).toEqual([retained[1]!.id, retained[2]!.id]);
  });
  it("never repeats an ambiguous dispatched segment or fabricates aggregate completion", async () => {
    const f = await setup(11, 4);
    const request = await f.assessmentContext.prepare({
      siteId,
      runId: f.runId,
      providerCallId: randomUUID(),
      sequence: 1,
      retryOfId: null,
      idempotencyKey: randomUUID(),
    });
    await f.assessmentUsage.reserve({ siteId, runId: f.runId, request });
    await f.assessmentUsage.beginDispatch({ siteId, runId: f.runId, request });
    const outcome: NpAgentProviderInvokeOutcomeV1 = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "ambiguous",
      provider: request.provider,
      model: request.model,
      providerRequestId: null,
      output: null,
      errorClass: "timeout",
      safeCode: "SYNTHETIC_TIMEOUT",
      retryable: false,
      dispatchState: "unknown",
      usage: null,
      finishReason: null,
      latencyMs: 0,
    };
    await f.assessmentUsage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, outcome),
    });
    await f.restartAssessmentExecutor().process({ siteId, runId: f.runId });
    expect(await calls(f)).toHaveLength(1);
    expect(f.providerInvoke).not.toHaveBeenCalled();
    expect(await rows(f)).toEqual([]);
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId)))[0],
    ).toMatchObject({ state: "failed", errorCode: "RUNTIME_PROVIDER_UNRESOLVED" });
  });
});
