/* eslint-disable import-x/no-relative-packages */
import { randomUUID } from "node:crypto";
import {
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../../../packages/core/src/agent-contract/canonical-changeset.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
import type { NpAgentChangeSetOperationInput } from "../../../packages/core/src/agent-contract/types.js";
import { grantSiteMembership, npRevisions, npSessions, npUsers } from "@nexpress/core";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentChangesetOperations,
  npAgentChangesets,
  npAgentChangesetValidationAttempts,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { postsTable } from "../src/db/generated/collections.js";
import {
  command,
  fixture,
  oauthFixture,
  principalFixture,
  siteId,
} from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
async function requester(f: Awaited<ReturnType<typeof fixture>>) {
  const seeded = await seedUser({ role: "admin" });
  await grantSiteMembership(siteId, seeded.userId, "admin");
  const [user] = await f.db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
  const [session] = await f.db
    .select()
    .from(npSessions)
    .where(eq(npSessions.userId, seeded.userId));
  return { kind: "staff" as const, siteId, actor: { user: user!, sessionId: session!.id } };
}
async function oneAttempt(f: Awaited<ReturnType<typeof fixture>>) {
  const attempts = await f.db.select().from(npAgentChangesetValidationAttempts);
  expect(attempts).toHaveLength(1);
  return attempts[0]!;
}
const validationCommand = () => ({ idempotencyKey: randomUUID(), expectedVersion: 1 });
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
describe.skipIf(skipIfNoTestDb())("ChangeSet validation lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    // Forks reuse the test database across files; prior suites may clean only before cases.
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("seals a bounded create plan with exact snapshots and performs no content writes", async () => {
    const f = await fixture();
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const validated = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(validated.state).toBe("ready");
    expect(validated.validation).toMatchObject({ state: "valid", generation: 1 });
    expect(validated.planHash).toMatch(/^cj1:sha256:/);
    const [row] = await f.db.select().from(npAgentChangesets);
    const [operation] = await f.db.select().from(npAgentChangesetOperations);
    expect(row!.sealedPlanBody).not.toBeNull();
    expect(row!.sealedPlanBody!.body.requiredScopes).toEqual([
      "changeset:apply",
      "content:draft",
      "content:publish",
    ]);
    expect(await npDigestAgentChangeSetPlanCanonical(row!.sealedPlanBody!)).toBe(row!.planHash);
    expect(row!.baseFingerprint).not.toBeNull();
    expect(operation!.beforeSnapshot).not.toBeNull();
    expect(operation!.snapshotHash).toMatch(/^cj1:sha256:/);
    expect(await npDigestAgentChangeSetSnapshotCanonical(operation!.beforeSnapshot!)).toBe(
      operation!.snapshotHash,
    );
    expect((await oneAttempt(f)).state).toBe("ready");
    expect(await f.db.select().from(postsTable)).toEqual([]);
    expect(await f.db.select().from(npRevisions)).toEqual([]);
    expect(await f.db.select().from(npAgentActions)).toEqual([]);
    expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
    const encoded = JSON.stringify(validated);
    expect(encoded).not.toContain('"sealedPlanBody"');
    expect(encoded).not.toContain('"beforeSnapshot"');
    expect(encoded).not.toContain('"authorityRef"');
  });
  it("replays validation without new attempts and rejects stale draft versions", async () => {
    const f = await fixture();
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const input = { actor: f.actor, id: draft.id, command: validationCommand() };
    const first = await f.service.validate(input);
    const replay = await f.service.validate(input);
    expect(replay.planHash).toBe(first.planHash);
    expect((await oneAttempt(f)).generation).toBe(1);
    await expect(
      f.service.validate({ ...input, command: { ...validationCommand(), expectedVersion: 2 } }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("admits concurrent identical validation once and seals once", async () => {
    const f = await fixture();
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const input = { actor: f.actor, id: draft.id, command: validationCommand() };
    const outcomes = await Promise.allSettled([
      f.service.validate(input),
      f.service.validate(input),
    ]);
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
    expect((await oneAttempt(f)).generation).toBe(1);
    expect((await f.db.select().from(npAgentChangesets))[0]!.state).toBe("ready");
  });
  it.each(["revoked", "expired"])(
    "queued work rechecks the %s requester rather than substituting its creator",
    async (mode) => {
      const jobs: Array<{ siteId: string; attemptId: string }> = [];
      const f = await fixture({
        inlineValidationOperationLimit: 0,
        enqueueValidation: async (job) => {
          jobs.push(job);
        },
      });
      const draft = await f.service.create({ actor: f.actor, command: await command() });
      const other = await requester(f);
      const queued = await f.service.validate({
        actor: other,
        id: draft.id,
        command: validationCommand(),
      });
      expect(queued.state).toBe("validating");
      expect(jobs).toHaveLength(1);
      expect((await oneAttempt(f)).requesterId).toBe(other.actor.user.id);
      if (mode === "revoked")
        await f.db.delete(npSessions).where(eq(npSessions.id, other.actor.sessionId));
      else
        await f.db
          .update(npSessions)
          .set({ accessExpiresAt: new Date(Date.now() - 1000) })
          .where(eq(npSessions.id, other.actor.sessionId));
      await f.service.processValidation(jobs[0]!);
      expect(await oneAttempt(f)).toMatchObject({
        state: "failed",
        errorCode: "AUTHORITY_REVOKED",
        resultDigest: null,
      });
      const [row] = await f.db.select().from(npAgentChangesets);
      expect(row!.state).toBe("invalid");
      expect(row!.sealedPlanBody).toBeNull();
      expect(row!.planHash).toBeNull();
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      expect((await f.service.get({ actor: f.actor, id: draft.id })).validation?.state).toBe(
        "failed",
      );
    },
  );
  it("preserves a durable queued attempt when the host enqueue fails", async () => {
    const f = await fixture({
      inlineValidationOperationLimit: 0,
      enqueueValidation: () => Promise.reject(new Error("private queue detail")),
    });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const result = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(result.state).toBe("validating");
    const attempt = await oneAttempt(f);
    expect(attempt.state).toBe("queued");
    await f.service.reconcileValidations({ siteId, limit: 1 });
    expect((await oneAttempt(f)).state).toBe("ready");
  });
  it("stale generation jobs do not overwrite a newer parent", async () => {
    const f = await fixture({ inlineValidationOperationLimit: 0 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    await f.db
      .update(npAgentChangesets)
      .set({ validationGeneration: 2, draftVersion: 2 })
      .where(eq(npAgentChangesets.id, draft.id));
    await f.service.processValidation({ siteId, attemptId: attempt.id });
    expect((await f.db.select().from(npAgentChangesets))[0]).toMatchObject({
      validationGeneration: 2,
      draftVersion: 2,
      state: "validating",
      planHash: null,
    });
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("fails closed when persisted proposal hash no longer matches admitted contents", async () => {
    const f = await fixture({ inlineValidationOperationLimit: 0 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    await f.db
      .update(npAgentChangesets)
      .set({ title: "Mutated after admission" })
      .where(eq(npAgentChangesets.id, draft.id));
    await f.service.processValidation({ siteId, attemptId: attempt.id });
    expect((await oneAttempt(f)).state).toBe("failed");
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).toBeNull();
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("rechecks target visibility before a queued validation reads evidence", async () => {
    const f = await fixture({ inlineValidationOperationLimit: 0 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { ...original.access, read: () => false },
    });
    await f.service.processValidation({ siteId, attemptId: attempt.id });
    expect(await oneAttempt(f)).toMatchObject({ state: "failed", errorCode: "AUTHORITY_REVOKED" });
    expect((await f.db.select().from(npAgentChangesets))[0]!.sealedPlanBody).toBeNull();
  });
  it("does not grant validation to a write-only principal", async () => {
    const f = await fixture();
    const p = await principalFixture(f, true);
    const draft = await p.service.create({ actor: p.actor, command: await command() });
    await expect(
      p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() }),
    ).rejects.toThrow();
    expect(await f.db.select().from(npAgentChangesetValidationAttempts)).toEqual([]);
  });
  it("resolves the current service family head after a token rotation", async () => {
    const f = await fixture();
    const p = await principalFixture(f, false, { inlineValidationOperationLimit: 0 });
    const draft = await p.service.create({ actor: p.actor, command: await command() });
    await p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    await p.gateway.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principal_tokens.rotate",
      parentTargetId: p.principal.resourceId,
      targetId: p.token.resourceId,
      command: { idempotencyKey: randomUUID(), expectedVersion: 1, overlapSeconds: 900 },
    });
    await p.service.processValidation({ siteId, attemptId: attempt.id });
    expect((await oneAttempt(f)).state).toBe("ready");
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).not.toBeNull();
  });
  it("fails queued principal work when its current transport audience changes", async () => {
    const f = await fixture();
    let audience = "urn:nexpress:agent-gateway:stdio";
    const p = await principalFixture(f, false, {
      inlineValidationOperationLimit: 0,
      gateway: { getTransportAudience: async () => audience },
    });
    const draft = await p.service.create({ actor: p.actor, command: await command() });
    await p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() });
    const attempt = await oneAttempt(f);
    audience = "https://other.example/api/agent/v1";
    await p.service.processValidation({ siteId, attemptId: attempt.id });
    expect(await oneAttempt(f)).toMatchObject({ state: "failed", errorCode: "AUTHORITY_REVOKED" });
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).toBeNull();
  });
  it("returns safe invalid evidence when an existing document base changes", async () => {
    const f = await fixture();
    const saved = await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        null,
        { title: "Original", content: npCreateEmptyRichTextContent() },
        f.actor.actor.user,
        { status: "draft" },
      ),
    );
    const documentId = String(saved.doc.id);
    const operation: NpAgentChangeSetOperationInput = {
      kind: "document",
      operation: "update",
      clientOperationId: "update-post",
      reason: null,
      resource: { collection: "posts", documentId },
      base: { version: "placeholder", digest },
      input: { patch: { title: "Proposed" }, targetStatus: null },
    };
    const bases = createAgentChangeSetValidationResourceServiceV1();
    const observed = await f.db.transaction((tx) =>
      bases.readBase({
        tx,
        siteId,
        user: f.actor.actor.user,
        changeSetId: randomUUID(),
        ordinal: 1,
        operation,
        canonicalResourceKey: { kind: "document", collection: "posts", documentId },
      }),
    );
    operation.base = observed.base!;
    const draftInput = { title: "Update proposal", summary: null, operations: [operation] };
    const draft = await f.service.create({ actor: f.actor, command: await command(draftInput) });
    await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        documentId,
        { title: "Changed independently", content: npCreateEmptyRichTextContent() },
        f.actor.actor.user,
        { status: "draft" },
      ),
    );
    const revisionsBefore = await f.db.select().from(npRevisions);
    const invalid = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(invalid.state).toBe("invalid");
    expect(invalid.validation?.state).toBe("invalid");
    expect(
      invalid.operations
        .flatMap((operation) => operation.issues)
        .some((issue) => issue.code === "BASE_CONFLICT"),
    ).toBe(true);
    expect((await f.db.select().from(npAgentChangesets))[0]!.planHash).toBeNull();
    expect(await f.db.select().from(npRevisions)).toHaveLength(revisionsBefore.length);
    expect((await f.db.select().from(postsTable))[0]!.title).toBe("Changed independently");
    await f.db.update(npAgentChangesetValidationAttempts).set({ resultDigest: digest });
    await expect(f.service.get({ actor: f.actor, id: draft.id })).rejects.toMatchObject({
      status: 404,
      code: "CHANGESET_NOT_FOUND",
    });
  });
  it.each(["plan", "snapshot", "result"])(
    "does not project ready evidence after %s tampering",
    async (target) => {
      const f = await fixture();
      const draft = await f.service.create({ actor: f.actor, command: await command() });
      await f.service.validate({ actor: f.actor, id: draft.id, command: validationCommand() });
      if (target === "plan")
        await f.db
          .update(npAgentChangesets)
          .set({ planHash: digest })
          .where(eq(npAgentChangesets.id, draft.id));
      else if (target === "snapshot") {
        const [operation] = await f.db.select().from(npAgentChangesetOperations);
        await f.db
          .update(npAgentChangesetOperations)
          .set({ beforeSnapshot: { ...operation!.beforeSnapshot!, value: { unexpected: true } } })
          .where(eq(npAgentChangesetOperations.id, operation!.id));
      } else await f.db.update(npAgentChangesetValidationAttempts).set({ resultDigest: digest });
      await expect(f.service.get({ actor: f.actor, id: draft.id })).rejects.toMatchObject({
        status: 404,
        code: "CHANGESET_NOT_FOUND",
      });
      expect((await f.service.list({ actor: f.actor })).items).toEqual([]);
      expect(await f.db.select().from(postsTable)).toEqual([]);
    },
  );
  it.each([false, true])(
    "rechecks a real OAuth grant for queued validation (revoked=%s)",
    async (revoked) => {
      const f = await fixture();
      const p = await oauthFixture(f);
      const draft = await p.service.create({ actor: p.actor, command: await command() });
      await p.service.validate({ actor: p.actor, id: draft.id, command: validationCommand() });
      const attempt = await oneAttempt(f);
      expect(attempt.authorityRef.kind).toBe("oauth-grant");
      if (revoked)
        await p.oauth.revokeToken({ siteId, clientId: p.clientId, token: p.tokens.refresh_token });
      await p.service.processValidation({ siteId, attemptId: attempt.id });
      expect((await oneAttempt(f)).state).toBe(revoked ? "failed" : "ready");
      if (revoked) expect((await oneAttempt(f)).errorCode).toBe("AUTHORITY_REVOKED");
      const [row] = await f.db.select().from(npAgentChangesets);
      expect(row!.planHash === null).toBe(revoked);
      expect(await f.db.select().from(postsTable)).toEqual([]);
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
    },
  );
  it("expires ready plans while preserving their immutable sealed evidence", async () => {
    let clock = new Date();
    const f = await fixture({ now: () => clock, eligibilitySeconds: 120 });
    const draft = await f.service.create({ actor: f.actor, command: await command() });
    const ready = await f.service.validate({
      actor: f.actor,
      id: draft.id,
      command: validationCommand(),
    });
    expect(ready.state).toBe("ready");
    const [before] = await f.db.select().from(npAgentChangesets);
    clock = new Date(before!.expiresAt.getTime() + 1);
    expect(await f.service.reconcileExpired({ siteId, limit: 1 })).toMatchObject({ cancelled: 1 });
    const cancelled = await f.service.get({ actor: f.actor, id: draft.id });
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.planHash).toBe(ready.planHash);
    expect(cancelled.validation?.state).toBe("valid");
    const [after] = await f.db.select().from(npAgentChangesets);
    expect(after!.sealedPlanBody).toEqual(before!.sealedPlanBody);
    expect(await npDigestAgentChangeSetPlanCanonical(after!.sealedPlanBody!)).toBe(ready.planHash);
    expect(after!.cancellationCode).toBe("CHANGESET_EXPIRED");
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
});
