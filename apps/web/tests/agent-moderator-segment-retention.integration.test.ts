import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentIncidentTimeline,
  npAgentProviderCalls,
} from "../../../packages/core/src/db/schema/agent.js";
import { npRequireAgentIncidentSegmentedAssessmentEntryV2 } from "../../../packages/core/src/agent/incident-assessment-service.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { moderatorAssessmentFixture } from "./agent-moderator-assessment-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof moderatorAssessmentFixture>>;
let active: Fixture | undefined;
describe.skipIf(skipIfNoTestDb())("segmented assessment proof lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    await active?.dispose();
    active = undefined;
    vi.useRealTimers();
  });
  afterAll(closeTestDb);

  it("expires response diagnostics while preserving the exact metadata needed to verify every segment", async () => {
    const f = await moderatorAssessmentFixture({
      profileVersion: 2,
      itemCount: 11,
      maxProviderCalls: 4,
    });
    active = f;
    expect(await f.assessmentExecutor.process({ siteId, runId: f.runId })).toEqual({
      state: "succeeded",
    });
    const calls = await f.db
      .select()
      .from(npAgentProviderCalls)
      .where(eq(npAgentProviderCalls.runId, f.runId));
    expect(calls).toHaveLength(2);
    const [entry] = await f.db
      .select()
      .from(npAgentIncidentTimeline)
      .where(
        and(
          eq(npAgentIncidentTimeline.runId, f.runId),
          eq(npAgentIncidentTimeline.kind, "agent_assessment"),
        ),
      );
    expect(entry).toBeDefined();
    const before = await npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, entry!);
    expect(before.coverage.complete).toBe(true);
    await f.db
      .update(npAgentProviderCalls)
      .set({
        diagnosticExpiresAt: new Date(f.options.now().getTime() + 1000),
        responseRedacted: { diagnostic: "expired response diagnostic" },
      })
      .where(eq(npAgentProviderCalls.runId, f.runId));
    const cleanupAt = new Date(f.options.now().getTime() + 2000);
    await pruneAgentRuntimeEventsV1({ siteId, now: cleanupAt, limit: 100 });
    const retained = await f.db
      .select()
      .from(npAgentProviderCalls)
      .where(eq(npAgentProviderCalls.runId, f.runId));
    expect(retained).toHaveLength(2);
    for (const call of retained) {
      expect(call.responseRedacted).toBeNull();
      expect(call.requestRedacted).toEqual(
        calls.find((prior) => prior.id === call.id)!.requestRedacted,
      );
      expect(call.requestRedacted).not.toHaveProperty("excerpts");
    }
    expect(await npRequireAgentIncidentSegmentedAssessmentEntryV2(f.db, entry!)).toEqual(before);
    const detail = await f.assessmentStudio.get({
      siteId,
      actor: f.actor.actor,
      incidentId: entry!.incidentId,
    });
    expect(detail.timeline.find((item) => item.id === entry!.id)?.segmentedAssessment).toEqual(
      before,
    );
    // A retained-only proof is no longer a recurring diagnostic cleanup candidate.
    expect((await pruneAgentRuntimeEventsV1({ siteId, now: cleanupAt, limit: 100 })).pruned).toBe(
      0,
    );
  });
});
