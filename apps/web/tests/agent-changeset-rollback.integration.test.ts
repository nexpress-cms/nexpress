import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import type { NpAgentChangeSetActorV1 } from "../../../packages/core/src/agent/changeset-service.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { grantSiteMembership, npSettings, npUsers, npSessions, npMedia } from "@nexpress/core";
import {
  npAgentApprovals,
  npAgentPrincipals,
  npAgentChangesets,
  npAgentChangesetExecutions,
  npAgentChangesetOperations,
  npAgentChangesetRollbackPlans,
  npAgentChangesetRollbackOperations,
} from "../../../packages/core/src/db/schema/agent.js";
import { executionFixture, decideApproval } from "./agent-changeset-execution-fixture.js";
import { approvedRollbackFixture } from "./agent-changeset-rollback-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";
import { siteId } from "./agent-changeset-fixture.js";
import {
  getActiveTheme,
  getRegisteredThemes,
  registerThemes,
} from "../../../packages/core/src/themes/registry.js";
import { defaultTheme } from "../../../packages/themes/default/src/index.js";
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
import type { NpTransaction } from "../../../packages/core/src/collections/pipeline.js";
const originalThemes = getRegisteredThemes();
describe.skipIf(skipIfNoTestDb())("ChangeSet approved forward compensation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
    registerThemes([defaultTheme]);
  });
  afterAll(async () => {
    registerThemes(originalThemes);
    await closeTestDb();
  });
  it("restores theme absence under a fresh approval without rewriting original apply history", async () => {
    const f = await approvedRollbackFixture({
      draftInput: async (seed) => {
        const themeId = (await getActiveTheme())!.manifest.id;
        const proposed = {
          ordinal: 1,
          canonicalResourceKey: { kind: "theme_tokens" as const, themeId },
          operation: {
            kind: "theme_tokens" as const,
            operation: "replace" as const,
            resource: { themeId },
            clientOperationId: "theme",
            reason: null,
            base: { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` },
            input: { tokens: { colors: { primary: "#123456" } } },
          },
        };
        const current = await seed.db.transaction((tx) =>
          createAgentChangeSetValidationResourceServiceV1().readBase({
            tx: tx as unknown as NpTransaction,
            siteId,
            user: seed.actor.actor.user,
            changeSetId: randomUUID(),
            ...proposed,
          }),
        );
        if (!current.base) throw new Error("Expected theme absence base");
        return {
          title: "Theme compensation",
          summary: null,
          operations: [{ ...proposed.operation, base: current.base }],
        };
      },
    });
    const beforeOperations = await f.db
      .select()
      .from(npAgentChangesetOperations)
      .where(eq(npAgentChangesetOperations.changesetId, f.id));
    const beforeExecution = await f.execution();
    const [beforeApproval] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, f.approved.item.approval.id));
    const result = await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    expect(result.changeSet.state).toBe("rolled_back");
    expect(result.rollbackDetail?.summary.state).toBe("verified");
    expect(result.rollbackDetail?.checks.every((check) => check.status === "passed")).toBe(true);
    expect(
      await f.db
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "theme"))),
    ).toHaveLength(0);
    expect(
      await f.db
        .select()
        .from(npAgentChangesetOperations)
        .where(eq(npAgentChangesetOperations.changesetId, f.id)),
    ).toEqual(beforeOperations);
    expect(await f.execution()).toEqual(beforeExecution);
    expect(
      (
        await f.db.select().from(npAgentApprovals).where(eq(npAgentApprovals.id, beforeApproval.id))
      )[0],
    ).toEqual(beforeApproval);
    expect(
      (
        await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, f.rollbackApproved.item.approval.id))
      )[0].state,
    ).toBe("consumed");
    expect(
      await f.db
        .select()
        .from(npAgentChangesetExecutions)
        .where(eq(npAgentChangesetExecutions.changesetId, f.id)),
    ).toHaveLength(2);
    expect((await f.db.select().from(npAgentChangesetRollbackPlans))[0].state).toBe("verified");
    expect((await f.db.select().from(npAgentChangesets))[0].state).toBe("rolled_back");
  });
  it("reserves queued compensation once and rejects stale targets without overwriting later edits", async () => {
    const f = await approvedRollbackFixture({ deferRollback: true });
    await expect(
      f.service.executeRollback({
        actor: f.actor,
        id: f.id,
        rollbackPlanId: randomUUID(),
        command: f.rollbackCommand,
      }),
    ).rejects.toThrow();
    await expect(
      f.service.executeRollback({
        actor: f.actor,
        id: f.id,
        rollbackPlanId: f.rollbackPlanId,
        command: { ...f.rollbackCommand, planHash: `cj1:sha256:${"A".repeat(43)}` },
      }),
    ).rejects.toThrow();
    expect(
      await f.db
        .select()
        .from(npAgentChangesetExecutions)
        .where(eq(npAgentChangesetExecutions.purpose, "rollback")),
    ).toHaveLength(0);
    await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    expect(f.rollbackJobs).toHaveLength(1);
    const job = f.rollbackJobs[0];
    await expect(
      f.service.processExecution({
        siteId: job.siteId,
        changeSetId: job.changeSetId,
        planHash: job.planHash,
        approvalId: job.approvalId,
        idempotencyKey: job.idempotencyKey,
        scheduledFor: null,
      }),
    ).resolves.toEqual({ state: "stale" });
    expect(
      (
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(eq(npAgentChangesetExecutions.purpose, "rollback"))
      )[0].state,
    ).toBe("reserved");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
    await f.db
      .update(npSettings)
      .set({
        value: { defaultOgImage: null, twitterHandle: "later", defaultLocale: "en" },
        updatedAt: new Date(),
      })
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "seo")));
    await f.service.processRollback(f.rollbackJobs[0]);
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "later" });
    const [execution] = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(eq(npAgentChangesetExecutions.purpose, "rollback"));
    expect(execution).toMatchObject({
      state: "failed",
      committedAt: null,
      errorCode: "BASE_CONFLICT",
    });
  });
  it("keeps duplicate execution and worker delivery from repeating compensation", async () => {
    const f = await approvedRollbackFixture({ deferRollback: true });
    const args = {
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    };
    const attempts = await Promise.allSettled([
      f.service.executeRollback(args),
      f.service.executeRollback(args),
    ]);
    expect(attempts.some((a) => a.status === "fulfilled")).toBe(true);
    expect(
      await f.db
        .select()
        .from(npAgentChangesetExecutions)
        .where(eq(npAgentChangesetExecutions.purpose, "rollback")),
    ).toHaveLength(1);
    expect(f.rollbackJobs.length).toBeGreaterThan(0);
    await Promise.all(f.rollbackJobs.map((job) => f.service.processRollback(job)));
    await f.service.processRollback(f.rollbackJobs[0]);
    const review = await f.service.getReview({ actor: f.actor, id: f.id });
    expect(review.changeSet.state).toBe("rolled_back");
    expect(await f.seo()).toBeUndefined();
    expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(2);
    expect(
      (
        await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, f.rollbackApproved.item.approval.id))
      )[0].state,
    ).toBe("consumed");
  });
  it("expires only the unused rollback plan and permits a fresh approved generation", async () => {
    const f = await approvedRollbackFixture();
    f.advance(601);
    await f.service.approvals!.reconcileExpired({ siteId, limit: 100 });
    await f.service.reconcileRollbacks({ siteId });
    const review = await f.service.getReview({ actor: f.actor, id: f.id });
    expect(review.changeSet.state).toBe("verified");
    expect(review.rollbackDetail?.summary.state).toBe("expired");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
    await expect(
      f.service.executeRollback({
        actor: f.actor,
        id: f.id,
        rollbackPlanId: f.rollbackPlanId,
        command: f.rollbackCommand,
      }),
    ).rejects.toThrow();
    const fresh = await f.service.prepareRollback({
      actor: f.actor,
      id: f.id,
      command: { ...f.prepareCommand, idempotencyKey: randomUUID() },
    });
    expect(fresh.rollbackDetail?.summary.state).toBe("ready");
    expect(fresh.rollbackDetail?.summary.rollbackPlanId).not.toBe(f.rollbackPlanId);
  });
  it("revokes an unused approval without changing applied content or consuming the old approval", async () => {
    const f = await approvedRollbackFixture();
    const current = await f.service.approvals!.get({
      siteId,
      actor: f.approver.actor,
      id: f.rollbackApproved.item.approval.id,
    });
    await decideApproval(f.service.approvals!, f.approver, current, "revoke");
    const review = await f.service.getReview({ actor: f.actor, id: f.id });
    expect(review.changeSet.state).toBe("verified");
    expect(review.rollbackDetail?.summary.state).toBe("failed");
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
    await expect(
      f.service.executeRollback({
        actor: f.actor,
        id: f.id,
        rollbackPlanId: f.rollbackPlanId,
        command: f.rollbackCommand,
      }),
    ).rejects.toThrow();
    expect(
      (
        await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, f.rollbackApproved.item.approval.id))
      )[0].state,
    ).toBe("revoked");
  });
  it("rechecks current approved human authority when queued compensation starts", async () => {
    const f = await approvedRollbackFixture({ deferRollback: true, distinctApprover: true });
    await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    await f.db
      .update(npUsers)
      .set({ role: "author" })
      .where(eq(npUsers.id, f.approver.actor.user.id));
    await grantSiteMembership(siteId, f.approver.actor.user.id, "author");
    await f.service.processRollback(f.rollbackJobs[0]);
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
    expect(
      (
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(eq(npAgentChangesetExecutions.purpose, "rollback"))
      )[0],
    ).toMatchObject({ state: "failed", committedAt: null, errorCode: "AUTHORIZATION_CHANGED" });
  });
  it("keeps a live approved human independent from the preparer's logged-out session", async () => {
    const f = await approvedRollbackFixture({ deferRollback: true, distinctApprover: true });
    await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    await f.service.processRollback(f.rollbackJobs[0]);
    expect(
      (
        await f.db
          .select()
          .from(npAgentChangesetRollbackPlans)
          .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId))
      )[0].state,
    ).toBe("verified");
    expect(await f.seo()).toBeUndefined();
  });
  it("cancels an aborted reserved processor before any compensating write", async () => {
    const f = await approvedRollbackFixture({ deferRollback: true });
    await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    const controller = new AbortController();
    controller.abort();
    await f.service.processRollback(f.rollbackJobs[0], { signal: controller.signal });
    expect(
      (
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(eq(npAgentChangesetExecutions.purpose, "rollback"))
      )[0],
    ).toMatchObject({ state: "failed", committedAt: null, errorCode: "EXECUTION_CANCELLED" });
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
  });
  it("blocks paused execution intent before touching the approved resource", async () => {
    const f = await approvedRollbackFixture({ deferRollback: true });
    await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    f.pause();
    await f.service.processRollback(f.rollbackJobs[0]);
    expect(
      (
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(eq(npAgentChangesetExecutions.purpose, "rollback"))
      )[0],
    ).toMatchObject({ state: "failed", committedAt: null, errorCode: "POLICY_CHANGED" });
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
  });
  it("closes expired snapshot authority even while immutable snapshot bodies remain retained", async () => {
    const f = await approvedRollbackFixture({ rollbackWindowSeconds: 60 });
    f.advance(61);
    await f.service.reconcileRollbacks({ siteId });
    await expect(
      f.service.executeRollback({
        actor: f.actor,
        id: f.id,
        rollbackPlanId: f.rollbackPlanId,
        command: f.rollbackCommand,
      }),
    ).rejects.toThrow();
    await expect(
      f.service.prepareRollback({
        actor: f.actor,
        id: f.id,
        command: { ...f.prepareCommand, idempotencyKey: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_EXPIRED" });
    const [operation] = await f.db
      .select()
      .from(npAgentChangesetOperations)
      .where(eq(npAgentChangesetOperations.changesetId, f.id));
    expect(operation.beforeSnapshot).not.toBeNull();
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
  });
  it("cancels an approved compensation through the existing cancel command and opens a fresh generation", async () => {
    const f = await approvedRollbackFixture(),
      current = await f.service.getReview({ actor: f.actor, id: f.id });
    if (!current.rollbackDetail) throw new Error("Missing rollback fixture");
    await f.service.cancel({
      actor: f.actor,
      id: f.id,
      command: {
        schemaVersion: "np.agent-changeset-cancel-input.v1",
        targetKind: "rollback_plan",
        rollbackPlanId: f.rollbackPlanId,
        expectedRollbackVersion: current.rollbackDetail.version,
        expectedDraftVersion: current.changeSet.draftVersion,
        expectedState: "approved",
        planHash: f.rollbackCommand.planHash,
        reasonCode: "OPERATOR_CANCELLED",
        reason: "Cancelled compensation",
        idempotencyKey: randomUUID(),
      },
    });
    expect((await f.service.getReview({ actor: f.actor, id: f.id })).changeSet.state).toBe(
      "verified",
    );
    expect((await f.db.select().from(npAgentChangesetRollbackPlans))[0]).toMatchObject({
      state: "failed",
      terminalReason: "operator_cancelled",
    });
    const fresh = await f.service.prepareRollback({
      actor: f.actor,
      id: f.id,
      command: { ...f.prepareCommand, idempotencyKey: randomUUID() },
    });
    expect(fresh.rollbackDetail?.summary.state).toBe("ready");
    expect(fresh.rollbackDetail?.summary.rollbackPlanId).not.toBe(f.rollbackPlanId);
    expect((await f.seo())?.value).toMatchObject({ twitterHandle: "execution" });
  });
  it("allows independently approved staff compensation after the original apply principal is revoked", async () => {
    const f = await approvedRollbackFixture({
      principalExposure: "approved-execute",
      deferRollback: true,
    });
    if (!f.principal) throw new Error("Missing principal fixture");
    await expect(
      f.service.prepareRollback({
        actor: f.principal.actor as unknown as Extract<NpAgentChangeSetActorV1, { kind: "staff" }>,
        id: f.id,
        command: { ...f.prepareCommand, idempotencyKey: randomUUID() },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    const revokedAt = new Date();
    await f.db
      .update(npAgentPrincipals)
      .set({ status: "revoked", revokedAt, updatedAt: revokedAt });
    await f.service.processRollback(f.rollbackJobs[0]);
    expect((await f.db.select().from(npAgentChangesetRollbackPlans))[0].state).toBe("verified");
    expect(await f.seo()).toBeUndefined();
  });
  it("never revives a terminal failed compensation or rewrites its history on verification retry", async () => {
    const f = await approvedRollbackFixture({ convergenceFails: true });
    const originalExecution = await f.execution();
    const originalOperations = await f.db
      .select()
      .from(npAgentChangesetOperations)
      .where(eq(npAgentChangesetOperations.changesetId, f.id));
    const failed = await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    expect(failed.changeSet.state).toBe("rollback_failed");
    expect(failed.rollbackDetail?.summary.state).toBe("failed");
    expect(
      failed.rollbackDetail?.checks.some((check) => check.nextAction === "retry_verification"),
    ).toBe(false);
    expect(failed.rollbackDetail?.checks.find((check) => check.checkId === "cache")).toMatchObject({
      status: "failed",
      nextAction: "refresh_plan",
    });
    expect(await f.seo()).toBeUndefined();
    const [execution] = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(eq(npAgentChangesetExecutions.purpose, "rollback"));
    expect(execution.committedAt).not.toBeNull();
    const [plan] = await f.db
      .select()
      .from(npAgentChangesetRollbackPlans)
      .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId));
    const rollbackOperations = await f.db
      .select()
      .from(npAgentChangesetRollbackOperations)
      .where(eq(npAgentChangesetRollbackOperations.rollbackPlanId, f.rollbackPlanId));
    const [approval] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, f.rollbackApproved.item.approval.id));
    expect(approval.state).toBe("consumed");
    const calls = f.verifyConvergence.mock.calls.length;
    f.verifyConvergence.mockResolvedValue({ status: "passed", evidenceRefs: [] });
    await f.service.processVerification({ siteId, changeSetId: f.id, executionId: execution.id });
    const review = await f.service.getReview({ actor: f.actor, id: f.id });
    expect(review.changeSet.state).toBe("rollback_failed");
    expect(review.rollbackDetail?.summary.state).toBe("failed");
    expect(f.verifyConvergence).toHaveBeenCalledTimes(calls);
    expect(
      (
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(eq(npAgentChangesetExecutions.id, execution.id))
      )[0],
    ).toEqual(execution);
    expect(
      (
        await f.db
          .select()
          .from(npAgentChangesetRollbackPlans)
          .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId))
      )[0],
    ).toEqual(plan);
    expect(
      await f.db
        .select()
        .from(npAgentChangesetRollbackOperations)
        .where(eq(npAgentChangesetRollbackOperations.rollbackPlanId, f.rollbackPlanId)),
    ).toEqual(rollbackOperations);
    expect(
      (await f.db.select().from(npAgentApprovals).where(eq(npAgentApprovals.id, approval.id)))[0],
    ).toEqual(approval);
    expect(await f.seo()).toBeUndefined();
    expect(await f.execution()).toEqual(originalExecution);
    expect(
      await f.db
        .select()
        .from(npAgentChangesetOperations)
        .where(eq(npAgentChangesetOperations.changesetId, f.id)),
    ).toEqual(originalOperations);
    expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(2);
  });
  it.each(["schema", "reference"] as const)(
    "persists an invalid compensation plan when prior %s inputs are no longer available",
    async (mode) => {
      let mediaId = "";
      const f = await executionFixture({
        draftInput: async (seed) => {
          const [media] = await seed.db
            .insert(npMedia)
            .values({
              siteId,
              filename: "prior.png",
              originalFilename: "prior.png",
              mimeType: "image/png",
              filesize: 1,
              storageKey: "rollback-fixture-object",
              hash: "rollback-fixture-hash",
              status: "ready",
            })
            .returning({ id: npMedia.id });
          mediaId = media.id;
          const document = await withCurrentSite(siteId, () =>
            saveDocument(
              "posts",
              null,
              {
                title: "Long prior title",
                content: npCreateEmptyRichTextContent(),
                coverImage: mediaId,
              },
              seed.actor.actor.user,
              { status: "draft" },
            ),
          );
          const id = String(document.doc.id),
            proposal = {
              ordinal: 1,
              canonicalResourceKey: {
                kind: "document" as const,
                collection: "posts",
                documentId: id,
              },
              operation: {
                kind: "document" as const,
                operation: "update" as const,
                resource: { collection: "posts", documentId: id },
                clientOperationId: "update",
                reason: null,
                base: { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` },
                input: { patch: { title: "After", coverImage: null }, targetStatus: null },
              },
            };
          const current = await seed.db.transaction((tx) =>
            createAgentChangeSetValidationResourceServiceV1().readBase({
              tx: tx as unknown as NpTransaction,
              siteId,
              user: seed.actor.actor.user,
              changeSetId: randomUUID(),
              ...proposal,
            }),
          );
          if (!current.base) throw new Error("Expected document base");
          return {
            title: "Prior restoration",
            summary: null,
            operations: [{ ...proposal.operation, base: current.base }],
          };
        },
      });
      const applied = await f.service.apply({
        actor: f.actor,
        id: f.id,
        command: f.executionCommand,
      });
      if (mode === "schema") {
        const config = getCollectionConfig("posts");
        registerCollection("posts", getCollectionTable("posts"), {
          ...config,
          fields: config.fields.map((field) =>
            "name" in field && field.name === "title" && field.type === "text"
              ? { ...field, maxLength: 6 }
              : field,
          ),
        });
      } else
        await f.db.update(npMedia).set({ deletedAt: new Date() }).where(eq(npMedia.id, mediaId));
      const prepared = await f.service.prepareRollback({
        actor: f.actor,
        id: f.id,
        command: {
          schemaVersion: "np.agent-rollback-plan-create-input.v1",
          expectedVersion: applied.changeSet.draftVersion,
          planHash: applied.changeSet.planHash!,
          idempotencyKey: randomUUID(),
        },
      });
      expect(prepared.rollbackDetail?.summary.state).toBe("invalid");
      expect(prepared.changeSet.state).toBe(applied.changeSet.state);
      expect((await f.db.select().from(npAgentChangesetRollbackPlans))[0].state).toBe("invalid");
      expect(await f.db.select().from(npAgentChangesetExecutions)).toHaveLength(1);
    },
  );
  it.each(["pending", "running", "unknown", "failed"] as const)(
    "keeps a terminal rollback's %s effect separate from permission to prepare another generation",
    async (state) => {
      const f = await approvedRollbackFixture({ document: true });
      const failed = await f.service.executeRollback({
        actor: f.actor,
        id: f.id,
        rollbackPlanId: f.rollbackPlanId,
        command: f.rollbackCommand,
      });
      expect(failed.changeSet.state).toBe("rollback_failed");
      const [execution] = await f.db
        .select()
        .from(npAgentChangesetExecutions)
        .where(eq(npAgentChangesetExecutions.purpose, "rollback"));
      expect(execution.state).toBe("failed");
      expect(execution.effects.length).toBeGreaterThan(0);
      const effects = execution.effects.map((effect, index) =>
        index === 0
          ? {
              ...effect,
              state,
              errorCode:
                state === "unknown"
                  ? "EFFECT_AMBIGUOUS"
                  : state === "failed"
                    ? "DEPENDENCY_UNAVAILABLE"
                    : null,
            }
          : effect,
      );
      await f.db
        .update(npAgentChangesetExecutions)
        .set({ effects })
        .where(eq(npAgentChangesetExecutions.id, execution.id));
      const [recorded] = await f.db
        .select()
        .from(npAgentChangesetExecutions)
        .where(eq(npAgentChangesetExecutions.id, execution.id));
      const [plan] = await f.db
        .select()
        .from(npAgentChangesetRollbackPlans)
        .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId));
      const command = { ...f.prepareCommand, idempotencyKey: randomUUID() };
      if (state === "failed") {
        const fresh = await f.service.prepareRollback({ actor: f.actor, id: f.id, command });
        expect(fresh.rollbackDetail?.summary.state).toBe("conflicted");
        expect(fresh.rollbackDetail?.summary.rollbackPlanId).not.toBe(f.rollbackPlanId);
        expect(await f.db.select().from(npAgentChangesetRollbackPlans)).toHaveLength(2);
      } else {
        await expect(
          f.service.prepareRollback({ actor: f.actor, id: f.id, command }),
        ).rejects.toThrow();
        expect(await f.db.select().from(npAgentChangesetRollbackPlans)).toHaveLength(1);
      }
      const calls = f.verifyConvergence.mock.calls.length;
      await f.service.processVerification({ siteId, changeSetId: f.id, executionId: execution.id });
      expect(f.verifyConvergence).toHaveBeenCalledTimes(calls);
      expect(
        (
          await f.db
            .select()
            .from(npAgentChangesetExecutions)
            .where(eq(npAgentChangesetExecutions.id, execution.id))
        )[0],
      ).toEqual(recorded);
      expect(
        (
          await f.db
            .select()
            .from(npAgentChangesetRollbackPlans)
            .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId))
        )[0],
      ).toEqual(plan);
      expect(
        (await f.db.select().from(npAgentChangesets).where(eq(npAgentChangesets.id, f.id)))[0]
          .state,
      ).toBe("rollback_failed");
    },
  );
});
