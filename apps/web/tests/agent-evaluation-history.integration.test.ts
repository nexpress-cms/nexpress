import { randomUUID } from "node:crypto";
import { grantSiteMembership } from "@nexpress/core";
import { eq, and } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentEvaluationSources,
  npAgentEvaluationReviews,
  npAgentInvocations,
  npAgentRuns,
  npAgentProviderCalls,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npSessions,
  npSiteMemberships,
  npUsers,
} from "../../../packages/core/src/db/schema/system.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { createAgentEvaluationHistoryServiceV1 } from "../../../packages/core/src/agent/evaluation-history-service.js";
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "../../../packages/core/src/agent/evaluation-workbench.js";
import { runAgentModeratorEvaluationV1 } from "../../../packages/core/src/agent/moderator-evaluation.js";
import { runAgentEvaluationV1 } from "../../../packages/core/src/agent/evaluation.js";
import { npCreateAgentPublisherEvaluationSuiteV1 } from "../../../packages/core/src/agent/publisher-evaluation-fixtures.js";
import { npRequireAgentEvaluationSuiteV1 } from "../../../packages/core/src/agent-contract/evaluation-contract.js";
import type { NpAgentEvaluationHistorySaveV1 } from "../../../packages/core/src/agent-contract/evaluation-history-contract.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
let evaluation: unknown;
let initial: Awaited<ReturnType<typeof npBuildAgentEvaluationWorkbenchV1>>;
describe.skipIf(skipIfNoTestDb())("Authenticated evaluation review history", () => {
  beforeAll(async () => {
    await ensureMigrated();
    const all = await npCreateAgentPublisherEvaluationSuiteV1();
    evaluation = await runAgentEvaluationV1({
      suite: npRequireAgentEvaluationSuiteV1({
        ...all,
        cases: all.cases.filter((c) => c.id === "pub-002"),
      }),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget: {
        maxCalls: 1,
        maxInputTokens: 100000,
        maxOutputTokens: 100000,
        maxCostMicros: 0,
        timeoutMs: 5000,
      },
    });
    initial = await npBuildAgentEvaluationWorkbenchV1({
      schemaVersion: "np.agent-eval-workbench-request.v1",
      recipe: "publisher",
      evaluation,
      review: null,
      baseline: null,
      baselineReview: null,
      labels: null,
    });
    if (!initial.cases[0]?.eligible || !initial.cases[0].allowedOutcomes.includes("accept"))
      throw new Error("Expected an eligible Publisher improvement fixture.");
  });
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  async function setup() {
    const f = await fixture();
    const staff = { siteId, actor: f.actor.actor };
    const service = createAgentEvaluationHistoryServiceV1();
    const c = initial.cases[0];
    const command: NpAgentEvaluationHistorySaveV1 = {
      schemaVersion: "np.agent-evaluation-history-save.v1",
      recipe: "publisher",
      evaluationJson: JSON.stringify(evaluation),
      sourceHash: initial.sourceHash,
      expectedVersion: 0,
      caseId: c.caseId,
      caseVersion: c.caseVersion,
      caseHash: c.caseHash,
      predictionHash: c.predictionHash!,
      decision: {
        outcome: "accept",
        notes: "Authenticated current decision, not imported attribution.",
        editedProposalJson: null,
      },
      idempotencyKey: randomUUID(),
    };
    return { f, staff, service, command };
  }
  it("persists an exact authenticated decision without Runtime/provider, replays once and retains revisions through clear", async () => {
    const x = await setup();
    const saved = await x.service.save({ ...x.staff, command: x.command });
    expect(saved.replayed).toBe(false);
    expect(await x.service.save({ ...x.staff, command: x.command })).toEqual({
      ...saved,
      replayed: true,
    });
    const detail = await x.service.get({ ...x.staff, sourceId: saved.resourceId });
    expect(detail.source).toMatchObject({ sourceHash: initial.sourceHash, version: 1 });
    const listed = await x.service.list(x.staff);
    expect(listed.sources).toEqual([detail.source]);
    expect(listed.nextCursor).toBeNull();
    expect(JSON.stringify(listed)).not.toContain("evaluationBody");
    expect(JSON.parse(detail.evaluationJson)).toEqual(evaluation);
    const request = {
      ...x.staff,
      sourceId: saved.resourceId,
      caseId: x.command.caseId,
      caseVersion: x.command.caseVersion,
    };
    const first = await x.service.history(request);
    expect(first.authority).toBe("authenticated-staff-review-no-approval");
    expect(first.revisions).toHaveLength(1);
    const label = JSON.parse(first.revisions[0].labelJson!);
    expect(label.reviewer).toBe(`staff:${first.revisions[0].actorFingerprint}`);
    expect(label.sourceHash).toBe(initial.sourceHash);
    await x.service.save({
      ...x.staff,
      command: { ...x.command, expectedVersion: 1, decision: null, idempotencyKey: randomUUID() },
    });
    const cleared = await x.service.history(request);
    expect(cleared.revisions.map((r) => r.labelJson === null)).toEqual([true, false]);
    expect(cleared.revisions[1]).toEqual(first.revisions[0]);
    expect(cleared.revisions[0].previousRevisionId).toBe(first.revisions[0].id);
    expect(await x.f.db.select().from(npAgentRuns)).toHaveLength(0);
    expect(await x.f.db.select().from(npAgentProviderCalls)).toHaveLength(0);
  });
  it("keeps detector verdict history under the original Moderator label owner", async () => {
    const x = await setup();
    const evaluation = await runAgentModeratorEvaluationV1();
    const result = await npBuildAgentEvaluationWorkbenchV1({
      schemaVersion: "np.agent-eval-workbench-request.v1",
      recipe: "moderator",
      evaluation,
      review: null,
      baseline: null,
      baselineReview: null,
      labels: null,
    });
    const c = result.cases.find((entry) => entry.eligible);
    if (!c || !c.predictionHash) throw new Error("Missing eligible detector fixture.");
    const saved = await x.service.save({
      ...x.staff,
      command: {
        ...x.command,
        recipe: "moderator",
        evaluationJson: JSON.stringify(evaluation),
        sourceHash: result.sourceHash,
        caseId: c.caseId,
        caseVersion: c.caseVersion,
        caseHash: c.caseHash,
        predictionHash: c.predictionHash,
        decision: {
          outcome: "confirmed-spam",
          notes: "Explicit staff detector verdict.",
          editedProposalJson: null,
        },
      },
    });
    const history = await x.service.history({
      ...x.staff,
      sourceId: saved.resourceId,
      caseId: c.caseId,
      caseVersion: c.caseVersion,
    });
    const label = JSON.parse(history.revisions[0].labelJson!);
    expect(label.label).toBe("confirmed-spam");
    expect(label).not.toHaveProperty("outcome");
    expect(result.authority).toBe("offline-self-reported-no-approval");
  });
  it("hashes private upload and notes in the existing invocation journal, rejecting reused idempotency bodies", async () => {
    const x = await setup();
    await x.service.save({ ...x.staff, command: x.command });
    const [inv] = await x.f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.operationId, "agents.evaluations.review"));
    expect(JSON.stringify(inv.requestBody)).not.toContain(x.command.decision!.notes);
    expect(JSON.stringify(inv.requestBody)).not.toContain("evaluationJson");
    expect(inv.auditEventId).not.toBeNull();
    const [audit] = await x.f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.id, inv.auditEventId!));
    expect(audit.targetType).toBe("agent-evaluation");
    await expect(
      x.service.save({
        ...x.staff,
        command: {
          ...x.command,
          decision: { ...x.command.decision!, notes: "Different decision body" },
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });
  it("fails binding and grounded edit validation atomically before producing a stored decision or audit", async () => {
    const x = await setup();
    for (const patch of [
      { caseVersion: 2 },
      { caseId: "not-the-case" },
      { caseHash: `cj1:sha256:${"B".repeat(43)}` },
      { sourceHash: `cj1:sha256:${"B".repeat(43)}` },
      { decision: { outcome: "edit", notes: "Invalid edit", editedProposalJson: "{}" } },
    ])
      await expect(
        x.service.save({
          ...x.staff,
          command: { ...x.command, ...patch } as NpAgentEvaluationHistorySaveV1,
        }),
      ).rejects.toBeDefined();
    expect(await x.f.db.select().from(npAgentEvaluationSources)).toHaveLength(0);
    expect(await x.f.db.select().from(npAgentEvaluationReviews)).toHaveLength(0);
    expect(
      await x.f.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.operationId, "agents.evaluations.review")),
    ).toHaveLength(0);
  });
  it("allows one competing expected-version replacement and preserves the other author's immutable prior decision", async () => {
    const x = await setup();
    const saved = await x.service.save({ ...x.staff, command: x.command });
    const writes = await Promise.allSettled(
      ["First replacement", "Second replacement"].map((notes) =>
        x.service.save({
          ...x.staff,
          command: {
            ...x.command,
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
            decision: { ...x.command.decision!, notes },
          },
        }),
      ),
    );
    expect(writes.filter((w) => w.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((w) => w.status === "rejected")).toHaveLength(1);
    expect((await x.service.get({ ...x.staff, sourceId: saved.resourceId })).source.version).toBe(
      2,
    );
    expect(await x.f.db.select().from(npAgentEvaluationReviews)).toHaveLength(2);
  });
  it("rechecks current membership and session for source reads, history and exact write replay", async () => {
    const x = await setup();
    const saved = await x.service.save({ ...x.staff, command: x.command });
    await expect(
      x.service.get({ ...x.staff, siteId: "draft-other", sourceId: saved.resourceId }),
    ).rejects.toMatchObject({ code: "EVALUATION_HISTORY_NOT_FOUND" });
    await x.f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(
        and(
          eq(npSiteMemberships.siteId, siteId),
          eq(npSiteMemberships.userId, x.staff.actor.user.id),
        ),
      );
    await expect(x.service.list(x.staff)).rejects.toMatchObject({ code: "SITE_ACCESS_DENIED" });
    await expect(x.service.save({ ...x.staff, command: x.command })).rejects.toMatchObject({
      code: "SITE_ACCESS_DENIED",
    });
    await x.f.db
      .update(npSiteMemberships)
      .set({ role: "admin" })
      .where(
        and(
          eq(npSiteMemberships.siteId, siteId),
          eq(npSiteMemberships.userId, x.staff.actor.user.id),
        ),
      );
    await x.f.db
      .update(npSessions)
      .set({ accessExpiresAt: new Date(0) })
      .where(eq(npSessions.id, x.staff.actor.sessionId));
    await expect(
      x.service.history({
        ...x.staff,
        sourceId: saved.resourceId,
        caseId: x.command.caseId,
        caseVersion: x.command.caseVersion,
      }),
    ).rejects.toMatchObject({ code: "STAFF_AUTHORIZATION_REQUIRED" });
    await expect(x.service.save({ ...x.staff, command: x.command })).rejects.toMatchObject({
      code: "STAFF_AUTHORIZATION_REQUIRED",
    });
  });
  it("retains authenticated history after actual account deletion, requires current reader authority and rejects corrupted evidence", async () => {
    const x = await setup();
    const saved = await x.service.save({ ...x.staff, command: x.command });
    const selected = {
      sourceId: saved.resourceId,
      caseId: x.command.caseId,
      caseVersion: x.command.caseVersion,
    };
    const first = await x.service.history({ ...x.staff, ...selected });
    const seededReader = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, seededReader.userId, "admin");
    const [readerUser] = await x.f.db
      .select()
      .from(npUsers)
      .where(eq(npUsers.id, seededReader.userId));
    const [readerSession] = await x.f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seededReader.userId));
    if (!readerUser || !readerSession) throw new Error("Missing replacement staff reader.");
    const q = {
      siteId,
      actor: {
        user: {
          id: readerUser.id,
          email: readerUser.email,
          name: readerUser.name,
          role: readerUser.role,
          tokenVersion: readerUser.tokenVersion,
        },
        sessionId: readerSession.id,
      },
      ...selected,
    };
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: {
        active: { id: "evaluation-review-deletion", key: new Uint8Array(32).fill(77) },
      },
      environment: "production",
    });
    await gateway.containUserAuthorityLoss(x.staff.actor.user.id);
    // Audit identity is a separate nullable FK; its immutable event and payload remain.
    await x.f.db
      .update(npAuditEvents)
      .set({ actorUserId: null })
      .where(eq(npAuditEvents.actorUserId, x.staff.actor.user.id));
    await x.f.db.delete(npUsers).where(eq(npUsers.id, x.staff.actor.user.id));
    expect(
      await x.f.db.select().from(npUsers).where(eq(npUsers.id, x.staff.actor.user.id)),
    ).toEqual([]);
    await expect(x.service.get({ ...x.staff, sourceId: saved.resourceId })).rejects.toMatchObject({
      code: "STAFF_AUTHORIZATION_REQUIRED",
    });
    const detail = await x.service.get({ ...q, sourceId: saved.resourceId });
    expect(detail.source.sourceHash).toBe(initial.sourceHash);
    const after = await x.service.history(q);
    expect(after.revisions[0]).toMatchObject({
      actorDeleted: true,
      actorFingerprint: first.revisions[0].actorFingerprint,
      revisionHash: first.revisions[0].revisionHash,
    });
    await x.f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(
        and(
          eq(npSiteMemberships.siteId, siteId),
          eq(npSiteMemberships.userId, seededReader.userId),
        ),
      );
    await expect(x.service.history(q)).rejects.toMatchObject({ code: "SITE_ACCESS_DENIED" });
    await x.f.db
      .update(npSiteMemberships)
      .set({ role: "admin" })
      .where(
        and(
          eq(npSiteMemberships.siteId, siteId),
          eq(npSiteMemberships.userId, seededReader.userId),
        ),
      );
    const [invocation] = await x.f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.resultId, saved.resourceId))
      .limit(1);
    if (!invocation) throw new Error("Missing authenticated review invocation.");
    expect(invocation.staffUserId).toBeNull();
    expect(invocation.actorDeletedAt).toBeInstanceOf(Date);
    for (const tampered of [
      { requestHash: `cj1:sha256:${"B".repeat(43)}` },
      { authorizationContextFingerprint: `cj1:sha256:${"B".repeat(43)}` },
      { outputHash: `cj1:sha256:${"B".repeat(43)}` },
    ]) {
      await x.f.db
        .update(npAgentInvocations)
        .set(tampered)
        .where(eq(npAgentInvocations.id, invocation.id));
      await expect(x.service.history(q)).rejects.toMatchObject({
        code: "EVALUATION_HISTORY_INVALID",
      });
      await x.f.db
        .update(npAgentInvocations)
        .set({
          requestHash: invocation.requestHash,
          authorizationContextFingerprint: invocation.authorizationContextFingerprint,
          outputHash: invocation.outputHash,
        })
        .where(eq(npAgentInvocations.id, invocation.id));
    }
    await x.f.db
      .update(npAgentEvaluationReviews)
      .set({
        labelBody: {
          ...JSON.parse(first.revisions[0].labelJson!),
          notes: "Tampered stored decision.",
        },
      })
      .where(eq(npAgentEvaluationReviews.id, first.revisions[0].id));
    await expect(x.service.history(q)).rejects.toMatchObject({
      code: "EVALUATION_HISTORY_INVALID",
    });
  });
});
