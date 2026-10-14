import { randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import {
  npDigestAgentEventCanonical,
  npRequireAgentEventCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import type {
  NpAgentModeratorSettingsV1,
  NpAgentModeratorSignalCandidateV1,
} from "../../../packages/core/src/agent-contract/moderator-contract.js";
import type { NpAgentJsonObject } from "../../../packages/core/src/agent-contract/types.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import {
  createAgentModeratorCollectorV1,
  createAgentModeratorCommentObserverV1,
} from "../../../packages/core/src/agent/moderator-collector.js";
import {
  createAgentModeratorCombinedCommentCollectorV1,
  createAgentModeratorCombinedContentCollectorV1,
} from "../../../packages/core/src/agent/moderator-combined-collector.js";
import { npResolveAgentModeratorCombinedContentEvidenceV1 } from "../../../packages/core/src/agent/moderator-content-evidence.js";
import { npAgentModeratorWindowStartedAtV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import {
  createAgentModeratorCommentReportCollectorV1,
  createAgentModeratorCommentReportObserverV1,
} from "../../../packages/core/src/agent/moderator-report-source.js";
import {
  createAgentModeratorDocumentReportCollectorV1,
  createAgentModeratorDocumentReportObserverV1,
} from "../../../packages/core/src/agent/moderator-document-report-source.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createMemberDocument,
  deleteMemberDocument,
  updateMemberDocument,
  withDeferredPostCommit,
} from "../../../packages/core/src/collections/pipeline.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { createComment } from "../../../packages/core/src/community/comments.js";
import {
  npInspectCommunityContentContainmentV1,
  npQuarantineCommunityContentV1,
} from "../../../packages/core/src/community/content-containment.js";
import {
  resetCommunityDocumentReportObserverV1,
  setCommunityDocumentReportObserverV1,
} from "../../../packages/core/src/community/document-report-observer.js";
import {
  resetCommunityModerationObserverV1,
  setCommunityModerationObserverV1,
} from "../../../packages/core/src/community/moderation-observer.js";
import {
  resetCommunityCommentReportObserverV1,
  setCommunityCommentReportObserverV1,
} from "../../../packages/core/src/community/report-observer.js";
import { fileReport, resolveReport } from "../../../packages/core/src/community/reports.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentEvents,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments, npReports } from "../../../packages/core/src/db/schema/community.js";
import { npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { grantSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import { moderatorRecipeFixture } from "./agent-moderator-recipe-fixture.js";
import { siteId as runtimeSiteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const siteId = "default";
const settings: NpAgentModeratorSettingsV1 = {
  recipeId: "moderator.repeated-link-spam",
  recipeVersion: 1,
  collectionSlugs: ["discussions"],
  windowSeconds: 600,
  minIndependentAccounts: 3,
  minItems: 5,
  automaticConfidenceBasisPoints: 9950,
};
type ContentCounts = { documents: number; observedComments: number; reportedComments: number };
const allSources: ContentCounts = { documents: 2, observedComments: 2, reportedComments: 1 };

function configureDocuments() {
  const config = getCollectionConfig("discussions");
  registerCollection("discussions", discussionsTable, {
    ...config,
    community: { ...config.community, reports: true, moderation: { hiddenField: "locked" } },
  });
}
async function collectionFixture(
  options: { counts?: ContentCounts; duplicates?: boolean; sameAuthor?: boolean } = {},
) {
  const db = await getTestDb();
  const { userId } = await seedUser({ role: "admin" });
  const [raw] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, userId));
  const user = npRequireAuthUser(raw);
  const members = await Promise.all(
    ["alice", "bravo", "charlie"].map((handle) =>
      seedActiveMember({ handle, email: `${handle}@example.com` }),
    ),
  );
  const reporters = await Promise.all(
    ["reporter-one", "reporter-two", "reporter-three"].map((handle) =>
      seedActiveMember({ handle, email: `${handle}@example.com` }),
    ),
  );
  const never = () => Promise.reject(new Error("Collection must not activate Runtime"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "content-collector-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: ["site:read"],
    },
    enqueueRun: never,
  });
  const observed = createAgentModeratorCommentObserverV1({ events });
  setCommunityDocumentReportObserverV1(createAgentModeratorDocumentReportObserverV1({ events }));
  setCommunityCommentReportObserverV1(createAgentModeratorCommentReportObserverV1({ events }));
  const writeDocument = async (index: number, campaign = true) => {
    const body = npCreateEmptyRichTextContent();
    body.document.root.children[0]!.children = [
      {
        type: "text",
        version: 1,
        text: campaign
          ? `Private campaign ${index} https://offer.example/sale?private=never-copy`
          : "Ordinary comment parent",
      },
    ];
    return (
      await withCurrentSite(siteId, () =>
        createMemberDocument(
          "discussions",
          { title: `Actual document ${randomUUID()}`, body },
          members[(options.sameAuthor ? 0 : index) % members.length]!.memberId,
        ),
      )
    ).doc;
  };
  const report = (kind: "comment" | "discussions", id: string, reporterIndex = 0) =>
    withCurrentSite(siteId, () =>
      fileReport({
        targetType: kind,
        targetId: id,
        reporterId: reporters[reporterIndex]!.memberId,
        reason: "Unverified private report me@example.test",
      }),
    );
  const counts = options.counts ?? { documents: 3, observedComments: 2, reportedComments: 0 };
  const documents: Awaited<ReturnType<typeof writeDocument>>[] = [];
  const comments: Awaited<ReturnType<typeof createComment>>[] = [];
  const reports: Awaited<ReturnType<typeof report>>[] = [];
  let windowStartedAt: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = await writeDocument(0, false);
    for (let index = 0; index < counts.documents; index++) {
      const target = await writeDocument(index);
      documents.push(target);
      reports.push(await report("discussions", String(target.id), index % reporters.length));
    }
    for (let index = 0; index < counts.observedComments + counts.reportedComments; index++) {
      resetCommunityModerationObserverV1();
      const observation = index < counts.observedComments;
      if (observation) setCommunityModerationObserverV1(observed);
      const comment = await withCurrentSite(siteId, () =>
        createComment({
          targetType: "discussions",
          targetId: String(parent.id),
          memberId:
            members[(options.sameAuthor ? 0 : counts.documents + index) % members.length]!.memberId,
          bodyMd: `Private campaign ${index} https://offer.example/sale?private=never-copy`,
        }),
      );
      comments.push(comment);
      if (!observation) reports.push(await report("comment", comment.id));
    }
    if (options.duplicates) {
      reports.push(await report("discussions", String(documents[0]!.id), 1));
      reports.push(await report("comment", comments[0]!.id, 2));
    }
    const timestamps = [...comments, ...reports].map((row) => row.createdAt);
    windowStartedAt = npAgentModeratorWindowStartedAtV1(timestamps[0]!.toISOString());
    if (
      timestamps.every(
        (time) => npAgentModeratorWindowStartedAtV1(time.toISOString()) === windowStartedAt,
      )
    )
      break;
    if (attempt === 2) throw new Error("Could not prepare one complete content window");
    for (const target of [...documents, parent])
      await withCurrentSite(siteId, () =>
        deleteMemberDocument("discussions", String(target.id), String(target.memberAuthorId)),
      );
    documents.length = 0;
    comments.length = 0;
    reports.length = 0;
    windowStartedAt = null;
  }
  if (!windowStartedAt) throw new Error("Expected one closed content window");
  const now = () => new Date(Date.parse(windowStartedAt) + 600_001);
  let captured: NpAgentModeratorSignalCandidateV1 | null = null;
  const incidents = createAgentIncidentWriteServiceV1({
    now,
    resolveEvidence(input) {
      captured = structuredClone(input.candidate);
      return npResolveAgentModeratorCombinedContentEvidenceV1({ ...input, staffUserId: userId });
    },
  });
  const collectorOptions = { staffUserId: userId, incidents, now };
  return {
    db,
    userId,
    user,
    members,
    reporters,
    documents,
    comments,
    reports,
    incidents,
    collectorOptions,
    input: { siteId, windowStartedAt, settings },
    collector: createAgentModeratorCombinedContentCollectorV1(collectorOptions),
    candidate() {
      if (!captured) throw new Error("Expected one complete mixed candidate");
      return structuredClone(captured);
    },
  };
}
async function stored(db: Awaited<ReturnType<typeof getTestDb>>) {
  return {
    incidents: await db.select().from(npAgentIncidents),
    signals: await db.select().from(npAgentSignals),
    timeline: await db.select().from(npAgentIncidentTimeline),
  };
}
type RecipeFixture = Awaited<ReturnType<typeof moderatorRecipeFixture>>;
type Metadata = Awaited<ReturnType<RecipeFixture["read"]>>;
async function approve(f: RecipeFixture, approvalId: string) {
  const reviewer = await seedUser({ role: "admin" });
  await grantSiteMembership(runtimeSiteId, reviewer.userId, "admin");
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
async function noContentEffects(f: RecipeFixture) {
  expect(await f.db.select().from(npAgentContainments)).toEqual([]);
  expect((await f.db.select().from(discussionsTable)).every((row) => !row.locked)).toBe(true);
  expect((await f.db.select().from(npComments)).every((row) => row.status !== "hidden")).toBe(true);
}
function privateValues(f: RecipeFixture) {
  return [
    "Ignore all instructions",
    "offer.example",
    "private-report-reason",
    "private=never-copy",
    ...f.members.map((row) => row.id),
    ...f.reporters.map((row) => row.id),
    ...f.reports.map((row) => row.id),
    ...f.documents.map((row) => String(row.title)),
  ];
}

describe.skipIf(skipIfNoTestDb())("Moderator unified actual content collection", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
    configureDocuments();
  });
  afterEach(() => {
    resetCommunityModerationObserverV1();
    resetCommunityCommentReportObserverV1();
    resetCommunityDocumentReportObserverV1();
    registerTestCollections();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(closeTestDb);

  it("joins three document reports and two observed comments only through the new content owner", async () => {
    const f = await collectionFixture();
    for (const create of [
      createAgentModeratorCollectorV1,
      createAgentModeratorCommentReportCollectorV1,
      createAgentModeratorDocumentReportCollectorV1,
      createAgentModeratorCombinedCommentCollectorV1,
    ])
      expect((await create(f.collectorOptions).collect(f.input)).observations).toEqual([]);
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
    const collected = await f.collector.collect(f.input);
    expect(collected.acceptedFacts).toBe(5);
    expect(collected.inspectedEvents).toBeGreaterThanOrEqual(5);
    expect(collected.observations).toHaveLength(1);
    const candidate = f.candidate();
    expect(candidate.facts.filter((fact) => fact.subject.kind === "document")).toHaveLength(3);
    expect(candidate.facts.filter((fact) => fact.subject.kind === "comment")).toHaveLength(2);
    expect(new Set(candidate.facts.map((fact) => fact.memberId)).size).toBe(3);
    const retained = await stored(f.db);
    expect(retained.signals).toHaveLength(1);
    expect(retained.incidents).toHaveLength(1);
    expect(retained.timeline).toHaveLength(1);
    expect((await f.collector.collect(f.input)).observations[0]).toMatchObject({
      ...collected.observations[0],
      disposition: "replayed",
    });
    expect(await stored(f.db)).toEqual(retained);
  });

  it("combines all three source owners while deduplicating target claims and using actual author independence", async () => {
    const f = await collectionFixture({ counts: allSources, duplicates: true });
    for (const threshold of [{ minItems: 6 }, { minIndependentAccounts: 4 }])
      expect(
        (await f.collector.collect({ ...f.input, settings: { ...settings, ...threshold } }))
          .observations,
      ).toEqual([]);
    const result = await f.collector.collect(f.input);
    expect(result.acceptedFacts).toBe(7);
    expect(result.inspectedEvents).toBeGreaterThanOrEqual(7);
    expect(result.observations).toHaveLength(1);
    const candidate = f.candidate();
    expect(candidate.facts).toHaveLength(5);
    expect(
      new Set(
        candidate.facts.map((fact) =>
          fact.subject.kind === "document" ? fact.subject.documentId : fact.subject.commentId,
        ),
      ).size,
    ).toBe(5);
    expect(new Set(candidate.facts.map((fact) => fact.memberId)).size).toBe(3);
    expect(
      candidate.facts.every(
        (fact) =>
          fact.evidence.kind !== "event" ||
          fact.evidence.eventKind !== "community.content.reported" ||
          (fact.spamVerdict === "unknown" && fact.profanityVerdict === "unknown"),
      ),
    ).toBe(true);
    const retained = await stored(f.db);
    expect(JSON.stringify(retained)).not.toContain("private=never-copy");
    expect(JSON.stringify(retained)).not.toContain("me@example.test");
    expect(
      (await createAgentModeratorCombinedCommentCollectorV1(f.collectorOptions).collect(f.input))
        .acceptedFacts,
    ).toBe(4);
    expect(await stored(f.db)).toEqual(retained);
  });

  it("does not manufacture independent authors from several actual reporters on one author's targets", async () => {
    const f = await collectionFixture({ counts: allSources, duplicates: true, sameAuthor: true });
    expect(new Set(f.reporters.map((member) => member.memberId)).size).toBe(3);
    expect(await f.collector.collect(f.input)).toMatchObject({
      acceptedFacts: 7,
      observations: [],
    });
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
  });

  it("applies one global 100-event bound across three exact sources before inspection or writes", async () => {
    const f = await collectionFixture({ counts: allSources });
    const inWindow = and(
      eq(npAgentEvents.siteId, siteId),
      gte(npAgentEvents.occurredAt, new Date(f.input.windowStartedAt)),
      lt(npAgentEvents.occurredAt, new Date(Date.parse(f.input.windowStartedAt) + 600_000)),
    );
    const originals = await f.db.select().from(npAgentEvents).where(inWindow);
    const sources = [
      "community.comments",
      "community.comment-reports",
      "community.document-reports",
    ].map((component) => originals.find((row) => row.sourceComponent === component)!);
    const capacityCount = 101 - originals.length;
    expect(capacityCount).toBeGreaterThan(0);
    // Capacity-only canonical persistence fixtures. These do not represent
    // additional real filings, and their distinct keys cannot inspect as facts.
    const extra = await Promise.all(
      Array.from({ length: capacityCount }, async (_, index) => {
        const source = sources[index % sources.length]!;
        const deduplicationKey = `content.capacity.${index}`;
        const event = npRequireAgentEventCanonical({
          version: "np.agent-event.v1",
          siteId,
          kind: source.kind,
          occurredAt: source.occurredAt.toISOString(),
          source: { kind: source.sourceKind, component: source.sourceComponent },
          subject: source.subject,
          actor: source.actor,
          causation: source.causation,
          correlationId: source.correlationId,
          deduplicationKey,
          privacy: source.privacy,
          payload: source.payload,
        });
        return {
          ...source,
          id: randomUUID(),
          deduplicationKey,
          eventHash: await npDigestAgentEventCanonical(event),
        };
      }),
    );
    await f.db.insert(npAgentEvents).values(extra);
    // Unrelated component fixtures must not consume this exact-source bound.
    await f.db.insert(npAgentEvents).values(
      Array.from({ length: 110 }, (_, index) => ({
        ...sources[0]!,
        id: randomUUID(),
        sourceComponent: "community.unrelated",
        deduplicationKey: `unrelated.capacity.${index}`,
      })),
    );
    const read = vi.fn(() => true);
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", discussionsTable, {
      ...config,
      access: { ...config.access, read },
    });
    await expect(f.collector.collect(f.input)).rejects.toMatchObject({
      code: "MODERATOR_COLLECTION_LIMIT",
    });
    expect(read).not.toHaveBeenCalled();
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
    await f.db.delete(npAgentEvents).where(eq(npAgentEvents.id, extra[0]!.id));
    expect(await f.collector.collect(f.input)).toMatchObject({
      inspectedEvents: 100,
      acceptedFacts: 5,
    });
    expect((await stored(f.db)).signals).toHaveLength(1);
  });

  it("revalidates the whole candidate for historical integrity, source site and current access", async () => {
    const f = await collectionFixture();
    await f.collector.collect(f.input);
    const candidate = f.candidate();
    const retained = await stored(f.db);
    const refuse = async () => {
      await expect(f.incidents.observe(candidate)).rejects.toThrow();
      expect(await stored(f.db)).toEqual(retained);
    };
    const claim = f.reports[0]!;
    await f.db
      .update(npReports)
      .set({ reason: "Tampered filing" })
      .where(eq(npReports.id, claim.id));
    await refuse();
    await f.db.update(npReports).set({ reason: claim.reason }).where(eq(npReports.id, claim.id));
    const observed = candidate.facts.find((fact) => fact.subject.kind === "comment")!;
    if (observed.evidence.kind !== "event") throw new Error("Expected actual Event evidence");
    const [event] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, observed.evidence.eventId));
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentEvents.id, event.id));
    await refuse();
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: event.eventHash })
      .where(eq(npAgentEvents.id, event.id));
    const document = f.documents[0]!;
    await f.db
      .update(discussionsTable)
      .set({ siteId: "other-site" })
      .where(eq(discussionsTable.id, String(document.id)));
    await refuse();
    await f.db
      .update(discussionsTable)
      .set({ siteId })
      .where(eq(discussionsTable.id, String(document.id)));
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", discussionsTable, {
      ...config,
      access: { ...config.access, read: () => false },
    });
    await refuse();
    registerCollection("discussions", discussionsTable, config);
    expect((await f.incidents.observe(candidate)).disposition).toBe("replayed");
    expect(await stored(f.db)).toEqual(retained);
  });

  it.each(["edited", "hidden", "resolved"] as const)(
    "refuses the whole mixed candidate when one retained document source becomes %s",
    async (state) => {
      const f = await collectionFixture();
      await f.collector.collect(f.input);
      const candidate = f.candidate();
      const retained = await stored(f.db);
      const document = f.documents[0]!;
      if (state === "edited")
        await withCurrentSite(siteId, () =>
          updateMemberDocument(
            "discussions",
            String(document.id),
            { title: "Actual edit" },
            String(document.memberAuthorId),
          ),
        );
      else if (state === "hidden") {
        const target = {
          kind: "document" as const,
          collection: "discussions",
          id: String(document.id),
        };
        await withCurrentSite(siteId, () =>
          withDeferredPostCommit(() =>
            f.db.transaction(async (db) => {
              const transaction = db as unknown as Parameters<
                typeof npInspectCommunityContentContainmentV1
              >[0];
              const current = await npInspectCommunityContentContainmentV1(transaction, {
                siteId,
                target,
                user: f.user,
              });
              return npQuarantineCommunityContentV1(transaction, {
                siteId,
                target,
                user: f.user,
                expectedVersionDigest: current.versionDigest,
                reasonCode: "HUMAN_REVIEW",
              });
            }),
          ),
        );
      } else
        await withCurrentSite(siteId, () =>
          resolveReport({
            reportId: f.reports[0]!.id,
            action: "dismiss",
            actor: { kind: "staff", user: f.user },
          }),
        );
      await expect(f.incidents.observe(candidate)).rejects.toThrow();
      expect(await stored(f.db)).toEqual(retained);
      expect(await f.collector.collect(f.input)).toMatchObject({
        acceptedFacts: 4,
        observations: [],
      });
      expect(await stored(f.db)).toEqual(retained);
    },
  );

  it("rolls back the whole mixed Signal when final current staff admission fails after actual writes", async () => {
    const f = await collectionFixture({ counts: allSources });
    const retainedEvents = await f.db.select().from(npAgentEvents);
    let wrote = false;
    const collector = createAgentModeratorCombinedContentCollectorV1({
      ...f.collectorOptions,
      incidents: {
        ...f.incidents,
        async observe(candidate, supplied) {
          if (!supplied?.transaction) throw new Error("Expected one collector transaction");
          const result = await f.incidents.observe(candidate, supplied);
          expect(await supplied.transaction.select().from(npAgentSignals)).toHaveLength(1);
          expect(await supplied.transaction.select().from(npAgentIncidents)).toHaveLength(1);
          wrote = true;
          await supplied.transaction
            .update(npUsers)
            .set({ role: "viewer" })
            .where(eq(npUsers.id, f.userId));
          return result;
        },
      },
    });
    await expect(collector.collect(f.input)).rejects.toThrow();
    expect(wrote).toBe(true);
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
    expect((await f.db.select().from(npUsers).where(eq(npUsers.id, f.userId)))[0]!.role).toBe(
      "admin",
    );
    expect(await f.db.select().from(npAgentEvents)).toEqual(retainedEvents);
  });

  it.each(["document", "comment"] as const)(
    "uses one whole mixed Signal for an exact %s proposal, distinct signed human approval and one redacted completion",
    async (targetKind) => {
      const f = await moderatorRecipeFixture({
        source: "content-combined",
        contentCounts: allSources,
      });
      try {
        expect(f.collected.acceptedFacts).toBe(5);
        expect(f.collected.inspectedEvents).toBeGreaterThanOrEqual(5);
        expect(f.collected.observations).toHaveLength(1);
        expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
        const metadata = await f.read();
        expect(metadata.truncated).toBe(false);
        expect(metadata.candidates).toHaveLength(5);
        expect(
          metadata.candidates.filter((entry) => entry.proposal.target.kind === "document"),
        ).toHaveLength(2);
        expect(
          metadata.candidates.filter((entry) => entry.proposal.target.kind === "comment"),
        ).toHaveLength(3);
        const candidate = metadata.candidates.find(
          (entry) => entry.proposal.target.kind === targetKind,
        )!;
        expect(candidate.sourceEventIds).toHaveLength(5);
        expect(candidate.detector).toMatchObject({
          advisory: true,
          itemCount: 5,
          independentAccountCount: 3,
          reportClaims: { unverified: true, itemCount: 3 },
        });
        f.providerInvoke.mockImplementationOnce(async (request) => {
          const context = request.trustedContext.find(
            (entry) => entry.id === "moderator-candidates",
          )!;
          expect((JSON.parse(context.text) as Metadata).candidates).toEqual(metadata.candidates);
          for (const value of privateValues(f))
            expect(JSON.stringify(request)).not.toContain(value);
          return f.providerOutcome({
            kind: "propose-capability",
            capabilityId: "moderation.quarantine",
            rationale: "Human review of a complete mixed campaign",
            arguments: {
              mode: "propose",
              proposal: candidate.proposal as unknown as NpAgentJsonObject,
            },
          });
        });
        const input = { siteId: runtimeSiteId, runId: f.runId };
        expect(await f.executor.process(input)).toEqual({ state: "waiting_approval" });
        await noContentEffects(f);
        const pending = await f.pending(f.runId);
        await approve(f, pending.output.approvalId);
        const resume = { ...input, requestActionId: pending.action.id };
        expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
        expect(await f.executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
        const containments = await f.db.select().from(npAgentContainments);
        expect(containments).toHaveLength(1);
        expect(containments[0]!.targetRef).toEqual(candidate.proposal.target);
        if (targetKind === "document")
          expect(
            (
              await f.db
                .select()
                .from(discussionsTable)
                .where(eq(discussionsTable.id, candidate.proposal.target.id))
            )[0],
          ).toMatchObject({ status: "pending", locked: true });
        else
          expect(
            (
              await f.db
                .select()
                .from(npComments)
                .where(eq(npComments.id, candidate.proposal.target.id))
            )[0],
          ).toMatchObject({ status: "hidden" });
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
        await f.dispose();
      }
    },
  );

  it("refuses the whole mixed campaign when a supporting document report resolves after approval", async () => {
    const f = await moderatorRecipeFixture({
      source: "content-combined",
      contentCounts: allSources,
    });
    try {
      const candidate = (await f.read()).candidates.find(
        (entry) => entry.proposal.target.kind === "comment",
      )!;
      f.propose(candidate.proposal);
      expect(await f.executor.process({ siteId: runtimeSiteId, runId: f.runId })).toEqual({
        state: "waiting_approval",
      });
      const pending = await f.pending(f.runId);
      await approve(f, pending.output.approvalId);
      const supporting = f.reports.find((report) => report.targetType === "discussions")!;
      await f.resolveReport(supporting.id);
      expect((await f.read()).candidates).toEqual([]);
      await expect(
        f.executor.resumeApproval({
          siteId: runtimeSiteId,
          runId: f.runId,
          requestActionId: pending.action.id,
        }),
      ).rejects.toMatchObject({ code: "MODERATION_CONFLICT" });
      expect(
        (
          await f.db
            .select()
            .from(npAgentApprovals)
            .where(eq(npAgentApprovals.id, pending.output.approvalId))
        )[0]!.state,
      ).toBe("approved");
      await noContentEffects(f);
      expect(f.providerInvoke).toHaveBeenCalledTimes(1);
    } finally {
      await f.dispose();
    }
  });
});
