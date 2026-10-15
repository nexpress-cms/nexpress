import { randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import {
  npDigestAgentEventCanonical,
  npRequireAgentEventCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import type {
  NpAgentModeratorSettingsV1,
  NpAgentModeratorSignalCandidateV1,
} from "../../../packages/core/src/agent-contract/moderator-contract.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import {
  createAgentModeratorCollectorV1,
  createAgentModeratorCommentObserverV1,
} from "../../../packages/core/src/agent/moderator-collector.js";
import { createAgentModeratorCombinedCommentCollectorV1 } from "../../../packages/core/src/agent/moderator-combined-collector.js";
import { npResolveAgentModeratorCombinedCommentEvidenceV1 } from "../../../packages/core/src/agent/moderator-comment-evidence.js";
import { npAgentModeratorWindowStartedAtV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import { npModeratorFloodScopeV1 } from "../../../packages/core/src/agent/moderator-flood-collection.js";
import { npPruneAgentModeratorFloodCheckpointsV1 } from "../../../packages/core/src/agent/moderator-flood-retention.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import {
  createAgentModeratorCommentReportCollectorV1,
  createAgentModeratorCommentReportObserverV1,
} from "../../../packages/core/src/agent/moderator-report-source.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import {
  createComment,
  deleteComment,
  updateComment,
} from "../../../packages/core/src/community/comments.js";
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
  npAgentEvents,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments, npReports } from "../../../packages/core/src/db/schema/community.js";
import { npSettings, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
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
  collectionSlugs: ["posts"],
  windowSeconds: 600,
  minIndependentAccounts: 3,
  minItems: 5,
  automaticConfidenceBasisPoints: 9950,
};

async function fixture(config: { duplicates?: boolean; count?: number } = {}) {
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
  const saved = await withCurrentSite(siteId, () =>
    saveDocument(
      "posts",
      null,
      { title: "Mixed campaign", content: npCreateEmptyRichTextContent() },
      user,
      { status: "published" },
    ),
  );
  const members = await Promise.all(
    ["alice", "bravo", "charlie"].map((handle) =>
      seedActiveMember({ handle, email: `${handle}@example.com` }),
    ),
  );
  const reporters = await Promise.all(
    ["reporter-one", "reporter-two", "reporter-three", "reporter-four"].map((handle) =>
      seedActiveMember({ handle, email: `${handle}@example.com` }),
    ),
  );
  const never = () => Promise.reject(new Error("Collection must not dispatch or activate Runtime"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, withCurrentRun: never, withRunAuthority: never, retry: never },
    deploymentAuthority: {
      policyId: "mixed-collector-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: ["site:read"],
    },
    enqueueRun: never,
  });
  const observed = createAgentModeratorCommentObserverV1({ events });
  setCommunityCommentReportObserverV1(createAgentModeratorCommentReportObserverV1({ events }));
  const report = (commentId: string, reporterIndex = 0) =>
    withCurrentSite(siteId, () =>
      fileReport({
        targetType: "comment",
        targetId: commentId,
        reporterId: reporters[reporterIndex].memberId,
        reason: "Unverified private report me@example.test",
      }),
    );
  const comments: Awaited<ReturnType<typeof createComment>>[] = [];
  const reports: Awaited<ReturnType<typeof report>>[] = [];
  let windowStartedAt: string | null = null;
  let observedCount = 0;
  const count = config.count ?? 5;
  // Keep the actual PostgreSQL timestamps and restart the fixture's selection
  // if source writes cross a bucket. No historical evidence is rewritten.
  // A rollover near the end of a large selection needs a whole replacement
  // selection, not merely twenty extra writes. Keep retries explicitly bounded.
  for (let index = 0; comments.length < count && index < count * 3 + 20; index++) {
    resetCommunityModerationObserverV1();
    const reported = observedCount >= count - 2;
    if (!reported) setCommunityModerationObserverV1(observed);
    const comment = await withCurrentSite(siteId, () =>
      createComment({
        targetType: "posts",
        targetId: String(saved.doc.id),
        memberId: members[index % members.length].memberId,
        bodyMd: `Actual campaign ${index} https://offer.example/${index}?private=never-copy`,
      }),
    );
    const claim = reported ? await report(comment.id) : null;
    const bucket = npAgentModeratorWindowStartedAtV1(
      (claim?.createdAt ?? comment.createdAt).toISOString(),
    );
    if (bucket !== windowStartedAt) {
      windowStartedAt = bucket;
      comments.length = 0;
      reports.length = 0;
      observedCount = 0;
    }
    const duplicate =
      config.duplicates &&
      ((!reported && observedCount === 0) || (reported && reports.length === 0))
        ? await report(comment.id, reported ? 1 : 2)
        : null;
    if (
      duplicate &&
      npAgentModeratorWindowStartedAtV1(duplicate.createdAt.toISOString()) !== bucket
    ) {
      await withCurrentSite(siteId, () =>
        deleteComment({ commentId: comment.id, memberId: comment.memberId }),
      );
      windowStartedAt = null;
      comments.length = 0;
      reports.length = 0;
      observedCount = 0;
      continue;
    }
    comments.push(comment);
    if (claim) reports.push(claim);
    else observedCount++;
  }
  if (!windowStartedAt || comments.length !== count || reports.length !== 2)
    throw new Error("Could not prepare one mixed source window");
  const now = () => new Date(Date.parse(windowStartedAt) + 600_001);
  let captured: NpAgentModeratorSignalCandidateV1 | null = null;
  const capturedCandidates: NpAgentModeratorSignalCandidateV1[] = [];
  const incidents = createAgentIncidentWriteServiceV1({
    now,
    resolveEvidence: (input) => {
      captured = structuredClone(input.candidate);
      capturedCandidates.push(structuredClone(input.candidate));
      return npResolveAgentModeratorCombinedCommentEvidenceV1({ ...input, staffUserId: userId });
    },
  });
  const options = { staffUserId: userId, incidents, now };
  const input = { siteId, windowStartedAt, settings };
  return {
    db,
    userId,
    user,
    comments,
    capturedCandidates,
    reports,
    observed,
    report,
    incidents,
    options,
    input,
    collector: createAgentModeratorCombinedCommentCollectorV1(options),
    candidate() {
      if (!captured) throw new Error("Expected a detector candidate");
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

describe.skipIf(skipIfNoTestDb())("Moderator combined actual comment sources", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterEach(() => {
    resetCommunityModerationObserverV1();
    resetCommunityCommentReportObserverV1();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("joins a 3-observation plus 2-report campaign once without counting duplicate targets or reporters", async () => {
    const f = await fixture({ duplicates: true });
    expect(
      (await createAgentModeratorCollectorV1(f.options).collect(f.input)).observations,
    ).toEqual([]);
    expect(
      (await createAgentModeratorCommentReportCollectorV1(f.options).collect(f.input)).observations,
    ).toEqual([]);
    for (const bounded of [
      { ...settings, minItems: 6 },
      { ...settings, minIndependentAccounts: 4 },
    ])
      expect((await f.collector.collect({ ...f.input, settings: bounded })).observations).toEqual(
        [],
      );
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
    const collected = await f.collector.collect(f.input);
    expect(collected.inspectedEvents).toBeGreaterThanOrEqual(7);
    expect(collected.acceptedFacts).toBe(7);
    expect(collected.observations).toHaveLength(1);
    expect(collected.observations[0].disposition).toBe("created");
    const candidate = f.candidate();
    expect(candidate.facts).toHaveLength(5);
    expect(new Set(candidate.facts.map((fact) => fact.memberId)).size).toBe(3);
    const reported = candidate.facts.filter(
      (fact) =>
        fact.evidence.kind === "event" && fact.evidence.eventKind === "community.content.reported",
    );
    expect(reported).toHaveLength(3);
    expect(
      reported.every(
        (fact) => fact.spamVerdict === "unknown" && fact.profanityVerdict === "unknown",
      ),
    ).toBe(true);
    const retained = await stored(f.db);
    const replay = await f.collector.collect(f.input);
    expect(replay.observations[0]).toMatchObject({
      ...collected.observations[0],
      disposition: "replayed",
    });
    expect(await stored(f.db)).toEqual(retained);
    expect(retained.incidents).toHaveLength(1);
    expect(retained.signals).toHaveLength(1);
    expect(retained.timeline).toHaveLength(1);
    expect(await f.db.select().from(npComments).where(eq(npComments.status, "hidden"))).toEqual([]);
    expect(JSON.stringify(retained)).not.toContain("private=never-copy");
    expect(JSON.stringify(retained)).not.toContain("me@example.test");
  });

  it("revalidates every mixed fact against current report state, historical integrity and collection access before replaying a Signal", async () => {
    const f = await fixture();
    await f.collector.collect(f.input);
    const candidate = f.candidate();
    const retained = await stored(f.db);
    const refuse = async () => {
      await expect(f.incidents.observe(candidate)).rejects.toThrow();
      expect(await stored(f.db)).toEqual(retained);
    };
    const report = f.reports[0];
    await f.db
      .update(npReports)
      .set({ reason: "Tampered immutable filing" })
      .where(eq(npReports.id, report.id));
    await refuse();
    await f.db.update(npReports).set({ reason: report.reason }).where(eq(npReports.id, report.id));
    const observedRef = candidate.facts.find(
      (fact) =>
        fact.evidence.kind === "event" && fact.evidence.eventKind === "community.content.created",
    )!;
    if (observedRef.evidence.kind !== "event") throw new Error("Expected observed Event evidence");
    const [event] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, observedRef.evidence.eventId));
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentEvents.id, event.id));
    await refuse();
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: event.eventHash })
      .where(eq(npAgentEvents.id, event.id));
    const collection = getCollectionConfig("posts");
    registerCollection("posts", postsTable, {
      ...collection,
      access: { ...collection.access, read: () => false },
    });
    try {
      await refuse();
    } finally {
      registerTestCollections();
    }
    expect((await f.incidents.observe(candidate)).disposition).toBe("replayed");
    await withCurrentSite(siteId, () =>
      resolveReport({
        reportId: report.id,
        action: "dismiss",
        actor: { kind: "staff", user: f.user },
      }),
    );
    await refuse();
    const current = await f.collector.collect(f.input);
    expect(current.acceptedFacts).toBe(4);
    expect(current.observations).toEqual([]);
    expect(await stored(f.db)).toEqual(retained);
  });

  it("commits a bounded durable page and resumes a 101-source batch without partial Incidents", async () => {
    const f = await fixture();
    const inWindow = and(
      eq(npAgentEvents.siteId, siteId),
      gte(npAgentEvents.occurredAt, new Date(f.input.windowStartedAt)),
      lt(npAgentEvents.occurredAt, new Date(Date.parse(f.input.windowStartedAt) + 600_000)),
    );
    const sources = await f.db.select().from(npAgentEvents).where(inWindow);
    const observed = sources.find((source) => source.kind === "community.content.created")!;
    const reported = sources.find((source) => source.kind === "community.content.reported")!;
    // Capacity-only canonical persistence fixture: these additional rows prove
    // the SQL union bound, and intentionally make no claim of actual filings.
    const extra = await Promise.all(
      Array.from({ length: 96 }, async (_, index) => {
        const source = index < 48 ? observed : reported;
        const deduplicationKey = `capacity.${index}`;
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
    const batch = await f.db.select().from(npAgentEvents).where(inWindow);
    expect(batch).toHaveLength(101);
    expect(batch.filter((event) => event.sourceComponent === "community.comments")).toHaveLength(
      51,
    );
    expect(
      batch.filter((event) => event.sourceComponent === "community.comment-reports"),
    ).toHaveLength(50);
    expect(await f.collector.collect(f.input)).toMatchObject({
      complete: false,
      inspectedEvents: 100,
      observations: [],
    });
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
    expect(await f.db.select().from(npSettings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: expect.stringContaining("agent.moderator.flood.v1:") }),
      ]),
    );
    const resumed = createAgentModeratorCombinedCommentCollectorV1(f.options);
    expect(await resumed.collect(f.input)).toMatchObject({
      complete: false,
      inspectedEvents: 1,
      observations: [],
    });
    let complete = false;
    for (let page = 0; page < 12 && !complete; page++)
      complete = (await resumed.collect(f.input)).complete === true;
    expect(complete).toBe(true);
    expect((await stored(f.db)).incidents).toHaveLength(1);
  });

  it("covers 151 actual mixed targets through late delivery, current replacement, replay and ACL restoration", async () => {
    const f = await fixture({ count: 151 });
    const retainedSources = await f.db.select().from(npAgentEvents);
    const delayed = retainedSources.find(
      (source) =>
        source.subject?.kind === "comment" && source.subject.commentId === f.comments[0].id,
    )!;
    // Delay delivery of one actual owner-created immutable source. Restore its
    // exact bytes later, with an occurredAt behind the already processed page.
    await f.db.delete(npAgentEvents).where(eq(npAgentEvents.id, delayed.id));
    expect(await f.collector.collect(f.input)).toMatchObject({
      complete: false,
      inspectedEvents: 100,
      observations: [],
    });
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
    const resumed = createAgentModeratorCombinedCommentCollectorV1(f.options);
    expect(await resumed.collect(f.input)).toMatchObject({ complete: false, inspectedEvents: 50 });
    await f.db.insert(npAgentEvents).values(delayed);
    expect(await resumed.collect(f.input)).toMatchObject({ complete: false, inspectedEvents: 1 });
    // A real owner edit replaces an earlier page's source when its source time
    // remains in this bucket. A later bucket belongs to its own collection.
    setCommunityModerationObserverV1(f.observed);
    const edited = await withCurrentSite(siteId, () =>
      updateComment({
        commentId: f.comments[0].id,
        memberId: f.comments[0].memberId,
        bodyMd: "Updated actual campaign https://offer.example/current",
      }),
    );
    const editBucket = npAgentModeratorWindowStartedAtV1(edited.editedAt!.toISOString());
    const assertEditCollection = async (comment: typeof edited) => {
      const bucket = npAgentModeratorWindowStartedAtV1(comment.editedAt!.toISOString());
      expect(await resumed.collect(f.input)).toMatchObject({
        complete: false,
        inspectedEvents: bucket === f.input.windowStartedAt ? 1 : 0,
      });
      if (bucket !== f.input.windowStartedAt) {
        const closedNow = () => new Date(Date.parse(bucket) + 600_001);
        const nextWindow = createAgentModeratorCombinedCommentCollectorV1({
          ...f.options,
          now: closedNow,
          incidents: createAgentIncidentWriteServiceV1({
            now: closedNow,
            resolveEvidence: (input) =>
              npResolveAgentModeratorCombinedCommentEvidenceV1({
                ...input,
                staffUserId: f.userId,
              }),
          }),
        });
        const next = await nextWindow.collect({ ...f.input, windowStartedAt: bucket });
        expect(next.complete).not.toBe(false);
        expect(next.inspectedEvents).toBeGreaterThan(0);
        expect(next.acceptedFacts).toBe(1);
        expect(next.observations).toEqual([]);
      }
    };
    await assertEditCollection(edited);
    let complete = false;
    for (let page = 0; page < 20 && !complete; page++)
      complete = (await resumed.collect(f.input)).complete === true;
    expect(complete).toBe(true);
    const covered = new Set(
      f.capturedCandidates.flatMap((candidate) =>
        candidate.facts.map((fact) =>
          fact.subject.kind === "comment" ? fact.subject.commentId : fact.subject.documentId,
        ),
      ),
    );
    expect(covered).toEqual(
      new Set(
        f.comments
          .filter((comment) => editBucket === f.input.windowStartedAt || comment.id !== edited.id)
          .map((comment) => comment.id),
      ),
    );
    expect(
      f.capturedCandidates.every(
        (candidate) => candidate.facts.length <= 100 && candidate.advisory,
      ),
    ).toBe(true);
    const editedFacts = f.capturedCandidates
      .flatMap((candidate) => candidate.facts)
      .filter((fact) => fact.subject.kind === "comment" && fact.subject.commentId === edited.id);
    if (editBucket === f.input.windowStartedAt) {
      expect(editedFacts.length).toBeGreaterThan(0);
      expect(editedFacts.every((fact) => fact.observedAt === edited.editedAt!.toISOString())).toBe(
        true,
      );
    } else expect(editedFacts).toEqual([]);
    const retained = await stored(f.db);
    expect(retained.incidents).toHaveLength(1);
    expect(retained.signals.length).toBeGreaterThan(1);
    expect(await resumed.collect(f.input)).toMatchObject({
      complete: false,
      inspectedEvents: 0,
      observations: [],
    });
    complete = false;
    for (let page = 0; page < 20 && !complete; page++)
      complete = (await resumed.collect(f.input)).complete === true;
    expect(complete).toBe(true);
    expect(await stored(f.db)).toEqual(retained);
    // A new source after complete cannot be permanently hidden by its checkpoint.
    const late = await withCurrentSite(siteId, () =>
      updateComment({
        commentId: edited.id,
        memberId: edited.memberId,
        bodyMd: "Another actual edit https://offer.example/latest",
      }),
    );
    await assertEditCollection(late);
    const beforeLate = f.capturedCandidates.length;
    complete = false;
    for (let page = 0; page < 20 && !complete; page++)
      complete = (await resumed.collect(f.input)).complete === true;
    expect(complete).toBe(true);
    const lateFacts = f.capturedCandidates
      .slice(beforeLate)
      .flatMap((candidate) => candidate.facts)
      .filter((fact) => fact.subject.kind === "comment" && fact.subject.commentId === late.id);
    if (
      npAgentModeratorWindowStartedAtV1(late.editedAt!.toISOString()) === f.input.windowStartedAt
    ) {
      expect(lateFacts.length).toBeGreaterThan(0);
      expect(lateFacts.every((fact) => fact.observedAt === late.editedAt!.toISOString())).toBe(
        true,
      );
    } else expect(lateFacts).toEqual([]);
    // Temporary collection ACL loss cannot turn an old completed attempt into
    // permanent cached authority, or permanently hide sources after restoration.
    const collection = getCollectionConfig("posts");
    registerCollection("posts", postsTable, {
      ...collection,
      access: { ...collection.access, read: () => false },
    });
    const beforeDenied = f.capturedCandidates.length;
    try {
      complete = false;
      for (let page = 0; page < 20 && !complete; page++)
        complete = (await resumed.collect(f.input)).complete === true;
      expect(complete).toBe(true);
      expect(f.capturedCandidates).toHaveLength(beforeDenied);
    } finally {
      registerTestCollections();
    }
    complete = false;
    for (let page = 0; page < 20 && !complete; page++)
      complete = (await resumed.collect(f.input)).complete === true;
    expect(complete).toBe(true);
    expect(f.capturedCandidates.length).toBeGreaterThan(beforeDenied);
    const activeSettings = { ...settings, minItems: 6 };
    expect(await resumed.collect({ ...f.input, settings: activeSettings })).toMatchObject({
      complete: false,
    });
    const prefix = npModeratorFloodScopeV1({
      ...f.input,
      staffUserId: f.userId,
      includeDocuments: false,
    });
    const activePrefix = npModeratorFloodScopeV1({
      ...f.input,
      settings: activeSettings,
      staffUserId: f.userId,
      includeDocuments: false,
    });
    const activeRows = () =>
      f.db
        .select()
        .from(npSettings)
        .where(and(gte(npSettings.key, activePrefix), lt(npSettings.key, `${activePrefix}\uffff`)));
    const beforeActive = await activeRows();
    const beforeEvents = await f.db.select().from(npAgentEvents);
    let deletedMetadata = 0;
    for (let page = 0; page < 100; page++) {
      const result = await npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
        npPruneAgentModeratorFloodCheckpointsV1({
          db,
          siteId,
          now: new Date(Date.parse(f.input.windowStartedAt) + 600_000 + 90 * 86_400_000),
          signalDays: 90,
          limit: 25,
          maximumRows: 100,
          beforeStatement: () => Promise.resolve(),
        }),
      );
      expect(result.pruned).toBeLessThanOrEqual(100);
      deletedMetadata += result.pruned;
      if (!result.pruned) break;
    }
    expect(deletedMetadata).toBeGreaterThan(151);
    const [expired] = await f.db
      .select()
      .from(npSettings)
      .where(eq(npSettings.key, `${prefix}state`));
    expect(expired.value).toMatchObject({ phase: "expired", cleanupComplete: true });
    expect(
      await f.db
        .select()
        .from(npSettings)
        .where(and(gte(npSettings.key, prefix), lt(npSettings.key, `${prefix}\uffff`))),
    ).toHaveLength(1);
    expect(await activeRows()).toEqual(beforeActive);
    expect(await f.db.select().from(npAgentEvents)).toEqual(beforeEvents);
    await expect(resumed.collect(f.input)).rejects.toMatchObject({
      code: "MODERATOR_SOURCE_EXPIRED",
    });
    expect(await f.db.select().from(npComments).where(eq(npComments.status, "hidden"))).toEqual([]);
  }, 90_000);

  it("filters unselected collection sources before the bounded fast-path inventory", async () => {
    const f = await fixture();
    const [source] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.sourceComponent, "community.comments"))
      .limit(1);
    // Out-of-scope envelope rows must not reach source validation or capacity.
    const unrelated = Array.from({ length: 120 }, (_, n) => ({
      ...source,
      id: randomUUID(),
      subject: { ...source.subject!, collection: "unselected" },
      deduplicationKey: `unselected.${n}`,
    }));
    await f.db.insert(npAgentEvents).values(unrelated);
    const result = await f.collector.collect(f.input);
    expect(result.inspectedEvents).toBe(5);
    expect(result.observations).toHaveLength(1);
    expect(result.complete).not.toBe(false);
  });

  it("rolls back the real Signal and Incident when staff authority changes before the collection transaction commits", async () => {
    const f = await fixture();
    const retainedEvents = await f.db.select().from(npAgentEvents);
    let observed = false;
    const collector = createAgentModeratorCombinedCommentCollectorV1({
      ...f.options,
      incidents: {
        ...f.incidents,
        async observe(candidate, supplied) {
          if (!supplied?.transaction) throw new Error("Expected collector transaction");
          const result = await f.incidents.observe(candidate, supplied);
          expect(await supplied.transaction.select().from(npAgentSignals)).toHaveLength(1);
          expect(await supplied.transaction.select().from(npAgentIncidents)).toHaveLength(1);
          observed = true;
          await supplied.transaction
            .update(npUsers)
            .set({ role: "viewer" })
            .where(eq(npUsers.id, f.userId));
          return result;
        },
      },
    });
    await expect(collector.collect(f.input)).rejects.toThrow();
    expect(observed).toBe(true);
    expect(await stored(f.db)).toEqual({ incidents: [], signals: [], timeline: [] });
    const [staff] = await f.db.select().from(npUsers).where(eq(npUsers.id, f.userId));
    expect(staff.role).toBe("admin");
    expect(await f.db.select().from(npAgentEvents)).toEqual(retainedEvents);
  });
});
