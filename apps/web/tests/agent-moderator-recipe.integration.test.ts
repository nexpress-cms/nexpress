import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentEvents,
  npAgentIncidentTimeline,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments, npReports } from "../../../packages/core/src/db/schema/community.js";
import { npSites } from "../../../packages/core/src/db/schema/system.js";
import { updateComment } from "../../../packages/core/src/community/comments.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import { resetCommunityCommentReportObserverV1 } from "../../../packages/core/src/community/report-observer.js";
import { resetCommunityModerationObserverV1 } from "../../../packages/core/src/community/moderation-observer.js";
import { npInspectCommunityContentContainmentV1 } from "../../../packages/core/src/community/content-containment.js";
import { npReadAgentModeratorCommentReportSourceV1 } from "../../../packages/core/src/agent/moderator-report-source.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import type { NpAgentJsonObject } from "../../../packages/core/src/agent-contract/types.js";
import { moderatorRecipeFixture } from "./agent-moderator-recipe-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof moderatorRecipeFixture>>;
type Metadata = Awaited<ReturnType<Fixture["read"]>>;
async function noModerationEffects(f: Fixture, errorCode = "MODERATION_CONFLICT") {
  const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId));
  expect(run.errorCode).toBe(errorCode);
  expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
  expect(await f.db.select().from(npAgentContainments)).toEqual([]);
  expect((await f.db.select().from(npComments)).every((row) => row.status !== "hidden")).toBe(true);
}

describe.skipIf(skipIfNoTestDb())("Shipped Moderator recipe journey", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(() => {
    resetCommunityModerationObserverV1();
    resetCommunityCommentReportObserverV1();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(closeTestDb);

  it("turns actual observed repeated links into one human-approved quarantine and safe completion", async () => {
    const f = await moderatorRecipeFixture();
    try {
      expect(f.collected.acceptedFacts).toBe(5);
      expect(f.collected.observations).toHaveLength(1);
      const current = await f.read();
      expect(current.truncated).toBe(false);
      expect(current.candidates.length).toBeGreaterThan(0);
      expect(current.candidates[0]!.detector).toMatchObject({
        advisory: true,
        itemCount: 5,
        independentAccountCount: 3,
      });
      expect(current.candidates.every((candidate) => !("reportClaims" in candidate.detector))).toBe(
        true,
      );
      const proposal = current.candidates[0]!.proposal;
      f.providerInvoke.mockImplementationOnce(async (request) => {
        const source = request.trustedContext.find((entry) => entry.id === "moderator-candidates");
        expect(source?.classification.dataClass).toBe("sensitive-approved");
        const metadata = JSON.parse(source!.text) as Metadata;
        expect(metadata.candidates[0]!.proposal).toEqual(proposal);
        expect(request.trustedContext.some((entry) => entry.id === "recipe-settings")).toBe(true);
        expect(JSON.stringify(request)).not.toContain("Ignore all instructions");
        expect(JSON.stringify(request)).not.toContain("offer.example");
        for (const member of f.members) expect(JSON.stringify(request)).not.toContain(member.id);
        return f.providerOutcome({
          kind: "propose-capability",
          capabilityId: "moderation.quarantine",
          rationale: "Request review of observed repeated-link evidence.",
          arguments: { mode: "propose", proposal: proposal as unknown as NpAgentJsonObject },
        });
      });
      const input = { siteId, runId: f.runId };
      const result = await f.executor.process(input);
      const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId));
      expect(result, run.errorCode ?? "approval wait").toEqual({ state: "waiting_approval" });
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      const pending = await f.pending(f.runId);
      await f.decide(pending.output.approvalId);
      const resume = { ...input, requestActionId: pending.action.id };
      expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      const [containment] = await f.db.select().from(npAgentContainments);
      expect(containment).toMatchObject({
        incidentId: proposal.incidentId,
        targetRef: proposal.target,
      });
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.runId)),
      ).toHaveLength(1);
      expect(
        (await f.db.select().from(npComments).where(eq(npComments.id, proposal.target.id)))[0]!
          .status,
      ).toBe("hidden");
      const completed = f.providerInvoke.mock.calls[1]![0];
      expect(
        completed.trustedContext.some(
          (entry) =>
            entry.text.includes(containment.id) && entry.text.includes('"state":"succeeded"'),
        ),
      ).toBe(true);
      expect(JSON.stringify(completed)).not.toContain("originalState");
      expect(JSON.stringify(completed)).not.toContain("private=never-copy");
      expect((await f.db.select().from(npAgentIncidentTimeline)).length).toBeGreaterThan(1);
    } finally {
      await f.dispose();
    }
  });

  it.each(["edited", "cross-site", "missing"] as const)(
    "omits %s evidence and refuses an old model-selected proposal",
    async (change) => {
      const f = await moderatorRecipeFixture();
      try {
        const before = await f.read();
        const candidate = before.candidates[0]!;
        expect(candidate).toBeDefined();
        if (change === "edited") {
          const other = f.comments.find((comment) => comment.id !== candidate.proposal.target.id)!;
          await withCurrentSite(siteId, () =>
            updateComment({
              commentId: other.id,
              memberId: other.memberId,
              bodyMd: "Edited to remove the link",
            }),
          );
        } else if (change === "cross-site") {
          await f.db.insert(npSites).values({ id: "recipe-other-site", name: "Other site" });
          await f.db
            .update(npAgentEvents)
            .set({ siteId: "recipe-other-site" })
            .where(eq(npAgentEvents.id, candidate.sourceEventIds[0]!));
        } else {
          await f.db
            .delete(npAgentEvents)
            .where(eq(npAgentEvents.id, candidate.sourceEventIds[0]!));
        }
        expect((await f.read()).candidates).toEqual([]);
        f.propose(candidate.proposal);
        expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("failed");
        expect(f.providerInvoke).toHaveBeenCalledTimes(1);
        await noModerationEffects(f);
      } finally {
        await f.dispose();
      }
    },
  );

  it("rechecks supporting evidence after inference before creating an approval", async () => {
    const f = await moderatorRecipeFixture();
    try {
      f.providerInvoke.mockImplementationOnce(async (request) => {
        const source = request.trustedContext.find((entry) => entry.id === "moderator-candidates")!;
        const candidate = (JSON.parse(source.text) as Metadata).candidates[0]!;
        const other = f.comments.find((comment) => comment.id !== candidate.proposal.target.id)!;
        await withCurrentSite(siteId, () =>
          updateComment({
            commentId: other.id,
            memberId: other.memberId,
            bodyMd: "The supporting evidence has changed",
          }),
        );
        return f.providerOutcome({
          kind: "propose-capability",
          capabilityId: "moderation.quarantine",
          rationale: "Stale evidence must not authorize a proposal.",
          arguments: {
            mode: "propose",
            proposal: candidate.proposal as unknown as NpAgentJsonObject,
          },
        });
      });
      expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("failed");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noModerationEffects(f);
    } finally {
      await f.dispose();
    }
  });

  it("refuses approved execution after a different supporting comment changes", async () => {
    const f = await moderatorRecipeFixture();
    try {
      const proposal = (await f.read()).candidates[0]!.proposal;
      f.propose(proposal);
      expect(await f.executor.process({ siteId, runId: f.runId })).toEqual({
        state: "waiting_approval",
      });
      const pending = await f.pending(f.runId);
      await f.decide(pending.output.approvalId);
      const other = f.comments.find((comment) => comment.id !== proposal.target.id)!;
      await withCurrentSite(siteId, () =>
        updateComment({
          commentId: other.id,
          memberId: other.memberId,
          bodyMd: "Supporting evidence changed after approval",
        }),
      );
      await expect(
        f.executor.resumeApproval({
          siteId,
          runId: f.runId,
          requestActionId: pending.action.id,
        }),
      ).rejects.toMatchObject({ code: "MODERATION_CONFLICT" });
      const [approval] = await f.db
        .select()
        .from(npAgentApprovals)
        .where(eq(npAgentApprovals.id, pending.output.approvalId));
      expect(approval.state).toBe("approved");
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      expect((await f.db.select().from(npComments)).every((row) => row.status !== "hidden")).toBe(
        true,
      );
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
    } finally {
      await f.dispose();
    }
  });

  it("rejects a valid but unrelated comment target even with a current version digest", async () => {
    const f = await moderatorRecipeFixture();
    try {
      const candidate = (await f.read()).candidates[0]!;
      const unrelated = await f.write(0, "An unrelated ordinary comment");
      const target = { kind: "comment" as const, collection: "discussions", id: unrelated.id };
      const inspected = await withCurrentSite(siteId, () =>
        f.db.transaction((tx) =>
          npInspectCommunityContentContainmentV1(tx, { siteId, target, user: f.actor.actor.user }),
        ),
      );
      f.propose({ ...candidate.proposal, target, expectedVersionDigest: inspected.versionDigest });
      expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("failed");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noModerationEffects(f);
    } finally {
      await f.dispose();
    }
  });

  it("reports bounded candidate overflow and refuses to act on a partial evidence page", async () => {
    const f = await moderatorRecipeFixture({ itemCount: 11 });
    try {
      const metadata = await f.read();
      expect(metadata.truncated).toBe(true);
      expect(metadata.candidates).toHaveLength(10);
      f.propose(metadata.candidates[0]!.proposal);
      expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("failed");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noModerationEffects(f);
    } finally {
      await f.dispose();
    }
  });

  it("fails closed when the framework evidence source is not installed", async () => {
    const f = await moderatorRecipeFixture({ sourceAvailable: false });
    try {
      f.propose((await f.read()).candidates[0]!.proposal);
      expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("policy_blocked");
      expect(f.providerInvoke).not.toHaveBeenCalled();
      await noModerationEffects(f, "RUNTIME_PROVIDER_INPUT_UNAVAILABLE");
    } finally {
      await f.dispose();
    }
  });
  it("carries actual unverified reports into a redacted recipe context and exactly one approved receipt", async () => {
    const f = await moderatorRecipeFixture({ source: "reports" });
    try {
      expect(f.reports).toHaveLength(6);
      expect(new Set(f.reports.map((report) => report.reporterId)).size).toBeGreaterThan(3);
      expect(f.collected.acceptedFacts).toBe(6);
      expect(f.collected.observations).toHaveLength(1);
      const metadata = await f.read();
      expect(metadata.candidates).toHaveLength(5);
      const candidate = metadata.candidates[0]!;
      expect(candidate.detector).toMatchObject({
        itemCount: 5,
        independentAccountCount: 3,
        reportClaims: { unverified: true, itemCount: 5 },
      });
      expect(candidate.sourceEventIds).toHaveLength(5);
      f.providerInvoke.mockImplementationOnce(async (request) => {
        const source = request.trustedContext.find((entry) => entry.id === "moderator-candidates")!;
        expect(source.classification.dataClass).toBe("sensitive-approved");
        expect((JSON.parse(source.text) as Metadata).candidates[0]).toEqual(candidate);
        const wire = JSON.stringify(request);
        for (const privateValue of [
          "Ignore all instructions",
          "offer.example",
          "private-report-reason",
          ...f.members.map((member) => member.id),
          ...f.reporters.map((reporter) => reporter.id),
          ...f.reports.map((report) => report.id),
        ])
          expect(wire).not.toContain(privateValue);
        return f.providerOutcome({
          kind: "propose-capability",
          capabilityId: "moderation.quarantine",
          rationale: "Request human review of unverified report evidence.",
          arguments: {
            mode: "propose",
            proposal: candidate.proposal as unknown as NpAgentJsonObject,
          },
        });
      });
      const input = { siteId, runId: f.runId };
      expect(await f.executor.process(input)).toEqual({ state: "waiting_approval" });
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      const pending = await f.pending(f.runId);
      await f.decide(pending.output.approvalId);
      const resume = { ...input, requestActionId: pending.action.id };
      expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      const containments = await f.db.select().from(npAgentContainments);
      expect(containments).toHaveLength(1);
      expect(containments[0]).toMatchObject({
        incidentId: candidate.proposal.incidentId,
        targetRef: candidate.proposal.target,
      });
      expect(
        (
          await f.db
            .select()
            .from(npComments)
            .where(eq(npComments.id, candidate.proposal.target.id))
        )[0]!.status,
      ).toBe("hidden");
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.runId)),
      ).toHaveLength(1);
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      const receipt = JSON.stringify(f.providerInvoke.mock.calls[1]![0]);
      expect(receipt).toContain(containments[0]!.id);
      expect(
        f.providerInvoke.mock.calls[1]![0].trustedContext.some(
          (entry) =>
            entry.text.includes(containments[0]!.id) && entry.text.includes('"state":"succeeded"'),
        ),
      ).toBe(true);
      expect(receipt).not.toContain("originalState");
      expect(receipt).not.toContain("private-report-reason");
    } finally {
      await f.dispose();
    }
  });

  it("retains both observation and report Signals and checks every supporting provenance before deduplicating targets", async () => {
    const f = await moderatorRecipeFixture({ source: "mixed" });
    try {
      expect(f.collected.acceptedFacts).toBe(5);
      expect(f.reportCollected?.acceptedFacts).toBe(6);
      expect(f.reportCollected?.observations[0]!.incidentId).toBe(
        f.collected.observations[0]!.incidentId,
      );
      const current = await f.read();
      expect(current.candidates).toHaveLength(5);
      expect(
        current.candidates.every(
          (candidate) =>
            candidate.detector.independentAccountCount === 3 && candidate.detector.itemCount === 5,
        ),
      ).toBe(true);
      const report = f.reports.find((item) => item.targetId !== f.comments[0]!.id)!;
      // Corrupt the separately attached report Signal even if target dedup selected the observation.
      await f.db
        .update(npReports)
        .set({ reporterId: f.members[0]!.id })
        .where(eq(npReports.id, report.id));
      expect((await f.read()).candidates).toEqual([]);
      await f.db
        .update(npReports)
        .set({ reporterId: report.reporterId })
        .where(eq(npReports.id, report.id));
      expect((await f.read()).candidates).toHaveLength(5);
      await f.resolveReport(report.id);
      expect((await f.read()).candidates).toEqual([]);
      expect(f.providerInvoke).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });

  it("admits a 3-observation plus 2-report campaign and refuses approved execution after supporting report resolution", async () => {
    const f = await moderatorRecipeFixture({ source: "combined" });
    try {
      expect(f.collected.acceptedFacts).toBe(6);
      expect(f.collected.observations).toHaveLength(1);
      expect(f.reportCollected).toBeNull();
      const current = await f.read();
      expect(current.candidates).toHaveLength(5);
      const candidate = current.candidates[0]!;
      expect(candidate.detector).toMatchObject({
        advisory: true,
        itemCount: 5,
        independentAccountCount: 3,
        reportClaims: { unverified: true, itemCount: 2 },
      });
      expect(candidate.sourceEventIds).toHaveLength(5);
      f.providerInvoke.mockImplementationOnce(async (request) => {
        const source = request.trustedContext.find((entry) => entry.id === "moderator-candidates")!;
        expect((JSON.parse(source.text) as Metadata).candidates[0]).toEqual(candidate);
        const wire = JSON.stringify(request);
        for (const privateValue of [
          "Ignore all instructions",
          "offer.example",
          "private-report-reason",
          ...f.members.map((member) => member.id),
          ...f.reporters.map((reporter) => reporter.id),
          ...f.reports.map((report) => report.id),
        ])
          expect(wire).not.toContain(privateValue);
        return f.providerOutcome({
          kind: "propose-capability",
          capabilityId: "moderation.quarantine",
          rationale: "Request human review of a mixed evidence campaign.",
          arguments: {
            mode: "propose",
            proposal: candidate.proposal as unknown as NpAgentJsonObject,
          },
        });
      });
      expect(await f.executor.process({ siteId, runId: f.runId })).toEqual({
        state: "waiting_approval",
      });
      const pending = await f.pending(f.runId);
      await f.decide(pending.output.approvalId);
      const reportedEvent = (await f.db.select().from(npAgentEvents)).find(
        (event) =>
          event.kind === "community.content.reported" &&
          candidate.sourceEventIds.includes(event.id) &&
          event.subject?.kind === "comment" &&
          event.subject.commentId !== candidate.proposal.target.id,
      )!;
      const supportingSource = await npReadAgentModeratorCommentReportSourceV1(reportedEvent);
      if (!supportingSource) throw new Error("Expected retained supporting report evidence");
      await f.resolveReport(supportingSource.reportId);
      expect((await f.read()).candidates).toEqual([]);
      await expect(
        f.executor.resumeApproval({
          siteId,
          runId: f.runId,
          requestActionId: pending.action.id,
        }),
      ).rejects.toMatchObject({ code: "MODERATION_CONFLICT" });
      const [approval] = await f.db
        .select()
        .from(npAgentApprovals)
        .where(eq(npAgentApprovals.id, pending.output.approvalId));
      expect(approval.state).toBe("approved");
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      expect(
        (await f.db.select().from(npComments)).every((comment) => comment.status !== "hidden"),
      ).toBe(true);
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
    } finally {
      await f.dispose();
    }
  });

  it("completes one actual combined campaign through human approval, exactly-once quarantine and a verified receipt", async () => {
    const f = await moderatorRecipeFixture({ source: "combined" });
    try {
      expect(f.collected.observations).toHaveLength(1);
      const [signal] = await f.db.select().from(npAgentSignals);
      expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
      expect(
        signal.evidence.filter(
          (ref) => ref.kind === "event" && ref.eventKind === "community.content.created",
        ),
      ).toHaveLength(3);
      expect(
        signal.evidence.filter(
          (ref) => ref.kind === "event" && ref.eventKind === "community.content.reported",
        ),
      ).toHaveLength(2);
      const candidate = (await f.read()).candidates[0]!;
      expect(candidate.detector).toMatchObject({
        advisory: true,
        itemCount: 5,
        independentAccountCount: 3,
        reportClaims: { unverified: true, itemCount: 2 },
      });
      f.propose(candidate.proposal);
      const input = { siteId, runId: f.runId };
      expect(await f.executor.process(input)).toEqual({ state: "waiting_approval" });
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      expect(
        (await f.db.select().from(npComments)).every((comment) => comment.status !== "hidden"),
      ).toBe(true);
      const pending = await f.pending(f.runId);
      await f.decide(pending.output.approvalId);
      const resume = { ...input, requestActionId: pending.action.id };
      expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      const containments = await f.db.select().from(npAgentContainments);
      expect(containments).toHaveLength(1);
      const containment = containments[0]!;
      expect(containment).toMatchObject({
        incidentId: candidate.proposal.incidentId,
        targetRef: candidate.proposal.target,
      });
      expect(
        (
          await f.db
            .select()
            .from(npComments)
            .where(eq(npComments.id, candidate.proposal.target.id))
        )[0]!.status,
      ).toBe("hidden");
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.runId)),
      ).toHaveLength(1);
      expect(f.providerInvoke).toHaveBeenCalledTimes(2);
      const completed = f.providerInvoke.mock.calls[1]![0];
      expect(
        completed.trustedContext.some(
          (entry) =>
            entry.text.includes(containment.id) && entry.text.includes('"state":"succeeded"'),
        ),
      ).toBe(true);
      const receipt = JSON.stringify(completed);
      expect(receipt).not.toContain("originalState");
      expect(receipt).not.toContain("private-report-reason");
      expect(receipt).not.toContain("private=never-copy");
    } finally {
      await f.dispose();
    }
  });

  it("rejects report resolution after context capture before any provider dispatch", async () => {
    const f = await moderatorRecipeFixture({ source: "reports" });
    try {
      const prepare = f.context.prepare.bind(f.context);
      vi.spyOn(f.context, "prepare").mockImplementationOnce(async (input) => {
        const request = await prepare(input);
        expect(request.trustedContext.some((entry) => entry.id === "moderator-candidates")).toBe(
          true,
        );
        await f.resolveReport(f.reports.find((item) => item.targetId !== f.comments[0]!.id)!.id);
        expect(
          await f.admission.withCurrentRun(
            { siteId, runId: f.runId, ...(input.claim ? { claim: input.claim } : {}) },
            (context) => f.context.verifyRequest(context, request, { db: context.db }),
          ),
        ).toBe(false);
        return request;
      });
      const result = await f.executor.process({ siteId, runId: f.runId });
      const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId));
      expect(result.state, run.errorCode ?? "context attestation refusal").toBe("policy_blocked");
      expect(f.providerInvoke).not.toHaveBeenCalled();
      await noModerationEffects(f, "RUNTIME_PROVIDER_INPUT_UNAVAILABLE");
    } finally {
      await f.dispose();
    }
  });

  it("rechecks supporting report resolution after inference before issuing any approval", async () => {
    const f = await moderatorRecipeFixture({ source: "reports" });
    try {
      f.providerInvoke.mockImplementationOnce(async (request) => {
        const source = request.trustedContext.find((entry) => entry.id === "moderator-candidates")!;
        const candidate = (JSON.parse(source.text) as Metadata).candidates[0]!;
        const other = f.reports.find(
          (report) =>
            report.targetId !== candidate.proposal.target.id &&
            report.targetId !== f.comments[0]!.id,
        )!;
        await f.resolveReport(other.id);
        return f.providerOutcome({
          kind: "propose-capability",
          capabilityId: "moderation.quarantine",
          rationale: "Resolved supporting evidence must be refused.",
          arguments: {
            mode: "propose",
            proposal: candidate.proposal as unknown as NpAgentJsonObject,
          },
        });
      });
      expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("failed");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noModerationEffects(f);
    } finally {
      await f.dispose();
    }
  });

  it("keeps approval unconsumed when supporting reports, current collection ACL or comments drift", async () => {
    const f = await moderatorRecipeFixture({ source: "reports" });
    try {
      const proposal = (await f.read()).candidates[0]!.proposal;
      f.propose(proposal);
      expect(await f.executor.process({ siteId, runId: f.runId })).toEqual({
        state: "waiting_approval",
      });
      const pending = await f.pending(f.runId);
      await f.decide(pending.output.approvalId);
      const resume = { siteId, runId: f.runId, requestActionId: pending.action.id };
      const refuse = async (code = "MODERATION_CONFLICT") => {
        await expect(f.executor.resumeApproval(resume)).rejects.toMatchObject({
          code,
        });
        const [approval] = await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, pending.output.approvalId));
        expect(approval.state).toBe("approved");
        expect(await f.db.select().from(npAgentContainments)).toEqual([]);
        expect(
          (await f.db.select().from(npComments)).every((comment) => comment.status !== "hidden"),
        ).toBe(true);
        expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      };
      const report = f.reports.find(
        (entry) => entry.targetId !== proposal.target.id && entry.targetId !== f.comments[0]!.id,
      )!;
      await f.resolveReport(report.id);
      await refuse();
      await f.db
        .update(npReports)
        .set({
          resolvedAt: report.resolvedAt,
          resolvedByUserId: report.resolvedByUserId,
          resolvedByMemberId: report.resolvedByMemberId,
          resolution: report.resolution,
        })
        .where(eq(npReports.id, report.id));
      expect((await f.read()).candidates).toHaveLength(5);
      const collection = getCollectionConfig("discussions");
      registerCollection("discussions", discussionsTable, {
        ...collection,
        access: { ...collection.access, read: () => false },
      });
      try {
        await refuse("FORBIDDEN");
      } finally {
        registerTestCollections();
      }
      expect((await f.read()).candidates).toHaveLength(5);
      const other = f.comments.find((comment) => comment.id !== proposal.target.id)!;
      await withCurrentSite(siteId, () =>
        updateComment({
          commentId: other.id,
          memberId: other.memberId,
          bodyMd: "Supporting report target changed after approval",
        }),
      );
      await refuse();
    } finally {
      await f.dispose();
    }
  });
});
