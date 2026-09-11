import { randomUUID } from "node:crypto";
import {
  npVerifyChangeSetExecutionV1,
  type NpAgentChangeSetVerificationOptionsV1,
} from "../../../packages/core/src/agent/changeset-execution-verification.js";
import { npDigestAgentVerificationResultV1 } from "../../../packages/core/src/agent-contract/changeset-execution-contract.js";
import { eq, sql } from "drizzle-orm";
import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { createSite, deleteSite, npUsers } from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentChangesets,
  npAgentChangesetExecutions,
  npAgentChangesetOperations,
  npAgentApprovals,
} from "../../../packages/core/src/db/schema/agent.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npInspectAgentSiteDeletionRows,
  npDeleteAgentSiteRows,
} from "../../../packages/core/src/agent/site-deletion.js";
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
  it("keeps rollback lifecycle references same-site and deferred without weakening apply targets", async () => {
    const { db, user } = await fixture();
    const constraints = await db.execute(
      sql`select conname, condeferrable, condeferred, confdeltype, pg_get_constraintdef(oid) as definition from pg_constraint where conname in ('np_agent_changeset_rollback_plans_execution_fk','np_agent_changeset_rollback_plans_approval_fk') order by conname`,
    );
    expect(constraints.rows).toHaveLength(2);
    for (const row of constraints.rows) {
      expect(row).toMatchObject({ condeferrable: true, condeferred: true, confdeltype: "a" });
      expect(row.definition).toContain("FOREIGN KEY (site_id,");
      expect(row.definition).toContain("(site_id, id)");
    }
    const change = draft(user.userId);
    await db.insert(npAgentChangesets).values(change);
    const approved = approval(change.id, user.userId);
    await db.insert(npAgentApprovals).values(approved);
    const execution = {
      id: randomUUID(),
      siteId: change.siteId,
      changesetId: change.id,
      approvalId: approved.id,
      planHash: digest,
      invocationFingerprint: digest,
      verificationContractFingerprint: digest,
      idempotencyKey: "invalid-rollback",
    };
    await expect(
      db.insert(npAgentChangesetExecutions).values({ ...execution, purpose: "rollback" }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(npAgentChangesetExecutions)
        .values({ ...execution, purpose: "apply", rollbackPlanId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      db.update(npAgentApprovals).set({ targetKind: "changeset_rollback" }),
    ).rejects.toThrow();
  });
  it("fences execution site, approval reuse, leases and terminal verification facts", async () => {
    const { db, user } = await fixture();
    const change = draft(user.userId);
    await db.insert(npAgentChangesets).values(change);
    const approved = approval(change.id, user.userId);
    await db.insert(npAgentApprovals).values(approved);
    const storageGuard = await db.execute(
      sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conname='np_agent_changeset_executions_result_check'`,
    );
    expect(storageGuard.rows).toHaveLength(1);
    expect(storageGuard.rows[0]?.definition).toContain("33554432");
    const execution = {
      id: randomUUID(),
      siteId: "changeset-a",
      changesetId: change.id,
      approvalId: approved.id,
      planHash: digest,
      invocationFingerprint: digest,
      verificationContractFingerprint: digest,
      idempotencyKey: "apply-one",
    };
    await expect(
      db.insert(npAgentChangesetExecutions).values({ ...execution, siteId: "changeset-b" }),
    ).rejects.toThrow();
    await db.insert(npAgentChangesetExecutions).values(execution);
    await expect(
      db
        .insert(npAgentChangesetExecutions)
        .values({ ...execution, id: randomUUID(), idempotencyKey: "second" }),
    ).rejects.toThrow();
    await expect(
      db
        .update(npAgentChangesetExecutions)
        .set({ leaseOwner: "worker" })
        .where(eq(npAgentChangesetExecutions.id, execution.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(npAgentChangesetExecutions)
        .set({ state: "committed" })
        .where(eq(npAgentChangesetExecutions.id, execution.id)),
    ).rejects.toThrow();
    const finishedAt = new Date(Date.now() + 1000);
    await expect(
      db
        .update(npAgentChangesetExecutions)
        .set({ state: "succeeded", committedAt: finishedAt, resultDigest: digest, finishedAt })
        .where(eq(npAgentChangesetExecutions.id, execution.id)),
    ).rejects.toThrow();
    await db
      .update(npAgentChangesetExecutions)
      .set({ state: "failed", errorCode: "CHANGESET_CONFLICT", finishedAt })
      .where(eq(npAgentChangesetExecutions.id, execution.id));
    const inventory = await npInspectAgentSiteDeletionRows(db, "changeset-a");
    expect(inventory.find((row) => row.table === "np_agent_changeset_executions")?.count).toBe(1);
    await npDeleteAgentSiteRows(db, "changeset-a");
    await deleteSite("changeset-a", { cascade: true });
  });

  it("reports execution divergence and stale leases without exposing private effect context", async () => {
    const { db, user } = await fixture();
    const change = draft(user.userId);
    await db.insert(npAgentChangesets).values(change);
    const approved = approval(change.id, user.userId);
    await db.insert(npAgentApprovals).values(approved);
    const reservedAt = new Date(Date.now() - 60_000);
    await db.insert(npAgentChangesetExecutions).values({
      siteId: "changeset-a",
      changesetId: change.id,
      approvalId: approved.id,
      planHash: digest,
      invocationFingerprint: digest,
      verificationContractFingerprint: digest,
      idempotencyKey: "private-idempotency",
      reservedAt,
      leaseOwner: "private-worker",
      leaseToken: randomUUID(),
      leaseUntil: new Date(reservedAt.getTime() + 1000),
      attempts: 1,
      effects: [
        {
          ordinal: 1,
          label: "private-hook",
          context: { collection: "private-collection", documentId: randomUUID() },
          state: "pending",
          errorCode: null,
        },
      ],
    });
    const health = await npCollectAgentHealthSummaryV1();
    expect(health.issues.map((issue) => issue.code)).toContain("AGENT_EXECUTION_DIVERGED");
    expect(health.issues.map((issue) => issue.code)).toContain("AGENT_STALE_EXECUTION");
    expect(JSON.stringify(health)).not.toMatch(/private-|cj1:sha256/);
    await expect(npDeleteAgentSiteRows(db, "changeset-a")).rejects.toThrow(
      "terminal execution effects",
    );
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
    await db
      .insert(npAgentChangesetOperations)
      .values({ ...op, state: "applied", afterHash: digest, resultDigest: digest });
    const approvalRow = approval(row.id, user.userId);
    await db.insert(npAgentApprovals).values(approvalRow);
    const executionId = randomUUID();
    await db.insert(npAgentChangesetExecutions).values({
      id: executionId,
      siteId: row.siteId,
      changesetId: row.id,
      approvalId: approvalRow.id,
      planHash: digest,
      invocationFingerprint: digest,
      verificationContractFingerprint: digest,
      idempotencyKey: "verify",
      state: "committed",
      reservedAt: appliedAt,
      committedAt: appliedAt,
      resultDigest: digest,
      resultBody: {
        operations: [
          {
            ordinal: 1,
            afterHash: digest,
            snapshotHash: digest,
            snapshot: {
              schemaVersion: "np.agent-changeset-snapshot.v1",
              siteId: row.siteId,
              changeSetId: row.id,
              operationOrdinal: 1,
              canonicalResourceKey: op.resourceKey,
              presence: "absent",
              base: null,
              value: null,
            },
          },
        ],
      },
      effects: [
        {
          ordinal: 1,
          label: "hook",
          context: { collection: "posts", documentId: op.resourceKey.documentId },
          state: "unknown",
          errorCode: "EFFECT_AMBIGUOUS",
        },
      ],
    });
    let externalCalls = 0;
    const options: NpAgentChangeSetVerificationOptionsV1 = {
      siteId: row.siteId,
      changeSetId: row.id,
      executionId,
      verificationFingerprint: digest,
      readResources: async () =>
        (["resource_after_hashes", "revisions_audit"] as const).map((checkId) => ({
          checkId,
          required: true,
          severity: "info",
          status: "passed",
          evidenceRefs: [{ kind: "operation", id: "1" }],
          nextAction: "none",
        })),
      verifyConvergence: async () => {
        externalCalls++;
        return { status: "passed", evidenceRefs: [{ kind: "operation", id: "1" }] };
      },
    };
    await npVerifyChangeSetExecutionV1(options);
    let [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.state).toBe("failed");
    expect(
      execution.verificationBody.find((check) => check.checkId === "post_commit_hooks")?.status,
    ).toBe("unavailable");
    expect(execution.leaseToken).toBeNull();

    externalCalls = 0;
    await npVerifyChangeSetExecutionV1({
      ...options,
      verificationFingerprint: `cj1:sha256:${"B".repeat(43)}`,
    });
    [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.errorCode).toBe("DEPENDENCY_UNAVAILABLE");
    expect(externalCalls).toBe(0);
    await npVerifyChangeSetExecutionV1({
      ...options,
      readResources: async () => {
        throw new Error("private authority cause");
      },
    });
    expect(externalCalls).toBe(0);
    let resourceReads = 0;
    await npVerifyChangeSetExecutionV1({
      ...options,
      readResources: async (...args) => {
        resourceReads++;
        if (resourceReads > 1) throw new Error("private changed authority");
        return options.readResources(...args);
      },
    });
    [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.state).toBe("failed");
    expect(JSON.stringify(execution.verificationBody)).not.toContain("private");
    await npVerifyChangeSetExecutionV1({
      ...options,
      verifyConvergence: async () => ({
        status: "passed",
        evidenceRefs: [{ kind: "artifact", id: randomUUID() }],
      }),
    });
    [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.verificationBody.find((check) => check.checkId === "cache")?.status).toBe(
      "unavailable",
    );
    await npVerifyChangeSetExecutionV1({
      ...options,
      verifyConvergence: async () => ({
        status: "passed",
        evidenceRefs: [{ kind: "operation", id: "2" }],
      }),
    });
    [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.verificationBody.find((check) => check.checkId === "cache")?.status).toBe(
      "unavailable",
    );
    let verificationTime = new Date();
    options.now = () => verificationTime;
    await npVerifyChangeSetExecutionV1({
      ...options,
      verifyConvergence: async () => {
        verificationTime = new Date(verificationTime.getTime() + 61_000);
        return { status: "passed", evidenceRefs: [] };
      },
    });
    [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.state).toBe("verifying");
    expect(execution.verificationDigest).toBeNull();
    await npVerifyChangeSetExecutionV1({
      ...options,
      verifyConvergence: async () => {
        await db
          .update(npAgentChangesetExecutions)
          .set({ resultDigest: `cj1:sha256:${"B".repeat(43)}` })
          .where(eq(npAgentChangesetExecutions.id, executionId));
        return { status: "passed", evidenceRefs: [] };
      },
    });
    [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.state).toBe("verifying");
    expect(execution.verificationDigest).toBeNull();
    await db
      .update(npAgentChangesetExecutions)
      .set({ resultDigest: digest })
      .where(eq(npAgentChangesetExecutions.id, executionId));
    verificationTime = new Date(verificationTime.getTime() + 61_000);
    let inspections = 0;
    options.inspectPostCommitEffect = async (input) => {
      inspections++;
      expect(input.ordinal).toBe(1);
      expect(input.label).toBe("hook");
      expect(input.idempotencyKey).toBe("verify");
      return "succeeded";
    };
    externalCalls = 0;
    await Promise.all([
      npVerifyChangeSetExecutionV1(options),
      npVerifyChangeSetExecutionV1(options),
    ]);
    [execution] = await db.select().from(npAgentChangesetExecutions);
    expect(execution.state).toBe("succeeded");
    expect(inspections).toBe(1);
    expect(execution.effects[0]?.state).toBe("succeeded");
    expect(execution.verificationBody).toHaveLength(7);
    expect(externalCalls).toBe(4);
    expect(execution.verificationDigest).toBe(
      await npDigestAgentVerificationResultV1({
        siteId: row.siteId,
        changeSetId: row.id,
        executionId,
        verificationContractFingerprint: digest,
        checks: execution.verificationBody,
      }),
    );
    const [verifiedParent] = await db.select().from(npAgentChangesets);
    expect(verifiedParent.state).toBe("verified");
    await npVerifyChangeSetExecutionV1(options);
    expect(externalCalls).toBe(4);
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
  it("allows sensitive rejection without reauthentication but requires recent evidence to approve", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    const a = approval(row.id, user.userId);
    await db.insert(npAgentApprovals).values({
      ...a,
      risk: "sensitive",
      requiredReauthMode: "recent-staff-primary",
      requiredReauthMaxAgeSeconds: 300,
      statementBody: {
        ...a.statementBody,
        risk: "sensitive",
        reauthentication: { mode: "recent", maxAgeSeconds: 300, assurance: "staff-primary" },
      },
    });
    const decidedAt = new Date();
    const decisionBody = {
      schemaVersion: "np.agent-approval-decision.v1" as const,
      siteId: a.siteId,
      approvalId: a.id,
      approvalGeneration: 1,
      statementHash: digest,
      decision: "reject" as const,
      deciderFingerprint: digest,
      currentHumanCapabilities: ["content.publish" as const],
      reason: null,
      reauthentication: { mode: "none" as const },
      decidedAt: decidedAt.toISOString(),
    };
    const decision = {
      state: "rejected",
      decisionBody,
      decisionHash: digest,
      decisionMac: "fixture-decision-mac",
      deciderFingerprint: digest,
      decidedByUserId: user.userId,
      decidedAt,
    };
    await db.update(npAgentApprovals).set(decision);
    expect((await npCollectAgentHealthSummaryV1()).issues).toEqual([]);
    await expect(
      db.update(npAgentApprovals).set({
        state: "approved",
        decisionBody: { ...decisionBody, decision: "approve" },
      }),
    ).rejects.toThrow();
    const recent = {
      mode: "recent" as const,
      maxAgeSeconds: 300,
      assurance: "staff-primary" as const,
      reauthenticatedAt: decidedAt.toISOString(),
      sessionFactFingerprint: digest,
    };
    await expect(
      db.update(npAgentApprovals).set({
        decisionBody: { ...decisionBody, reauthentication: recent },
        decisionReauthFingerprint: digest,
        decisionReauthenticatedAt: decidedAt,
      }),
    ).rejects.toThrow();
    await db.update(npAgentApprovals).set({
      state: "approved",
      decisionBody: { ...decisionBody, decision: "approve", reauthentication: recent },
      decisionReauthFingerprint: digest,
      decisionReauthenticatedAt: decidedAt,
    });
    expect((await npCollectAgentHealthSummaryV1()).issues).toEqual([]);
  });
  it("reports expired approvals and mismatched integrity bindings without private evidence", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    const a = approval(row.id, user.userId);
    const requestedAt = new Date(Date.now() - 120_000);
    const expiresAt = new Date(Date.now() - 60_000);
    await db.insert(npAgentApprovals).values({
      ...a,
      requestedAt,
      expiresAt,
      // Deliberate mismatched metadata models persisted corruption; no keyring is installed.
      requesterFingerprint: "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      statementBody: {
        ...a.statementBody,
        createdAt: requestedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
    const summary = await npCollectAgentHealthSummaryV1();
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "AGENT_EXPIRY_BACKLOG", count: 1 }),
        expect.objectContaining({ code: "AGENT_ROW_STATE_INVALID", count: 1 }),
      ]),
    );
    const wire = JSON.stringify(summary);
    for (const forbidden of [a.id, row.id, user.userId, digest, a.statementMac, a.integrityKeyId]) {
      expect(wire).not.toContain(forbidden);
    }
  });
  it("includes all new rows in deletion and keeps Doctor empty state healthy", async () => {
    const { db, user } = await fixture();
    const row = draft(user.userId);
    await db.insert(npAgentChangesets).values(row);
    await db.insert(npAgentChangesetOperations).values(operation(row.id));
    await db.insert(npAgentApprovals).values(approval(row.id, user.userId));
    const inventory = await npInspectAgentSiteDeletionRows(db, "changeset-a");
    expect(inventory).toHaveLength(39);
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
