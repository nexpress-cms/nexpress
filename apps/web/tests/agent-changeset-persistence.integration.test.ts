import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { createSite, deleteSite, npUsers } from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentApprovals,
} from "../../../packages/core/src/db/schema/agent.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npInspectAgentSiteDeletionRows } from "../../../packages/core/src/agent/site-deletion.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
// eslint-disable-next-line import-x/no-relative-packages
import type { NpAgentChangeSetPlanCanonicalV1 } from "../../../packages/core/src/agent-contract/types.js";
import {
  ensureMigrated,
  closeTestDb,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const later = () => new Date(Date.now() + 86_400_000);
async function fixture() {
  const db = await getTestDb();
  const user = await seedUser({ role: "admin" });
  await createSite({ id: "changeset-a", name: "Changeset A" });
  await createSite({ id: "changeset-b", name: "Changeset B" });
  return { db, user };
}
function draft(userId: string, id = randomUUID(), siteId = "changeset-a") {
  return {
    id,
    siteId,
    creatorKind: "staff",
    createdByUserId: userId,
    actorFingerprint: digest,
    sourceOperationId: "agents.changesets.create",
    sourceInputHash: digest,
    sourceIdempotencyFingerprint: digest,
    title: "Draft",
    draftHash: digest,
    expiresAt: later(),
  };
}
function operation(changesetId: string, id = randomUUID(), siteId = "changeset-a") {
  const documentId = randomUUID();
  return {
    id,
    siteId,
    changesetId,
    ordinal: 1,
    clientOperationId: "create-1",
    resourceKind: "document",
    resourceKey: { kind: "document" as const, collection: "posts", documentId },
    operation: "create",
    input: {
      kind: "document" as const,
      operation: "create" as const,
      clientOperationId: "create-1",
      reason: null,
      resource: { collection: "posts", documentId: null },
      base: null,
      input: { document: { title: "Stored private draft" }, targetStatus: "draft" as const },
    },
  };
}
function approval(changeSetId: string, userId: string, id = randomUUID(), siteId = "changeset-a") {
  const requestedAt = new Date();
  const expiresAt = later();
  return {
    id,
    siteId,
    targetKind: "changeset",
    targetId: changeSetId,
    targetChangesetId: changeSetId,
    generation: 1,
    planHash: digest,
    capabilityId: "changeset.apply",
    capabilityContractVersion: 1,
    capabilityFingerprint: digest,
    requiredScopes: ["changeset:apply" as const],
    requiredHumanCapabilities: ["content.publish"],
    requiredHumanPredicates: [],
    policyHashes: [digest],
    requiresLivePreview: false,
    requiredReauthMode: "none",
    statementBody: {
      version: "np.agent-approval-statement.v1" as const,
      siteId,
      approvalId: id,
      requester: { kind: "staff" as const, userId, fingerprint: digest },
      target: { kind: "changeset" as const, changeSetId, planHash: digest },
      capabilityId: "changeset.apply" as const,
      capabilityContractVersion: 1,
      capabilityFingerprint: digest,
      requiredScopes: ["changeset:apply" as const],
      requiredHumanCapabilities: ["content.publish" as const],
      requiredHumanPredicates: [],
      policyHashes: [digest],
      requiresLivePreview: false,
      previewId: null,
      previewDigest: null,
      risk: "reversible" as const,
      reauthentication: { mode: "none" as const },
      createdAt: requestedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    statementHash: digest,
    statementMac: "fixture-integrity-mac",
    integrityKeyId: "fixture-approval-key",
    state: "pending",
    risk: "reversible",
    requesterKind: "staff",
    requestedByUserId: userId,
    requesterFingerprint: digest,
    requestedAt,
    expiresAt,
  };
}
describe.skipIf(skipIfNoTestDb())("ChangeSet persistence foundation", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  afterEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });
  it("enforces site ownership, durable source uniqueness and one draft CAS version", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    const [stored] = await db.select().from(npAgentChangesets);
    expect(stored?.draftVersion).toBe(1);
    expect(stored?.validationGeneration).toBe(0);
    expect(stored?.sealedPlanBody).toBeNull();
    await expect(
      db.insert(npAgentChangesets).values({ ...row, id: randomUUID() }),
    ).rejects.toThrow();
    await db.insert(npAgentChangesets).values(draft(user.userId, randomUUID(), "changeset-b"));
    for (const patch of [
      { draftVersion: 0 },
      { validationGeneration: -1 },
      { creatorKind: "external" },
      { createdByUserId: null },
      { state: "expired" },
      { planHash: digest },
    ])
      await expect(
        db.update(npAgentChangesets).set(patch).where(eq(npAgentChangesets.id, row.id)),
      ).rejects.toThrow();
    await db.insert(npAgentChangesetOperations).values(operation(row.id));
    await expect(
      db.insert(npAgentChangesetOperations).values(operation(row.id, randomUUID(), "changeset-b")),
    ).rejects.toThrow();
    await expect(db.insert(npAgentChangesetOperations).values(operation(row.id))).rejects.toThrow();
  });
  it("requires exact snapshot identity and paired snapshot_hash independently from before_hash", async () => {
    const { db, user } = await fixture();
    const change = draft(user.userId);
    await db.insert(npAgentChangesets).values(change);
    const op = operation(change.id);
    await db.insert(npAgentChangesetOperations).values(op);
    await expect(
      db.update(npAgentChangesetOperations).set({ snapshotHash: digest }),
    ).rejects.toThrow();
    const snapshot = {
      schemaVersion: "np.agent-changeset-snapshot.v1" as const,
      siteId: change.siteId,
      changeSetId: change.id,
      operationOrdinal: 1,
      canonicalResourceKey: op.resourceKey,
      presence: "absent" as const,
      base: null,
      value: null,
    };
    await db
      .update(npAgentChangesetOperations)
      .set({ beforeSnapshot: snapshot, snapshotHash: digest });
    const [stored] = await db.select().from(npAgentChangesetOperations);
    expect(stored?.beforeHash).toBeNull();
    expect(stored?.snapshotHash).toBe(digest);
    await expect(
      db
        .update(npAgentChangesetOperations)
        .set({ beforeSnapshot: { ...snapshot, siteId: "changeset-b" } }),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`update np_agent_changeset_operations set before_snapshot='{}'::jsonb`),
    ).rejects.toThrow();
    await expect(
      db.update(npAgentChangesetOperations).set({ operation: "replace" }),
    ).rejects.toThrow();
  });
  it("requires a discriminated sealed plan and frozen rollback duration", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    await expect(db.update(npAgentChangesets).set({ state: "ready" })).rejects.toThrow();
    await expect(
      db.execute(
        sql`update np_agent_changesets set state='ready',validation_generation=1,plan_hash=${digest},rollback_window_seconds=60,sealed_plan_body='{}'::jsonb`,
      ),
    ).rejects.toThrow();
    const op = operation(row.id);
    const plan: NpAgentChangeSetPlanCanonicalV1 = {
      schemaVersion: "np.agent-changeset-plan.v1",
      planKind: "changeset",
      siteId: row.siteId,
      changeSetId: row.id,
      body: {
        draftVersion: 1,
        draftHash: digest,
        validationGeneration: 1,
        baseFingerprint: digest,
        operations: [
          {
            ordinal: 1,
            operation: op.input,
            canonicalResourceKey: op.resourceKey,
            beforeHash: null,
            proposedAfterHash: digest,
            snapshotHash: digest,
            rollbackClass: "residual",
            residualCodes: ["ROW_REMAINS"],
          },
        ],
        risk: {
          level: "high",
          reasonCodes: ["PUBLIC_WRITE", "ROLLBACK_PARTIAL"],
          approvalMode: "human",
          reversible: false,
        },
        requiredScopes: ["changeset:apply", "content:draft"],
        requiredHumanCapabilities: ["content.author"],
        requiredHumanPredicates: [],
        policyHashes: [digest],
        expiresAt: row.expiresAt.toISOString(),
        rollbackWindowSeconds: 60,
      },
    };
    await db.update(npAgentChangesets).set({
      state: "ready",
      validationGeneration: 1,
      planHash: digest,
      sealedPlanBody: plan,
      rollbackWindowSeconds: 60,
    });
    await expect(db.update(npAgentChangesets).set({ rollbackWindowSeconds: 59 })).rejects.toThrow();
    await expect(
      db.update(npAgentChangesets).set({ sealedPlanBody: { ...plan, siteId: "changeset-b" } }),
    ).rejects.toThrow();
    const appliedAt = new Date();
    await db.update(npAgentChangesets).set({
      state: "applied",
      appliedAt,
      rollbackEligibleUntil: new Date(appliedAt.getTime() + 60_000),
    });
    await expect(
      db
        .update(npAgentChangesets)
        .set({ rollbackEligibleUntil: new Date(appliedAt.getTime() + 61_000) }),
    ).rejects.toThrow();
  });
  it("binds approval targets to the same site and rejects incomplete decisions or rollback targets", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    const a = approval(row.id, user.userId);
    await db.insert(npAgentApprovals).values(a);
    await expect(
      db.insert(npAgentApprovals).values(approval(row.id, user.userId)),
    ).rejects.toThrow();
    await expect(
      db
        .insert(npAgentApprovals)
        .values(approval(row.id, user.userId, randomUUID(), "changeset-b")),
    ).rejects.toThrow();
    for (const patch of [
      { version: 0 },
      { generation: 0 },
      { state: "approved" },
      { state: "consumed" },
      { requiresLivePreview: true },
      { targetKind: "changeset_rollback" },
      { state: "revoked" },
    ])
      await expect(db.update(npAgentApprovals).set(patch)).rejects.toThrow();
    await expect(
      db.execute(sql`update np_agent_approvals set statement_body='{}'::jsonb`),
    ).rejects.toThrow();
  });
  it("includes all new rows in deletion and keeps Doctor empty state healthy", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    await db.insert(npAgentChangesetOperations).values(operation(row.id));
    await db.insert(npAgentApprovals).values(approval(row.id, user.userId));
    const inventory = await npInspectAgentSiteDeletionRows(db, "changeset-a");
    expect(inventory).toHaveLength(27);
    for (const table of [
      "np_agent_changesets",
      "np_agent_changeset_operations",
      "np_agent_approvals",
    ])
      expect(inventory.find((item) => item.table === table)?.count).toBe(1);
    const health = await npCollectAgentHealthSummaryV1();
    expect(
      health.states.some(
        (item) => item.entity === "changeset" && item.state === "draft" && item.count === 1,
      ),
    ).toBe(true);
    await deleteSite("changeset-a", { cascade: true });
    expect(await db.select().from(npAgentChangesets)).toEqual([]);
    expect(await db.select().from(npAgentApprovals)).toEqual([]);
    expect((await npCollectAgentHealthSummaryV1()).state).toBe("ok");
  });
  it("prepares staff attribution tombstones through the existing authority-loss lifecycle", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: { active: { id: "test-key", key: new Uint8Array(32).fill(4) } },
    });
    await gateway.containUserAuthorityLoss(user.userId);
    const [stored] = await db.select().from(npAgentChangesets);
    expect(stored?.createdByUserId).toBeNull();
    expect(stored?.actorDeletedAt).toBeInstanceOf(Date);
    expect(stored?.actorFingerprint).toBe(digest);
    await db.delete(npUsers).where(eq(npUsers.id, user.userId));
    expect((await db.select().from(npAgentChangesets))[0]?.id).toBe(row.id);
  });
});
