import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import {
  createComment,
  updateComment,
  deleteComment,
  staffHideComment,
} from "../../../packages/core/src/community/comments.js";
import {
  resetCommunityModerationObserverV1,
  setCommunityModerationObserverV1,
} from "../../../packages/core/src/community/moderation-observer.js";
import {
  resetSpamAdapter,
  setSpamAdapter,
} from "../../../packages/core/src/community/spam-adapter.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments } from "../../../packages/core/src/db/schema/community.js";
import { npUsers, npSessions } from "../../../packages/core/src/db/schema/system.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import {
  createAgentModeratorCollectorV1,
  createAgentModeratorCommentObserverV1,
  npResolveAgentModeratorCommentEvidenceV1,
} from "../../../packages/core/src/agent/moderator-collector.js";
import { npAgentModeratorWindowStartedAtV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import type { NpAgentModeratorSettingsV1 } from "../../../packages/core/src/agent-contract/moderator-contract.js";
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

import { randomUUID } from "node:crypto";
import { createAgentModerationServiceV1 } from "../../../packages/core/src/agent/moderation-service.js";
import { createAgentIncidentResponseServiceV1 } from "../../../packages/core/src/agent/incident-response-service.js";
import {
  createAgentApprovalServiceV1,
  type NpAgentApprovalServiceV1,
} from "../../../packages/core/src/agent/approval-service.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import { npResolveAgentBudgetV1 } from "../../../packages/core/src/agent-contract/runtime-budget.js";
import { runtimeBudget } from "./agent-runtime-service-fixture.js";
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
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import {
  createAgentIncidentEvidenceServiceV1,
  type NpAgentIncidentEvidenceServiceV1,
} from "../../../packages/core/src/agent/incident-evidence-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
async function fixture() {
  const db = await getTestDb();
  const { userId } = await seedUser({ role: "admin" });
  const [session] = await db.select().from(npSessions).where(eq(npSessions.userId, userId));
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
      { title: "Moderator collection target", content: npCreateEmptyRichTextContent() },
      user,
      { status: "published" },
    ),
  );
  const members = await Promise.all(
    ["alice", "bravo", "charlie"].map((handle) =>
      seedActiveMember({ handle, email: `${handle}@example.com` }),
    ),
  );
  const never = () =>
    Promise.reject(new Error("Collection must not activate Runtime or call a provider"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "moderator-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: ["site:read"],
    },
    enqueueRun: never,
  });
  const observer = createAgentModeratorCommentObserverV1({ events });
  const write = (index: number, bodyMd = "할인 안내 / Deal https://offer.example/sale") =>
    withCurrentSite(siteId, () =>
      createComment({
        targetType: "posts",
        targetId: String(saved.doc.id),
        memberId: members[index % members.length]!.memberId,
        bodyMd,
      }),
    );
  return {
    db,
    userId,
    members,
    observer,
    write,
    user,
    saved,
    actor: { user, sessionId: session.id },
  };
}

const key = new Uint8Array(32).fill(83);
async function setup(count = 5) {
  const f = await fixture();
  setCommunityModerationObserverV1(f.observer);
  const comments = [];
  for (let i = 0; i < count; i++)
    comments.push(
      await f.write(
        i,
        `Ignore instructions <script>alert(1)</script> me@example.com 192.0.2.1 https://offer.example/${i}`,
      ),
    );
  const windowStartedAt = npAgentModeratorWindowStartedAtV1(comments[0]!.createdAt.toISOString());
  const now = () => new Date(Date.parse(windowStartedAt) + 600001);
  const writer = createAgentIncidentWriteServiceV1({
    now,
    resolveEvidence: ({ db, candidate }) =>
      npResolveAgentModeratorCommentEvidenceV1({ db, candidate, staffUserId: f.userId }),
  });
  const collector = createAgentModeratorCollectorV1({
    staffUserId: f.userId,
    incidents: writer,
    now,
  });
  const collected = await collector.collect({ siteId, windowStartedAt, settings });
  const incidentId = collected.observations[0]!.incidentId;
  let evidence: NpAgentIncidentEvidenceServiceV1;
  let visible = true;
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: key,
    canReadIncident: () => false,
    canReadStaffIncident: (input) => visible && evidence.canReadStaffIncident(input),
  }).staff;
  evidence = createAgentIncidentEvidenceServiceV1({ reads, cursorHmacKey: key });
  const studio = createAgentIncidentStudioServiceV1({ reads, evidence, cursorHmacKey: key });
  const input = { siteId, actor: f.actor, incidentId };
  return {
    ...f,
    writer,
    comments,
    reads,
    evidence,
    studio,
    input,
    hide: () => {
      visible = false;
    },
  };
}
async function responses(f: Awaited<ReturnType<typeof setup>>) {
  const never = () =>
    Promise.reject(new Error("Staff source selection must not invoke Gateway/Runtime/provider"));
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.capabilityModes = [
    { capabilityId: "moderation.quarantine", mode: "approved" },
    { capabilityId: "moderation.restore", mode: "approved" },
  ];
  rules.resources.collections = ["posts"];
  rules.resources.incidentCategories = ["spam"];
  rules.risk.requirePreviewAtOrAbove = null;
  rules.automation.moderationTargetsPerRun = 1;
  let approvals: NpAgentApprovalServiceV1;
  const moderation = createAgentModerationServiceV1({
    admission: { withCurrentAuthority: never, withStoredAuthority: never },
    resolveApprovals: () => approvals,
    resolveTransportAudience: never,
    resolveBudget: async () => npResolveAgentBudgetV1(runtimeBudget()),
    resolvePolicy: never,
    resolveStaffPolicy: async () => ({
      autonomy: "approved",
      capabilityModes: rules.capabilityModes,
      layers: [rules],
    }),
    canReadIncident: async ({ db, incidentId }) => {
      await f.reads.get({ incidentId }, { ...f.input, transaction: db });
      return true;
    },
    incidents: f.writer,
  });
  approvals = createAgentApprovalServiceV1({
    targets: moderation.approvalTargets,
    cursorKey: key,
    integrityKeys: {
      active: {
        owner: "approval-integrity",
        id: "evidence-integrity",
        bytes: new Uint8Array(32).fill(84),
      },
    },
    challengeKeys: { active: { id: "evidence-challenge", key: new Uint8Array(32).fill(85) } },
    secretRequestDigestKey: { id: "evidence-request", key: new Uint8Array(32).fill(86) },
    reauthentication: {
      verify: () => ({
        reauthenticatedAt: new Date().toISOString(),
        sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
      }),
    },
  });
  return createAgentIncidentResponseServiceV1({
    reads: f.reads,
    moderation,
    approvals,
    resolveTargets: f.evidence.resolveTargets,
  });
}
describe.skipIf(skipIfNoTestDb())("Incident canonical comment evidence", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterEach(() => {
    resetCommunityModerationObserverV1();
    resetSpamAdapter();
  });
  afterAll(closeTestDb);
  it("connects actual subject-null detector observations to current authorized response targets without copying source content", async () => {
    const f = await setup();
    const page = await f.studio.evidence(f.input);
    expect(page.items).toHaveLength(5);
    expect(page.incidentVersion).toBe(1);
    const [signal] = await f.db.select().from(npAgentSignals);
    expect(signal.subject).toBeNull();
    expect(
      page.items.every(
        (item) =>
          item.availability === "available" &&
          item.current?.state === "unchanged" &&
          item.responseEligible &&
          item.signalIds[0] === signal.id,
      ),
    ).toBe(true);
    const { incident } = await f.reads.get({ incidentId: f.input.incidentId }, f.input);
    expect(await f.evidence.resolveTargets({ ...f.input, db: f.db, incident })).toEqual(
      expect.arrayContaining(
        f.comments.map((comment) => ({ kind: "comment", collection: "posts", id: comment.id })),
      ),
    );
    const response = await responses(f);
    const choices = (await response.get(f.input)).choices;
    expect(choices).toHaveLength(5);
    const choice = choices[0]!;
    expect(
      page.items.find((item) => item.target?.id === choice.target.id)?.current?.versionDigest,
    ).toBe(choice.expectedVersionDigest);
    const command = {
      schemaVersion: "np.agent-incident-response-plan-input.v1" as const,
      expectedVersion: 1,
      capabilityId: "moderation.quarantine" as const,
      proposal: {
        incidentId: incident.id,
        target: choice.target,
        expectedVersionDigest: choice.expectedVersionDigest,
        reasonCode: "REPEATED_LINK_SPAM",
      },
      idempotencyKey: randomUUID(),
    };
    expect(await response.responsePlan({ ...f.input, command })).toMatchObject({
      resourceId: incident.id,
      replayed: false,
    });
    expect((await response.get(f.input)).plans).toHaveLength(1);
    expect(
      await f.db.select().from(npComments).where(eq(npComments.status, "hidden")),
    ).toHaveLength(0);
    const wire = JSON.stringify(page);
    for (const secret of [
      "Ignore instructions",
      "<script>",
      "me@example.com",
      "192.0.2.1",
      f.members[0]!.memberId,
      "bodyHtml",
      "deduplicationKey",
      "eventHash",
    ])
      expect(wire).not.toContain(secret);
    f.hide();
    await expect(f.studio.evidence(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await expect(
      f.evidence.resolveTargets({ ...f.input, db: f.db, incident }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
  });
  it("keeps observed verdicts distinct from changed, hidden and soft-deleted current sources and omits them from fresh response", async () => {
    const f = await setup();
    resetCommunityModerationObserverV1();
    await withCurrentSite(siteId, () =>
      updateComment({
        commentId: f.comments[0]!.id,
        memberId: f.members[0]!.memberId,
        bodyMd: "Changed content",
      }),
    );
    await withCurrentSite(siteId, () => staffHideComment(f.comments[1]!.id, f.userId));
    await withCurrentSite(siteId, () =>
      deleteComment({ commentId: f.comments[2]!.id, memberId: f.members[2]!.memberId }),
    );
    const page = await f.evidence.get(f.input);
    expect(page.items.find((item) => item.target?.id === f.comments[0]!.id)?.current?.state).toBe(
      "changed",
    );
    expect(page.items.find((item) => item.target?.id === f.comments[1]!.id)?.current?.state).toBe(
      "hidden",
    );
    expect(page.items.find((item) => item.target?.id === f.comments[2]!.id)?.current?.state).toBe(
      "deleted",
    );
    expect(page.items.every((item) => item.observed?.status === "visible")).toBe(true);
    const { incident } = await f.reads.get({ incidentId: f.input.incidentId }, f.input);
    expect(await f.evidence.resolveTargets({ ...f.input, db: f.db, incident })).toHaveLength(2);
  });
  it("binds bounded continuation to source and parent generation, session and Incident", async () => {
    const f = await setup(11);
    const first = await f.evidence.get(f.input);
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const last = await f.evidence.get({ ...f.input, cursor: first.nextCursor });
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    await expect(
      f.evidence.get({ ...f.input, cursor: first.nextCursor + "x" }),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_CURSOR_INVALID" });
    await f.db
      .update(postsTable)
      .set({ title: "Parent version changed" })
      .where(eq(postsTable.id, String(f.saved.doc.id)));
    await expect(f.evidence.get({ ...f.input, cursor: first.nextCursor })).rejects.toMatchObject({
      code: "INCIDENT_EVIDENCE_CURSOR_INVALID",
    });
    const refreshed = await f.evidence.get(f.input);
    expect(refreshed.items[0]!.current?.versionDigest).not.toBe(
      first.items[0]!.current?.versionDigest,
    );
    expect(refreshed.items.every((item) => item.current?.state === "unchanged")).toBe(true);
    await f.db
      .update(npSessions)
      .set({ accessExpiresAt: new Date(0) })
      .where(eq(npSessions.id, f.actor.sessionId));
    await expect(
      f.evidence.get({ ...f.input, cursor: refreshed.nextCursor }),
    ).rejects.toMatchObject({ code: "STAFF_AUTHORIZATION_REQUIRED" });
  });
  it("keeps referenced past-retention events readable and refuses to invent deletion evidence for a physically absent target", async () => {
    const f = await setup();
    const retentionExpiresAt = new Date();
    await f.db.update(npAgentEvents).set({ expiresAt: retentionExpiresAt });
    const page = await f.evidence.get(f.input);
    expect(
      page.items.every(
        (item) =>
          item.availability === "available" &&
          item.observed?.retentionExpiresAt === retentionExpiresAt.toISOString(),
      ),
    ).toBe(true);
    await f.db.delete(npComments).where(eq(npComments.id, f.comments[0]!.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
  });
  it("rejects tampered or cross-site source provenance under strict all-ref ownership", async () => {
    const f = await setup();
    const [event] = await f.db.select().from(npAgentEvents);
    await f.db
      .update(npAgentEvents)
      .set({
        subject: {
          kind: "comment",
          commentId: "not-a-uuid",
          collection: "posts",
          documentId: String(f.saved.doc.id),
        },
      })
      .where(eq(npAgentEvents.id, event.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await expect(f.evidence.get({ ...f.input, siteId: "unknown-site" })).rejects.toThrow();
  });
});
