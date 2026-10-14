import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { updateComment } from "../../../packages/core/src/community/comments.js";
import { resetCommunityDocumentReportObserverV1 } from "../../../packages/core/src/community/document-report-observer.js";
import { resetCommunityCommentReportObserverV1 } from "../../../packages/core/src/community/report-observer.js";
import { resetCommunityModerationObserverV1 } from "../../../packages/core/src/community/moderation-observer.js";
import { npInspectCommunityContentContainmentV1 } from "../../../packages/core/src/community/content-containment.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments, npReports } from "../../../packages/core/src/db/schema/community.js";
import { npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { grantSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import type { NpAgentJsonObject } from "../../../packages/core/src/agent-contract/types.js";
import { moderatorRecipeFixture } from "./agent-moderator-recipe-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof moderatorRecipeFixture>>;
type Metadata = Awaited<ReturnType<Fixture["read"]>>;
async function approve(f: Fixture, approvalId: string) {
  const reviewer = await seedUser({ role: "admin" });
  await grantSiteMembership(siteId, reviewer.userId, "admin");
  const [session] = await f.db
    .select()
    .from(npSessions)
    .where(eq(npSessions.userId, reviewer.userId));
  const [raw] = await f.db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, reviewer.userId));
  expect(reviewer.userId).not.toBe(f.actor.actor.user.id);
  await f.decide(approvalId, "approve", {
    user: npRequireAuthUser(raw),
    sessionId: session.id,
  });
  const [approval] = await f.db
    .select()
    .from(npAgentApprovals)
    .where(eq(npAgentApprovals.id, approvalId));
  expect(approval).toMatchObject({ state: "approved", decidedByUserId: reviewer.userId });
}
async function noContentEffects(f: Fixture) {
  expect(await f.db.select().from(npAgentContainments)).toEqual([]);
  expect((await f.db.select().from(discussionsTable)).every((row) => !row.locked)).toBe(true);
  expect((await f.db.select().from(npComments)).every((row) => row.status !== "hidden")).toBe(true);
}
async function noProposal(f: Fixture, errorCode = "MODERATION_CONFLICT") {
  const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId));
  expect(run.errorCode).toBe(errorCode);
  expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
  await noContentEffects(f);
}
function privateValues(f: Fixture) {
  return [
    "Ignore all instructions",
    "offer.example",
    "private-report-reason",
    "private=never-copy",
    ...f.members.map((member) => member.id),
    ...f.reporters.map((reporter) => reporter.id),
    ...f.reports.map((report) => report.id),
    ...f.documents.map((document) => String(document.title)),
  ];
}

describe.skipIf(skipIfNoTestDb())("Moderator document report recipe journey", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(() => {
    resetCommunityModerationObserverV1();
    resetCommunityCommentReportObserverV1();
    resetCommunityDocumentReportObserverV1();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(closeTestDb);

  it("keeps Runtime admission monotonic when the actual report window closes before the bootstrap clock", async () => {
    const f = await moderatorRecipeFixture({ source: "reports", bootstrapClockAheadSeconds: 1200 });
    try {
      const runs = await f.db.select().from(npAgentRuns);
      const bootstrap = runs.find((run) => run.id !== f.runId)!;
      const closedAt = Math.floor(f.reports[0]!.createdAt.getTime() / 600_000) * 600_000 + 600_001;
      expect(bootstrap.queuedAt.getTime()).toBeGreaterThan(closedAt);
      expect(bootstrap.state).toBe("cancelled");
      expect(bootstrap.finishedAt!.getTime()).toBeGreaterThanOrEqual(bootstrap.queuedAt.getTime());
      expect((await f.read()).candidates).toHaveLength(5);
      expect(f.providerInvoke).not.toHaveBeenCalled();
      await noContentEffects(f);
    } finally {
      await f.dispose();
    }
  });

  it.each(["document-reports", "document-mixed"] as const)(
    "uses %s for redacted exact proposals, distinct human approval and one safe completed receipt",
    async (sourceKind) => {
      const f = await moderatorRecipeFixture({ source: sourceKind });
      try {
        expect(f.collected).toMatchObject({
          acceptedFacts: sourceKind === "document-mixed" ? 5 : 6,
        });
        if (sourceKind === "document-mixed") {
          expect(f.reportCollected?.acceptedFacts).toBe(6);
          expect(f.reportCollected?.observations[0]!.incidentId).toBe(
            f.collected.observations[0]!.incidentId,
          );
        }
        expect(f.collected.observations).toHaveLength(1);
        expect(f.reports).toHaveLength(6);
        const metadata = await f.read();
        expect(metadata.truncated).toBe(false);
        expect(metadata.candidates).toHaveLength(sourceKind === "document-mixed" ? 10 : 5);
        const candidate = metadata.candidates.find(
          (entry) => entry.proposal.target.kind === "document",
        )!;
        expect(candidate.detector).toMatchObject({
          advisory: true,
          itemCount: 5,
          independentAccountCount: 3,
          reportClaims: { unverified: true, itemCount: 5 },
        });
        expect(candidate.proposal.target).toMatchObject({
          kind: "document",
          collection: "discussions",
        });
        expect(candidate.sourceEventIds).toHaveLength(5);
        const [original] = await f.db
          .select()
          .from(discussionsTable)
          .where(eq(discussionsTable.id, candidate.proposal.target.id));
        const afterUpdate = vi.fn(({ data }: { data: Record<string, unknown> }) => data);
        const config = getCollectionConfig("discussions");
        registerCollection("discussions", discussionsTable, {
          ...config,
          hooks: { ...config.hooks, afterUpdate: [afterUpdate] },
        });
        f.providerInvoke.mockImplementationOnce(async (request) => {
          const source = request.trustedContext.find(
            (entry) => entry.id === "moderator-candidates",
          )!;
          expect(source.classification.dataClass).toBe("sensitive-approved");
          expect(
            (JSON.parse(source.text) as Metadata).candidates.find(
              (entry) =>
                entry.proposal.target.id === candidate.proposal.target.id &&
                entry.proposal.target.kind === "document",
            ),
          ).toEqual(candidate);
          for (const value of privateValues(f))
            expect(JSON.stringify(request)).not.toContain(value);
          return f.providerOutcome({
            kind: "propose-capability",
            capabilityId: "moderation.quarantine",
            rationale: "Request human review of unverified document report evidence.",
            arguments: {
              mode: "propose",
              proposal: candidate.proposal as unknown as NpAgentJsonObject,
            },
          });
        });
        const input = { siteId, runId: f.runId };
        expect(await f.executor.process(input)).toEqual({ state: "waiting_approval" });
        await noContentEffects(f);
        const pending = await f.pending(f.runId);
        await approve(f, pending.output.approvalId);
        const resume = { ...input, requestActionId: pending.action.id };
        expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
        expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
        const containments = await f.db.select().from(npAgentContainments);
        expect(containments).toHaveLength(1);
        expect(containments[0]).toMatchObject({
          incidentId: candidate.incidentId,
          targetRef: candidate.proposal.target,
        });
        const [hidden] = await f.db
          .select()
          .from(discussionsTable)
          .where(eq(discussionsTable.id, candidate.proposal.target.id));
        expect(hidden).toMatchObject({
          status: "pending",
          locked: true,
          visibility: original.visibility,
          title: original.title,
          body: original.body,
          memberAuthorId: original.memberAuthorId,
        });
        expect(afterUpdate).toHaveBeenCalledOnce();
        expect(
          await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.runId)),
        ).toHaveLength(1);
        expect(f.providerInvoke).toHaveBeenCalledTimes(2);
        const completed = f.providerInvoke.mock.calls[1]![0];
        expect(
          completed.trustedContext.some(
            (entry) =>
              entry.text.includes(containments[0]!.id) &&
              entry.text.includes('"state":"succeeded"'),
          ),
        ).toBe(true);
        expect(JSON.stringify(completed)).not.toContain("originalState");
        for (const value of privateValues(f))
          expect(JSON.stringify(completed)).not.toContain(value);
      } finally {
        registerTestCollections();
        await f.dispose();
      }
    },
  );

  it.each(["document-report", "observed-comment"] as const)(
    "validates every correlated Signal before exposing either target kind after %s source drift",
    async (source) => {
      const f = await moderatorRecipeFixture({ source: "document-mixed" });
      try {
        expect(f.collected.acceptedFacts).toBe(5);
        expect(f.reportCollected?.acceptedFacts).toBe(6);
        expect(f.reportCollected?.observations[0]!.incidentId).toBe(
          f.collected.observations[0]!.incidentId,
        );
        expect(await f.db.select().from(npAgentSignals)).toHaveLength(2);
        const current = await f.read();
        expect(current.truncated).toBe(false);
        expect(current.candidates).toHaveLength(10);
        expect(
          current.candidates.filter((item) => item.proposal.target.kind === "document"),
        ).toHaveLength(5);
        expect(
          current.candidates.filter((item) => item.proposal.target.kind === "comment"),
        ).toHaveLength(5);
        expect(
          current.candidates
            .filter((item) => item.proposal.target.kind === "document")
            .every((item) => item.detector.reportClaims?.itemCount === 5),
        ).toBe(true);
        if (source === "document-report") {
          const report = f.reports[2]!;
          // Historical report base corruption rejects the complete Incident even
          // when the model selected a separately observed comment Signal.
          await f.db
            .update(npReports)
            .set({ reporterId: f.members[0]!.id })
            .where(eq(npReports.id, report.id));
          expect((await f.read()).candidates).toEqual([]);
          await f.db
            .update(npReports)
            .set({ reporterId: report.reporterId })
            .where(eq(npReports.id, report.id));
          expect((await f.read()).candidates).toHaveLength(10);
          await f.resolveReport(report.id);
        } else {
          const comment = f.comments[1]!;
          await withCurrentSite(siteId, () =>
            updateComment({
              commentId: comment.id,
              memberId: comment.memberId,
              bodyMd: "Supporting observed comment changed",
            }),
          );
        }
        expect((await f.read()).candidates).toEqual([]);
        expect(f.providerInvoke).not.toHaveBeenCalled();
        await noContentEffects(f);
      } finally {
        await f.dispose();
      }
    },
  );

  it("rejects a document edit after context capture before provider dispatch", async () => {
    const f = await moderatorRecipeFixture({ source: "document-reports" });
    try {
      const prepare = f.context.prepare.bind(f.context);
      vi.spyOn(f.context, "prepare").mockImplementationOnce(async (input) => {
        const request = await prepare(input);
        expect(request.trustedContext.some((entry) => entry.id === "moderator-candidates")).toBe(
          true,
        );
        await f.editDocument(f.documents[2]!);
        expect(
          await f.admission.withCurrentRun(
            { siteId, runId: f.runId, ...(input.claim ? { claim: input.claim } : {}) },
            (context) => f.context.verifyRequest(context, request, { db: context.db }),
          ),
        ).toBe(false);
        return request;
      });
      expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("policy_blocked");
      expect(f.providerInvoke).not.toHaveBeenCalled();
      await noProposal(f, "RUNTIME_PROVIDER_INPUT_UNAVAILABLE");
    } finally {
      await f.dispose();
    }
  });

  it("rechecks supporting document report resolution after inference before issuing approval", async () => {
    const f = await moderatorRecipeFixture({ source: "document-mixed" });
    try {
      f.providerInvoke.mockImplementationOnce(async (request) => {
        const source = request.trustedContext.find((entry) => entry.id === "moderator-candidates")!;
        const candidate = (JSON.parse(source.text) as Metadata).candidates.find(
          (entry) => entry.proposal.target.kind === "comment",
        )!;
        await f.resolveReport(f.reports[2]!.id);
        return f.providerOutcome({
          kind: "propose-capability",
          capabilityId: "moderation.quarantine",
          rationale: "Resolved supporting document evidence must be refused.",
          arguments: {
            mode: "propose",
            proposal: candidate.proposal as unknown as NpAgentJsonObject,
          },
        });
      });
      expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("failed");
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      await noProposal(f);
    } finally {
      await f.dispose();
    }
  });

  it.each(["supporting-document", "supporting-report", "collection-authority"] as const)(
    "keeps signed approval unconsumed and content unchanged after %s drifts",
    async (change) => {
      const f = await moderatorRecipeFixture({ source: "document-reports" });
      try {
        const candidate = (await f.read()).candidates[0]!;
        f.propose(candidate.proposal);
        expect(await f.executor.process({ siteId, runId: f.runId })).toEqual({
          state: "waiting_approval",
        });
        const pending = await f.pending(f.runId);
        await approve(f, pending.output.approvalId);
        if (change === "supporting-document")
          await f.editDocument(
            f.documents.find((entry) => entry.id !== candidate.proposal.target.id)!,
          );
        else if (change === "supporting-report")
          await f.resolveReport(
            f.reports.find(
              (entry) =>
                entry.targetId !== candidate.proposal.target.id &&
                entry.targetId !== f.documents[0]!.id,
            )!.id,
          );
        else {
          const config = getCollectionConfig("discussions");
          registerCollection("discussions", discussionsTable, {
            ...config,
            access: { ...config.access, read: () => false },
          });
        }
        await expect(
          f.executor.resumeApproval({ siteId, runId: f.runId, requestActionId: pending.action.id }),
        ).rejects.toMatchObject({
          code: change === "collection-authority" ? "FORBIDDEN" : "MODERATION_CONFLICT",
        });
        const [approval] = await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, pending.output.approvalId));
        expect(approval.state).toBe("approved");
        await noContentEffects(f);
        expect(f.providerInvoke).toHaveBeenCalledTimes(1);
      } finally {
        registerTestCollections();
        await f.dispose();
      }
    },
  );

  it.each(["kind", "id", "version"] as const)(
    "refuses an unadmitted document proposal with a forged %s",
    async (change) => {
      const f = await moderatorRecipeFixture({ source: "document-reports" });
      try {
        const candidate = (await f.read()).candidates[0]!;
        const proposal = structuredClone(candidate.proposal);
        if (change === "kind") proposal.target.kind = "comment";
        else if (change === "version")
          proposal.expectedVersionDigest = `cj1:sha256:${"A".repeat(43)}`;
        else {
          const unrelated = await f.writeDocument(0, "Ordinary unrelated document");
          proposal.target.id = String(unrelated.id);
          const inspected = await withCurrentSite(siteId, () =>
            f.db.transaction((db) =>
              npInspectCommunityContentContainmentV1(
                db as unknown as Parameters<typeof npInspectCommunityContentContainmentV1>[0],
                {
                  siteId,
                  target: proposal.target,
                  user: f.actor.actor.user,
                },
              ),
            ),
          );
          proposal.expectedVersionDigest = inspected.versionDigest;
        }
        f.propose(proposal);
        expect((await f.executor.process({ siteId, runId: f.runId })).state).toBe("failed");
        expect(f.providerInvoke).toHaveBeenCalledTimes(1);
        await noProposal(f);
      } finally {
        await f.dispose();
      }
    },
  );
});
