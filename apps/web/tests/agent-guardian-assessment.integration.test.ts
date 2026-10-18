import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentActorRestrictions,
  npAgentContainments,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentNotifications,
  npAgentProviderCalls,
} from "../../../packages/core/src/db/schema/agent.js";
import { npRequireAgentGuardianIncidentAssessmentEntryV1 } from "../../../packages/core/src/agent/guardian-incident-assessment-service.js";
import { npDigestAgentGuardianAssessmentSourcesV1 } from "../../../packages/core/src/agent/guardian-assessment-proof.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { createAgentGuardianOperationsServiceV1 } from "../../../packages/core/src/agent/guardian-operations-service.js";
import type { NpAgentJsonObject } from "../../../packages/core/src/agent-contract/types.js";
import { guardianAssessmentFixture } from "./agent-guardian-assessment-fixture.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof guardianAssessmentFixture>>;
const fixtures: Fixture[] = [];
async function fixture(options: Parameters<typeof guardianAssessmentFixture>[0] = {}) {
  const f = await guardianAssessmentFixture(options);
  fixtures.push(f);
  return f;
}
const run = (f: Fixture) => f.executor.process({ siteId, runId: f.runId });
const calls = (f: Fixture) =>
  f.db.select().from(npAgentProviderCalls).where(eq(npAgentProviderCalls.runId, f.runId));
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
async function noAuthorityEffects(f: Fixture) {
  for (const table of [
    npAgentActions,
    npAgentApprovals,
    npAgentActorRestrictions,
    npAgentContainments,
    npAgentNotifications,
  ])
    expect(await f.db.select().from(table)).toEqual([]);
}

describe.skipIf(skipIfNoTestDb())(
  "manual Guardian advisory through real sources and persisted Runtime",
  () => {
    beforeAll(ensureMigrated);
    beforeEach(async () => {
      await truncateAll();
      registerTestCollections();
    });
    afterEach(async () => {
      for (const f of fixtures.splice(0)) await f.dispose();
      vi.restoreAllMocks();
      vi.useRealTimers();
    });
    afterAll(closeTestDb);

    it.each([false, true])(
      "keeps rate/session evidence staff-readable without qualifying a credential advisory (session=%s)",
      async (sessionSource) => {
        const f = await fixture({ sessionSource, rateOnly: !sessionSource });
        const actual = await f.db.select().from(npAgentIncidents);
        const selected = actual.find((row) =>
          sessionSource ? row.primarySubject?.kind === "session" : row.category === "traffic",
        );
        if (!selected) throw new Error("Expected actual source Incident");
        for (const row of actual) if (row.id !== selected.id) f.setVisibility(row.id, false);
        expect(
          (
            await f.incidents.staff.get(
              { incidentId: selected.id },
              { siteId, actor: f.actor.actor },
            )
          ).incident.id,
        ).toBe(selected.id);
        expect((await f.read()).metadata.sources).toEqual([]);
        expect(f.providerInvoke).not.toHaveBeenCalled();
      },
    );
    it.each([
      { failureSpacingSeconds: 15, qualified: true },
      { failureSpacingSeconds: 15.001, qualified: false },
    ])(
      "enforces the actual exact60s credential window boundary: %j",
      async ({ failureSpacingSeconds, qualified }) => {
        const f = await fixture({
          failureSpacingSeconds,
          credentialSettings: { windowSeconds: 60 },
        });
        expect((await f.read()).metadata.sources).toHaveLength(qualified ? 1 : 0);
      },
    );

    it.each([
      { credentialSettings: { minimumFailures: 6 } },
      { credentialSettings: { minimumDistinctAccountBuckets: 2 } },
      { credentialSettings: { windowSeconds: 60 }, failureSpacingSeconds: 16 },
      { unsignedRequests: true },
    ])(
      "abstains when actual credential proof does not satisfy configured requirements: %j",
      async (options) => {
        const f = await fixture(options);
        expect(
          (
            await f.incidents.staff.list(
              {
                statuses: [],
                categories: [],
                severities: [],
                updatedAfter: null,
                limit: 10,
                cursor: null,
              },
              { siteId, actor: f.actor.actor },
            )
          ).items,
        ).toHaveLength(1);
        expect((await f.read()).metadata.sources).toEqual([]);
        expect(f.providerInvoke).not.toHaveBeenCalled();
        await noAuthorityEffects(f);
      },
    );
    it("uses actual opaque account commitments to satisfy configured diversity without exposing them", async () => {
      const f = await fixture({
        credentialSettings: { minimumDistinctAccountBuckets: 5 },
        distinctAccounts: true,
      });
      const selected = await f.read();
      expect(selected.metadata.sources).toHaveLength(1);
      expect(JSON.stringify(selected)).not.toMatch(
        /private-fixture|login-identifier|bucket|sourceMac/u,
      );
    });
    it("abstains after retained request-key loss and rejects a tampered source receipt", async () => {
      const f = await fixture({ rotatedRequestKey: true });
      expect((await f.read()).metadata.sources).toHaveLength(1);
      const [receipt] = await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_request.source"))
        .limit(1);
      if (!receipt) throw new Error("Expected actual signed source receipt");
      await f.db
        .update(npAuditEvents)
        .set({ payload: { ...receipt.payload, sourceMac: `hmac-sha256:${"A".repeat(43)}` } })
        .where(eq(npAuditEvents.id, receipt.id));
      expect((await f.read()).metadata.sources).toEqual([]);
      await f.db
        .update(npAuditEvents)
        .set({ payload: receipt.payload })
        .where(eq(npAuditEvents.id, receipt.id));
      expect((await f.read()).metadata.sources).toHaveLength(1);
      f.forgetRequestReceiptKey();
      expect((await f.read()).metadata.sources).toEqual([]);
      expect(f.providerInvoke).not.toHaveBeenCalled();
      await noAuthorityEffects(f);
    });

    it.each(["guardian.credential-stuffing", "guardian.agent-abuse"] as const)(
      "records exact %s advisory once without severity, status, notifications or action authority",
      async (recipeId) => {
        const f = await fixture({ recipeId });
        const selected = await f.read();
        expect(selected.metadata.sources).toHaveLength(1);
        expect(JSON.stringify(selected)).not.toMatch(
          /private-fixture|192\.0\.2\.|sourceMac|targetBucket|actorUserId|previousRole|currentRole/u,
        );
        const [before] = await f.db
          .select()
          .from(npAgentIncidents)
          .where(eq(npAgentIncidents.id, selected.metadata.incident!.id));
        expect(await run(f)).toEqual({ state: "succeeded" });
        expect(f.providerInvoke).toHaveBeenCalledTimes(1);
        expect(f.providerInvoke.mock.calls[0]![0]).toMatchObject({
          task: "guardian-assessment",
          tools: [],
          dataClass: "sensitive-approved",
          dataClassCeiling: "sensitive-approved",
        });
        const timeline = await rows(f);
        expect(timeline).toHaveLength(1);
        const assessment = await npRequireAgentGuardianIncidentAssessmentEntryV1(
          f.db,
          timeline[0]!,
        );
        expect(assessment).toMatchObject({
          incidentId: before!.id,
          incidentVersion: before!.versionNumber,
          evidence: { recipeId },
          provenance: { runId: f.runId, provider: "fake-provider", model: "fake-model" },
        });
        const [after] = await f.db
          .select()
          .from(npAgentIncidents)
          .where(eq(npAgentIncidents.id, before!.id));
        expect(after).toMatchObject({
          severity: before!.severity,
          status: before!.status,
          versionNumber: before!.versionNumber + 1,
        });
        const [call] = await calls(f);
        expect(call!.requestRedacted).toMatchObject({
          schemaVersion: "np.agent-guardian-assessment-diagnostic.v1",
          requestDigest: call!.requestDigest,
          assessmentEvidence: selected.metadata,
        });
        expect(
          await f.admission.withRunAuthority(
            { siteId, runId: f.runId, allowTerminal: true },
            (context) => f.assessments.record(context, { providerCallId: call!.id }),
          ),
        ).toMatchObject({ recorded: true, replayed: true, assessment });
        expect(await rows(f)).toEqual(timeline);
        await noAuthorityEffects(f);
        await expect(
          npRequireAgentGuardianIncidentAssessmentEntryV1(f.db, {
            ...timeline[0]!,
            details: { ...timeline[0]!.details, summary: "Forged advisory" },
          }),
        ).rejects.toThrow();
        const forged = structuredClone(assessment);
        forged.evidence.sources[0]!.signalId = randomUUID();
        forged.provenance.sourceDigest = npDigestAgentGuardianAssessmentSourcesV1(forged.evidence);
        await expect(
          npRequireAgentGuardianIncidentAssessmentEntryV1(f.db, {
            ...timeline[0]!,
            details: JSON.parse(JSON.stringify(forged)) as NpAgentJsonObject,
          }),
        ).rejects.toThrow();
      },
    );

    it("summarizes signed actual Runtime Action evidence without new capability effects or severity authority", async () => {
      const f = await fixture({ recipeId: "guardian.agent-abuse", runtimeSource: true });
      const selected = await f.read();
      expect(selected.metadata.sources).toHaveLength(1);
      expect(selected.observations.map((item) => JSON.parse(item.text))).toEqual([
        expect.objectContaining({
          detectorId: "guardian.action-velocity",
          observedCount: 5,
          accounting: null,
        }),
      ]);
      expect(JSON.stringify(selected)).not.toMatch(
        /sourceMac|receiptKey|principalId|userId|actionId|runId/u,
      );
      const beforeActions = await f.db.select().from(npAgentActions);
      expect(beforeActions).toHaveLength(5);
      expect(await run(f)).toEqual({ state: "succeeded" });
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      expect(await f.db.select().from(npAgentActions)).toEqual(beforeActions);
      const timeline = await rows(f);
      expect(timeline).toHaveLength(1);
      const result = await npRequireAgentGuardianIncidentAssessmentEntryV1(f.db, timeline[0]!);
      expect(result.evidence.sources).toEqual(selected.metadata.sources);
      const [incident] = await f.db
        .select()
        .from(npAgentIncidents)
        .where(eq(npAgentIncidents.id, result.incidentId));
      expect(incident).toMatchObject({ severity: "medium", status: "open" });
      for (const table of [
        npAgentApprovals,
        npAgentActorRestrictions,
        npAgentContainments,
        npAgentNotifications,
      ])
        expect(await f.db.select().from(table)).toEqual([]);
    });
    it("refuses a complete export when a real stored Guardian assessment can no longer be verified", async () => {
      const f = await fixture();
      expect(await run(f)).toEqual({ state: "succeeded" });
      const [entry] = await rows(f);
      if (!entry) throw new Error("Expected actual stored advisory");
      const studio = createAgentIncidentStudioServiceV1({
        reads: f.incidents.staff,
        cursorHmacKey: new Uint8Array(32).fill(87),
        now: f.options.now,
      });
      const operations = createAgentGuardianOperationsServiceV1({
        studio,
        authorizeDiagnostics: async () => {},
        now: f.options.now,
      });
      const input = { siteId, actor: f.actor.actor, incidentId: entry.incidentId };
      const initial = await studio.get(input);
      expect(initial.timelinePageComplete).toBe(true);
      expect(
        (
          await operations.exportIncident({
            ...input,
            expectedVersion: initial.incident.versionNumber,
          })
        ).outcomes.some((outcome) => outcome.assessment !== null),
      ).toBe(true);
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ details: { ...entry.details, summary: "Unverified hostile model prose" } })
        .where(eq(npAgentIncidentTimeline.id, entry.id));
      try {
        const hidden = await studio.get(input);
        expect(hidden.timelinePageComplete).toBe(false);
        expect(hidden.timeline.some((row) => row.id === entry.id)).toBe(false);
        expect(JSON.stringify(hidden)).not.toContain("Unverified hostile");
        await expect(
          operations.exportIncident({ ...input, expectedVersion: initial.incident.versionNumber }),
        ).rejects.toMatchObject({ code: "GUARDIAN_EXPORT_INCOMPLETE" });
      } finally {
        await f.db
          .update(npAgentIncidentTimeline)
          .set({ details: entry.details })
          .where(eq(npAgentIncidentTimeline.id, entry.id));
      }
      expect(
        (
          await operations.exportIncident({
            ...input,
            expectedVersion: initial.incident.versionNumber,
          })
        ).completeness,
      ).toBe("complete");
    });
    it.each([{ recorder: false }, { source: false }])(
      "does no provider or reservation I/O when an explicit owner is absent (%j)",
      async (options) => {
        const f = await fixture(options);
        expect((await run(f)).state).not.toBe("succeeded");
        expect(f.providerInvoke).not.toHaveBeenCalled();
        expect(await calls(f)).toEqual([]);
        expect(await rows(f)).toEqual([]);
        await noAuthorityEffects(f);
      },
    );

    it("rechecks current source access before dispatch and never reselects after a retained reservation", async () => {
      const f = await fixture();
      const request = await f.prepare();
      await f.usage.reserve({ siteId, runId: f.runId, request });
      const pinned = (await f.read()).metadata;
      await f.seedIncident();
      f.setVisibility(pinned.incident!.id, false);
      await expect(
        f.usage.beginDispatch({ siteId, runId: f.runId, request }),
      ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE" });
      await expect(f.read()).rejects.toThrow();
      expect(f.providerInvoke).not.toHaveBeenCalled();
      expect((await calls(f))[0]!.dispatchState).toBe("not-dispatched");
      expect(await rows(f)).toEqual([]);
    });

    it("keeps the exact Incident and observations across a failed provider retry and uses one fingerprint analysis", async () => {
      const f = await fixture();
      f.providerInvoke.mockResolvedValueOnce({
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "failed",
        provider: "fake-provider",
        model: "fake-model",
        providerRequestId: null,
        output: null,
        errorClass: "transient",
        safeCode: "FIXTURE_TRANSIENT",
        retryable: true,
        dispatchState: "dispatched",
        usage: {
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 0,
          tokenSource: "provider",
          costMicros: 1,
          costSource: "adapter-estimate",
        },
        finishReason: null,
        latencyMs: 0,
      });
      expect(await run(f)).toEqual({ state: "waiting_retry" });
      const pinned = (await calls(f))[0]!.requestRedacted!.assessmentEvidence;
      await f.seedIncident();
      f.advance(3);
      expect(await f.restart().process({ siteId, runId: f.runId })).toEqual({ state: "succeeded" });
      const stored = await calls(f);
      expect(stored).toHaveLength(2);
      expect(stored[1]!.retryOfId).toBe(stored[0]!.id);
      expect(
        stored.every(
          (call) =>
            JSON.stringify(call.requestRedacted!.assessmentEvidence) === JSON.stringify(pinned),
        ),
      ).toBe(true);
      expect(await rows(f)).toHaveLength(1);
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      await noAuthorityEffects(f);
    });

    it("recovers a crash after advisory commit by reusing the same response and immutable timeline entry", async () => {
      const f = await fixture();
      const transition = f.store.transition.bind(f.store);
      vi.spyOn(f.store, "transition")
        .mockImplementationOnce(async (input) => {
          expect(input.state).toBe("succeeded");
          // The advisory transaction already committed. Expire only this execution lease.
          f.advance(6);
          throw new Error("Simulated process loss after advisory commit");
        })
        .mockImplementation(transition);
      await expect(run(f)).rejects.toThrow();
      const timeline = await rows(f);
      expect(timeline).toHaveLength(1);
      expect(await f.restart().process({ siteId, runId: f.runId })).toEqual({ state: "succeeded" });
      expect(await rows(f)).toEqual(timeline);
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noAuthorityEffects(f);
    });

    it("rolls the advisory append and Incident version back together on transaction callback failure", async () => {
      const f = await fixture();
      const selected = await f.read();
      const [before] = await f.db
        .select()
        .from(npAgentIncidents)
        .where(eq(npAgentIncidents.id, selected.metadata.incident!.id));
      const request = await f.completeProviderCall();
      await expect(
        f.admission.withRunAuthority({ siteId, runId: f.runId }, async (current) => {
          expect(
            await f.assessments.record(current, { providerCallId: request.providerCallId }),
          ).toMatchObject({ recorded: true, replayed: false });
          throw new Error("Injected post-append transaction failure");
        }),
      ).rejects.toThrow("Injected post-append transaction failure");
      expect(await rows(f)).toEqual([]);
      const [after] = await f.db
        .select()
        .from(npAgentIncidents)
        .where(eq(npAgentIncidents.id, before!.id));
      expect(after).toEqual(before);
      expect(await run(f)).toEqual({ state: "succeeded" });
      expect(await rows(f)).toHaveLength(1);
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noAuthorityEffects(f);
    });

    it("recovers an unsent reservation without sending, and blocks unbound cross-Run retry after any call", async () => {
      const f = await fixture();
      const request = await f.prepare();
      await f.usage.reserve({ siteId, runId: f.runId, request });
      expect(await f.restart().process({ siteId, runId: f.runId })).toEqual({ state: "failed" });
      expect((await calls(f))[0]).toMatchObject({
        state: "cancelled",
        dispatchState: "not-dispatched",
        errorClass: "cancelled",
        retryable: false,
      });
      await expect(
        f.admission.retry({ siteId, failedRunId: f.runId, idempotencyKey: randomUUID(), db: f.db }),
      ).rejects.toMatchObject({ code: "GUARDIAN_ASSESSMENT_RETRY_UNAVAILABLE" });
      expect(f.providerInvoke).not.toHaveBeenCalled();
      expect(await rows(f)).toEqual([]);
    });

    it("rejects lost current authority after inference without changing the Incident", async () => {
      const f = await fixture();
      const selected = await f.read();
      f.beforeResponse(async () => {
        f.setVisibility(selected.metadata.incident!.id, false);
      });
      expect((await run(f)).state).not.toBe("succeeded");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      expect(await rows(f)).toEqual([]);
      await noAuthorityEffects(f);
    });

    it("does not send a second analysis for an exhausted fingerprint", async () => {
      const f = await fixture();
      expect(await run(f)).toEqual({ state: "succeeded" });
      const next = await f.anotherRun();
      expect(await f.executor.process({ siteId, runId: next })).toEqual({
        state: "budget_blocked",
      });
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      expect(await rows(f)).toHaveLength(1);
      await noAuthorityEffects(f);
    });

    it("rejects fabricated model evidence digests after inference without persisting advice or authority", async () => {
      const f = await fixture();
      f.setDecision({
        kind: "assessment",
        disposition: "consistent",
        confidenceBasisPoints: 9000,
        assessmentCodes: ["credential-stuffing-pattern"],
        evidenceDigests: [`cj1:sha256:${"A".repeat(43)}`],
        summary: "This deliberately unsupported claim must not be persisted.",
      });
      expect((await run(f)).state).not.toBe("succeeded");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      expect(await rows(f)).toEqual([]);
      await noAuthorityEffects(f);
    });

    it("cannot register event or scheduled dispatch for the manual-only profile", async () => {
      const f = await fixture();
      await expect(
        f.events.registerTrigger({
          siteId,
          agentId: f.agentId,
          expectedVersionId: f.runInput.expectedVersionId,
          enabled: true,
          trigger: {
            type: "event",
            id: randomUUID(),
            eventKind: "auth.login.failed",
            filter: { op: "eq", field: "source.kind", value: "auth" },
            coalesceSeconds: 0,
          },
        }),
      ).rejects.toThrow();
      expect(f.providerInvoke).not.toHaveBeenCalled();
    });
  },
);
