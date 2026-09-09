import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import {
  createSite,
  grantSiteMembership,
  npUsers,
  npSessions,
  npAuditEvents,
} from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentChangeSetServiceV1 } from "../../../packages/core/src/agent/changeset-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npBuildAgentChangeSetDraftInputJsonV1,
  npDigestAgentChangeSetDraftInputV1,
} from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentChangesets,
  npAgentChangesetValidationAttempts,
  npAgentInvocations,
} from "../../../packages/core/src/db/schema/agent.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npInspectAgentSiteDeletionRows,
  npDeleteAgentSiteRows,
} from "../../../packages/core/src/agent/site-deletion.js";
// eslint-disable-next-line import-x/no-relative-packages
import type { NpAgentInvocationAuthorityRefV1 } from "../../../packages/core/src/agent-contract/types.js";
import {
  ensureMigrated,
  closeTestDb,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  registerTestCollections,
} from "./harness.js";
const siteId = "validation-persistence";
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
async function fixture() {
  const db = await getTestDb();
  const user = await seedUser({ role: "admin" });
  await createSite({ id: siteId, name: "Validation" });
  await createSite({ id: "validation-other", name: "Other" });
  await grantSiteMembership(siteId, user.userId, "admin");
  const [staff] = await db.select().from(npUsers).where(eq(npUsers.id, user.userId));
  const [session] = await db.select().from(npSessions).where(eq(npSessions.userId, user.userId));
  const proposal = {
    title: "Draft",
    summary: null,
    operations: [
      {
        kind: "document" as const,
        operation: "create" as const,
        clientOperationId: "post-1",
        reason: null,
        resource: { collection: "posts", documentId: null },
        base: null,
        input: {
          document: { title: "Post", content: npCreateEmptyRichTextContent() },
          targetStatus: "draft" as const,
        },
      },
    ],
  };
  const service = createAgentChangeSetServiceV1({
    cursorKey: new Uint8Array(32).fill(37),
    reauthentication: { verify: () => true },
  });
  const changeset = await service.create({
    actor: { kind: "staff", siteId, actor: { user: staff!, sessionId: session!.id } },
    command: {
      idempotencyKey: randomUUID(),
      proposalJson: npBuildAgentChangeSetDraftInputJsonV1(proposal),
      proposalHash: await npDigestAgentChangeSetDraftInputV1(proposal),
    },
  });
  const [invocation] = await db
    .select()
    .from(npAgentInvocations)
    .where(
      and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.resultId, changeset.id)),
    );
  const createdAt = new Date();
  const attempt: typeof npAgentChangesetValidationAttempts.$inferInsert = {
    id: randomUUID(),
    siteId,
    changesetId: changeset.id,
    generation: 1,
    draftVersion: changeset.draftVersion,
    draftHash: changeset.draftHash,
    admittingInvocationId: invocation!.id,
    authorizationContextBody: invocation!.authorizationContextBody,
    authorizationContextFingerprint: invocation!.authorizationContextFingerprint,
    authorityRef: invocation!.authorityRef as unknown as NpAgentInvocationAuthorityRefV1,
    requesterKind: "staff",
    requesterId: user.userId,
    requesterFingerprint: invocation!.actorFingerprint,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 3600_000),
  };
  return { db, user, changeset, attempt };
}
describe.skipIf(skipIfNoTestDb())("ChangeSet validation attempt persistence", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("persists requester-bound generations and rejects same-site or duplicate admission violations", async () => {
    const f = await fixture();
    await f.db.insert(npAgentChangesetValidationAttempts).values(f.attempt);
    const [row] = await f.db.select().from(npAgentChangesetValidationAttempts);
    expect(row!.state).toBe("queued");
    expect(row!.authorityRef).toEqual(f.attempt.authorityRef);
    expect(row!.issues).toEqual([]);
    for (const override of [
      { id: randomUUID() },
      { id: randomUUID(), generation: 2 },
      { id: randomUUID(), siteId: "validation-other" },
    ]) {
      await expect(
        f.db.insert(npAgentChangesetValidationAttempts).values({ ...f.attempt, ...override }),
      ).rejects.toThrow();
    }
    await expect(
      f.db
        .delete(npAgentInvocations)
        .where(eq(npAgentInvocations.id, f.attempt.admittingInvocationId)),
    ).rejects.toThrow();
    await expect(
      f.db.delete(npAgentChangesets).where(eq(npAgentChangesets.id, f.changeset.id)),
    ).rejects.toThrow();
  });
  it("closes authority JSON NULL holes, requester substitutions and bounded evidence", async () => {
    const f = await fixture();
    const hostile = [
      { authorizationContextBody: {} },
      { authorityRef: {} },
      { requesterId: randomUUID() },
      { requesterKind: "runtime" },
      { requesterFingerprint: digest },
      { draftHash: "raw" },
      { generation: 0 },
      { draftVersion: 0 },
      { issues: {} },
      { issues: Array.from({ length: 1001 }, () => ({ code: "BOUNDED" })) },
      { expiresAt: new Date(f.attempt.createdAt!.getTime() + 59_000) },
      { expiresAt: new Date(f.attempt.createdAt!.getTime() + 86_400_001) },
    ];
    for (const override of hostile)
      await expect(
        f.db
          .insert(npAgentChangesetValidationAttempts)
          .values({ ...f.attempt, ...override } as typeof f.attempt),
      ).rejects.toThrow();
  });
  it("enforces active and terminal matrices without inventing risk on invalid or authority loss", async () => {
    const f = await fixture();
    await f.db.insert(npAgentChangesetValidationAttempts).values(f.attempt);
    const update = (value: Partial<typeof npAgentChangesetValidationAttempts.$inferInsert>) =>
      f.db
        .update(npAgentChangesetValidationAttempts)
        .set(value)
        .where(eq(npAgentChangesetValidationAttempts.id, f.attempt.id!));
    await expect(update({ state: "ready" })).rejects.toThrow();
    await expect(update({ state: "validating" })).rejects.toThrow();
    const startedAt = new Date();
    await update({ state: "validating", startedAt });
    await expect(update({ state: "failed", finishedAt: new Date() })).rejects.toThrow();
    await update({ state: "invalid", finishedAt: new Date(), resultDigest: digest });
    const [invalid] = await f.db.select().from(npAgentChangesetValidationAttempts);
    expect(invalid!.riskSummary).toBeNull();
    await update({ state: "failed", errorCode: "AUTHORITY_REVOKED", resultDigest: null });
    await expect(update({ errorCode: "Internal error / private details" })).rejects.toThrow();
  });
  it("contains deleted requester authority while retaining immutable attribution", async () => {
    const f = await fixture();
    await f.db.insert(npAgentChangesetValidationAttempts).values(f.attempt);
    await f.db
      .update(npAgentChangesets)
      .set({ state: "validating", validationGeneration: 1 })
      .where(eq(npAgentChangesets.id, f.changeset.id));
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: { active: { id: "contain", key: new Uint8Array(32).fill(38) } },
    });
    await gateway.containUserAuthorityLoss(f.user.userId);
    const [attempt] = await f.db.select().from(npAgentChangesetValidationAttempts);
    const [parent] = await f.db.select().from(npAgentChangesets);
    expect(attempt).toMatchObject({
      state: "failed",
      errorCode: "AUTHORITY_REVOKED",
      requesterId: f.user.userId,
      authorityRef: f.attempt.authorityRef,
    });
    expect(parent!.state).toBe("invalid");
    // Generic audit retention is separate from Agent containment. Prepare its nullable attribution.
    await f.db
      .update(npAuditEvents)
      .set({ actorUserId: null })
      .where(eq(npAuditEvents.actorUserId, f.user.userId));
    await f.db.delete(npUsers).where(eq(npUsers.id, f.user.userId));
    expect((await f.db.select().from(npAgentChangesetValidationAttempts))[0]!.requesterId).toBe(
      f.user.userId,
    );
  });
  it("does not overwrite a newer parent generation during requester containment", async () => {
    const f = await fixture();
    await f.db.insert(npAgentChangesetValidationAttempts).values(f.attempt);
    await f.db
      .update(npAgentChangesets)
      .set({ state: "validating", validationGeneration: 2, draftVersion: 2 })
      .where(eq(npAgentChangesets.id, f.changeset.id));
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: { active: { id: "contain", key: new Uint8Array(32).fill(38) } },
    });
    await gateway.containUserAuthorityLoss(f.user.userId);
    expect((await f.db.select().from(npAgentChangesetValidationAttempts))[0]!.state).toBe("failed");
    expect((await f.db.select().from(npAgentChangesets))[0]).toMatchObject({
      state: "validating",
      validationGeneration: 2,
      draftVersion: 2,
    });
  });
  it("includes attempts in health and ordered site cleanup without exposing authority evidence", async () => {
    const f = await fixture();
    await f.db.insert(npAgentChangesetValidationAttempts).values(f.attempt);
    const health = await npCollectAgentHealthSummaryV1();
    expect(JSON.stringify(health)).not.toContain(f.attempt.requesterId);
    expect(JSON.stringify(health)).not.toContain(f.attempt.authorizationContextFingerprint);
    await f.db
      .update(npAgentChangesetValidationAttempts)
      .set({ authorizationContextFingerprint: digest })
      .where(eq(npAgentChangesetValidationAttempts.id, f.attempt.id!));
    const drift = await npCollectAgentHealthSummaryV1();
    expect(drift.issues.some((issue) => issue.code === "AGENT_ROW_STATE_INVALID")).toBe(true);
    const inventory = await npInspectAgentSiteDeletionRows(f.db, siteId);
    expect(inventory).toHaveLength(28);
    expect(inventory.some((row) => row.table === "np_agent_changeset_validation_attempts")).toBe(
      true,
    );
    await npDeleteAgentSiteRows(f.db, siteId);
    expect(await f.db.select().from(npAgentChangesetValidationAttempts)).toEqual([]);
  });
});
