import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentUsageReservations,
  npAgentEvents,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments } from "../../../packages/core/src/db/schema/community.js";
import { updateComment } from "../../../packages/core/src/community/comments.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { npRequireAgentIncidentAssessmentEntryV1 } from "../../../packages/core/src/agent/incident-assessment-service.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import { npDigestAgentModeratorAssessmentSourcesV1 } from "../../../packages/core/src/agent/moderator-assessment-source.js";
import type { NpAgentJsonObject } from "../../../packages/core/src/agent-contract/types.js";
import { moderatorAssessmentFixture } from "./agent-moderator-assessment-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import { npAgentModeratorWindowStartedAtV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import { npAgentModeratorRecipeSetupV1 } from "../../../packages/core/src/agent-contract/moderator-recipe-contract.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
type Fixture = Awaited<ReturnType<typeof moderatorAssessmentFixture>>;
const active: Fixture[] = [];
async function fixture(options: Parameters<typeof moderatorAssessmentFixture>[0] = {}) {
  const f = await moderatorAssessmentFixture(options);
  active.push(f);
  return f;
}
const run = (f: Fixture) => f.assessmentExecutor.process({ siteId, runId: f.runId });
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
async function addCampaign(f: Fixture) {
  const comments = [];
  let bucket: string | null = null;
  for (let attempt = 0; comments.length < 5 && attempt < 20; attempt++) {
    const comment = await f.write(
      attempt,
      `Actual second campaign https://second.example/${attempt}`,
    );
    const currentBucket = npAgentModeratorWindowStartedAtV1(comment.createdAt.toISOString());
    if (currentBucket !== bucket) {
      comments.length = 0;
      bucket = currentBucket;
    }
    comments.push(comment);
  }
  if (!bucket || comments.length !== 5) throw new Error("Could not seed actual second campaign");
  vi.setSystemTime(Math.max(f.options.now().getTime() + 1000, Date.parse(bucket) + 600001));
  const collected = await f.runtimeCollector.collect({
    siteId,
    windowStartedAt: bucket,
    settings: { ...npAgentModeratorRecipeSetupV1.settings, collectionSlugs: ["discussions"] },
  });
  const original = f.collected.observations[0]!.incidentId;
  const second = collected.observations.find((observation) => observation.incidentId !== original);
  if (!second) throw new Error("Expected second actual detector Incident");
  return { id: second.incidentId, comments };
}
describe.skipIf(skipIfNoTestDb())(
  "read-only semantic Moderator through persisted Runtime owners",
  () => {
    beforeAll(ensureMigrated);
    beforeEach(async () => {
      await truncateAll();
      registerTestCollections();
    });
    afterEach(async () => {
      for (const f of active.splice(0)) await f.dispose();
      vi.useRealTimers();
    });
    afterAll(closeTestDb);
    it("binds Event-triggered assessment to the Event's actual Incident instead of an older unrelated campaign", async () => {
      const f = await fixture();
      await f.cancelAssessmentRun();
      const second = await addCampaign(f);
      const source = (await f.db.select().from(npAgentEvents)).find(
        (event) =>
          event.subject?.kind === "comment" && event.subject.commentId === second.comments[0]!.id,
      );
      expect(source).toBeDefined();
      const runId = await f.eventAssessmentRun(source!.id);
      expect((await f.readAssessment(runId)).metadata.incident?.id).toBe(second.id);
      expect(await f.assessmentExecutor.process({ siteId, runId })).toEqual({ state: "succeeded" });
      expect(
        (
          await f.db
            .select()
            .from(npAgentIncidentTimeline)
            .where(
              and(
                eq(npAgentIncidentTimeline.runId, runId),
                eq(npAgentIncidentTimeline.kind, "agent_assessment"),
              ),
            )
        )[0]!.incidentId,
      ).toBe(second.id);
    });
    it("follows empty ACL pages to the next authorized Incident", async () => {
      const f = await fixture();
      const second = await addCampaign(f);
      f.setIncidentVisibility(f.collected.observations[0]!.incidentId, false);
      const selected = await f.readAssessment();
      expect(selected.metadata.incident?.id).toBe(second.id);
      expect(selected.metadata.sources).toHaveLength(5);
      expect(await run(f)).toEqual({ state: "succeeded" });
      expect((await rows(f))[0]!.incidentId).toBe(second.id);
    });
    it("selects a new fingerprint after the old open Incident has used its daily analysis", async () => {
      const f = await fixture();
      expect(await run(f)).toEqual({ state: "succeeded" });
      const original = (await rows(f))[0]!.incidentId;
      const second = await addCampaign(f);
      const nextRun = await f.anotherAssessmentRun();
      const selected = await f.readAssessment(nextRun);
      expect(selected.metadata.incident?.id).toBe(second.id);
      expect(selected.metadata.incident?.id).not.toBe(original);
      expect(await f.assessmentExecutor.process({ siteId, runId: nextRun })).toEqual({
        state: "succeeded",
      });
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      expect(
        (
          await f.db
            .select()
            .from(npAgentIncidentTimeline)
            .where(
              and(
                eq(npAgentIncidentTimeline.runId, nextRun),
                eq(npAgentIncidentTimeline.kind, "agent_assessment"),
              ),
            )
        )[0]!.incidentId,
      ).toBe(second.id);
    });
    it("does not retarget a retained provider attempt when its selected Incident loses access", async () => {
      const f = await fixture();
      const second = await addCampaign(f);
      f.setIncidentVisibility(second.id, false);
      f.beforeResponse(async () => {
        f.setIncidentVisibility(second.id, true);
        f.setIncidentVisibility(f.collected.observations[0]!.incidentId, false);
      });
      expect((await run(f)).state).not.toBe("succeeded");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      expect(await rows(f)).toEqual([]);
      expect(
        (
          await f.db
            .select()
            .from(npAgentProviderCalls)
            .where(eq(npAgentProviderCalls.runId, f.runId))
        )[0]!.requestRedacted,
      ).toMatchObject({
        assessmentEvidence: { incident: { id: f.collected.observations[0]!.incidentId } },
      });
    });
    it("records exact model provenance once after current bounded content assessment, without changing content or granting effects", async () => {
      const f = await fixture({ source: "content-combined" });
      const collection = getCollectionConfig("discussions");
      registerCollection("discussions", discussionsTable, {
        ...collection,
        fields: collection.fields.map((field) =>
          "name" in field && field.name === "title" ? { ...field, hidden: true } : field,
        ),
      });
      const source = await f.readAssessment();
      expect(source.metadata.truncated).toBe(false);
      expect(source.metadata.sources).toHaveLength(5);
      expect(new Set(source.metadata.sources.map((item) => item.subject.kind))).toEqual(
        new Set(["comment", "document"]),
      );
      expect(JSON.stringify(source.metadata)).not.toContain("Ignore all instructions");
      expect(source.excerpts.some((item) => item.text.includes("Ignore all instructions"))).toBe(
        true,
      );
      expect(source.excerpts.every((item) => !item.text.includes("Reported document"))).toBe(true);
      const comments = await f.db.select().from(npComments);
      const [before] = await f.db.select().from(npAgentIncidents);
      f.beforeResponse(async () => {
        const [call] = await f.db
          .select()
          .from(npAgentProviderCalls)
          .where(eq(npAgentProviderCalls.runId, f.runId));
        expect(call.requestRedacted).toMatchObject({
          schemaVersion: "np.agent-moderator-assessment-diagnostic.v1",
          requestDigest: call.requestDigest,
        });
        expect(JSON.stringify(call.requestRedacted)).not.toContain("Ignore all instructions");
      });
      expect(await run(f)).toEqual({ state: "succeeded" });
      const stored = await rows(f);
      expect(stored).toHaveLength(1);
      const assessment = await npRequireAgentIncidentAssessmentEntryV1(f.db, stored[0]);
      expect(assessment).toMatchObject({
        label: "spam",
        incidentId: before.id,
        incidentVersion: before.versionNumber,
        provenance: { runId: f.runId, provider: "fake-provider", model: "fake-model" },
      });
      expect(assessment.evidence.sources).toHaveLength(5);
      expect(
        (
          await f.assessmentStudio.list({
            siteId,
            actor: f.actor.actor,
            query: {
              statuses: [],
              categories: [],
              severities: [],
              updatedAfter: null,
              limit: 25,
              cursor: null,
              includeSummaries: true,
            },
          })
        ).summaries,
      ).toEqual([
        {
          incidentId: before.id,
          versionNumber: before.versionNumber + 1,
          containment: null,
          assessmentAvailable: true,
        },
      ]);
      expect((await f.db.select().from(npAgentIncidents))[0].versionNumber).toBe(
        before.versionNumber + 1,
      );
      expect(await f.db.select().from(npComments)).toEqual(comments);
      expect(await f.db.select().from(npAgentActions)).toEqual([]);
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      const call = (
        await f.db
          .select()
          .from(npAgentProviderCalls)
          .where(eq(npAgentProviderCalls.runId, f.runId))
      )[0];
      const replay = await f.assessmentAdmission.withRunAuthority(
        { siteId, runId: f.runId, allowTerminal: true },
        (context) => f.assessments.record(context, { providerCallId: call.id }),
      );
      expect(replay).toMatchObject({ recorded: true, replayed: true });
      expect(await rows(f)).toHaveLength(1);
      await withCurrentSite(siteId, () =>
        updateComment({
          commentId: f.comments[0].id,
          memberId: f.comments[0].memberId,
          bodyMd: "Later independent correction; retained assessment is historical.",
        }),
      );
      expect(await npRequireAgentIncidentAssessmentEntryV1(f.db, stored[0])).toEqual(assessment);
      expect(
        (
          await f.assessmentStudio.get({ siteId, actor: f.actor.actor, incidentId: before.id })
        ).timeline.find((entry) => entry.kind === "agent_assessment")?.assessment,
      ).toEqual(assessment);
      await expect(
        npRequireAgentIncidentAssessmentEntryV1(f.db, {
          ...stored[0],
          details: { ...stored[0].details, summary: "Forged assessment text." },
        }),
      ).rejects.toThrow();
      await expect(
        npRequireAgentIncidentAssessmentEntryV1(f.db, { ...stored[0], kind: "action" }),
      ).rejects.toThrow();
      vi.setSystemTime(Date.now() + 31 * 86400000);
      await f.db
        .update(npAgentProviderCalls)
        .set({ requestRedacted: null })
        .where(eq(npAgentProviderCalls.id, call.id));
      expect(await npRequireAgentIncidentAssessmentEntryV1(f.db, stored[0])).toEqual(assessment);
      const forgedEvidence = structuredClone(assessment.evidence);
      forgedEvidence.sources[0].eventId = "01900000-0000-7000-8000-000000000999";
      const forged = {
        ...assessment,
        evidence: forgedEvidence,
        provenance: {
          ...assessment.provenance,
          sourceDigest: npDigestAgentModeratorAssessmentSourcesV1(forgedEvidence),
        },
      };
      await expect(
        npRequireAgentIncidentAssessmentEntryV1(f.db, {
          ...stored[0],
          details: JSON.parse(JSON.stringify(forged)) as NpAgentJsonObject,
        }),
      ).rejects.toThrow();
      expect(
        (
          await f.assessmentStudio.get({ siteId, actor: f.actor.actor, incidentId: before.id })
        ).timeline.find((entry) => entry.kind === "agent_assessment")?.assessment,
      ).toEqual(assessment);
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ details: { ...stored[0].details, summary: "Forged stored assessment" } })
        .where(eq(npAgentIncidentTimeline.id, stored[0].id));
      expect(
        (
          await f.assessmentStudio.list({
            siteId,
            actor: f.actor.actor,
            query: {
              statuses: [],
              categories: [],
              severities: [],
              updatedAfter: null,
              limit: 25,
              cursor: null,
              includeSummaries: true,
            },
          })
        ).summaries?.[0]?.assessmentAvailable,
      ).toBeNull();
    }, 60000);
    it("rejects a changed current source after inference without recording or containing it", async () => {
      const f = await fixture();
      f.beforeResponse(async () => {
        await withCurrentSite(siteId, () =>
          updateComment({
            commentId: f.comments[0].id,
            memberId: f.comments[0].memberId,
            bodyMd: "A changed legitimate message.",
          }),
        );
      });
      expect((await run(f)).state).not.toBe("succeeded");
      expect(await rows(f)).toEqual([]);
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    });
    it("rejects a missing recorder before reserving or invoking inference", async () => {
      const f = await fixture({ recorder: false });
      expect((await run(f)).state).not.toBe("succeeded");
      expect(f.providerInvoke).not.toHaveBeenCalled();
      expect(
        await f.db
          .select()
          .from(npAgentProviderCalls)
          .where(eq(npAgentProviderCalls.runId, f.runId)),
      ).toEqual([]);
      expect(
        await f.db
          .select()
          .from(npAgentUsageReservations)
          .where(eq(npAgentUsageReservations.runId, f.runId)),
      ).toEqual([]);
      expect(await rows(f)).toEqual([]);
    });
    it("does not store unrelated evidence digests", async () => {
      const f = await fixture();
      f.setAssessmentDecision({
        kind: "classification",
        label: "spam",
        confidenceBasisPoints: 9999,
        reasonCodes: ["coordinated-pattern"],
        evidenceDigests: [`cj1:sha256:${"Z".repeat(43)}`],
        summary: "Unsupported model claim.",
      });
      expect((await run(f)).state).not.toBe("succeeded");
      expect(await rows(f)).toEqual([]);
      expect(
        (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId)))[0].state,
      ).not.toBe("succeeded");
    });
    it("bounds the current-target sample at ten and records uncertainty for the truncated Incident", async () => {
      const f = await fixture({ itemCount: 11 });
      const selected = await f.readAssessment();
      expect(selected.metadata.truncated).toBe(true);
      expect(selected.metadata.sources).toHaveLength(10);
      expect(selected.excerpts).toHaveLength(10);
      expect(await run(f)).toEqual({ state: "succeeded" });
      const [entry] = await rows(f);
      expect((await npRequireAgentIncidentAssessmentEntryV1(f.db, entry)).label).toBe("uncertain");
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    });
    it("completes uncertain without an invented Incident assessment when no open source remains", async () => {
      const f = await fixture();
      const [incident] = await f.db.select().from(npAgentIncidents);
      await f.db
        .update(npAgentIncidents)
        .set({
          status: "resolved",
          resolvedAt: f.options.now(),
          resolutionCode: "NO_FURTHER_ACTION",
          versionNumber: incident.versionNumber + 1,
        })
        .where(eq(npAgentIncidents.id, incident.id));
      expect(await run(f)).toEqual({ state: "succeeded" });
      expect(await rows(f)).toEqual([]);
      const [call] = await f.db
        .select()
        .from(npAgentProviderCalls)
        .where(eq(npAgentProviderCalls.runId, f.runId));
      expect(call.decision).toMatchObject({
        task: "moderation-classification",
        decision: {
          label: "uncertain",
          reasonCodes: ["insufficient-evidence"],
          evidenceDigests: [],
        },
      });
    });
  },
);
