/* eslint-disable import-x/no-relative-packages */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import {
  fixture,
  principalFixture,
  draft,
  command,
  previewConfiguration,
  readyPreview,
  siteId,
} from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
  getTestDatabaseUrl,
  seedUser,
} from "./harness.js";
import {
  npAgentChangesetPreviews,
  npAgentPrincipals,
  npAgentPreviewArtifacts,
  npAgentPreviewArtifactUploads,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions, npRevisions } from "../../../packages/core/src/db/schema/system.js";
import { postsTable } from "../src/db/generated/collections.js";
import type {
  NpAgentChangeSetActorV1,
  NpAgentChangeSetServiceV1,
} from "../../../packages/core/src/agent/changeset-service.js";
import {
  createDbConnection,
  npCloseDbConnection,
} from "../../../packages/core/src/db/connection.js";
import { setDb } from "../../../packages/core/src/db/runtime.js";
import {
  findDocuments,
  saveDocument,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { npGetAgentChangeSetPreviewContext } from "../../../packages/core/src/agent/changeset-preview-overlay.js";
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { grantSiteMembership } from "@nexpress/core";
const route = { route: "/", locale: null, audience: "public" as const };
async function queued(
  f: { service: NpAgentChangeSetServiceV1; actor: NpAgentChangeSetActorV1 },
  value = draft(),
) {
  const draft = await f.service.create({ actor: f.actor, command: await command(value) });
  const sealed = await f.service.validate({
    actor: f.actor,
    id: draft.id,
    command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
  });
  const request = {
    idempotencyKey: randomUUID(),
    expectedVersion: 1,
    expectedPlanHash: sealed.planHash,
  };
  return {
    detail: await f.service.preview({ actor: f.actor, id: draft.id, command: request }),
    request,
    sealed,
  };
}
describe.skipIf(skipIfNoTestDb())("ChangeSet preview generation", () => {
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
  it("uses the sealed plan, atomic empty reservation and honest unavailable screenshot evidence", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const detail = await readyPreview(f);
    expect(detail).toMatchObject({
      state: "ready",
      artifactCount: 0,
      artifactRefs: [],
      interactiveLaunch: null,
      diffSummary: { operationCount: 1 },
      checkSummary: {
        checksRun: 0,
        screenshots: 0,
        warningCodes: ["SCREENSHOTS_UNAVAILABLE", "CHECKS_NOT_RUN"],
      },
    });
    const [row] = await f.db.select().from(npAgentChangesetPreviews);
    expect(row.expectedArtifactCount).toBe(0);
    expect(row.uploadSetDigest).toMatch(/^aus1:sha256:/);
    expect(row.digest).toBe(detail.digest);
    expect(await f.db.select().from(npAgentPreviewArtifacts)).toEqual([]);
    expect(await f.db.select().from(npAgentPreviewArtifactUploads)).toEqual([]);
    expect(await f.db.select().from(postsTable)).toEqual([]);
    expect(await f.db.select().from(npRevisions)).toEqual([]);
    expect(
      (await f.service.get({ actor: f.actor, id: detail.changeSetId })).preview?.previewId,
    ).toBe(detail.previewId);
  });
  it("reuses idempotent admission and rejects changed plan/version preconditions", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const { detail, request, sealed } = await queued(f);
    expect(
      (await f.service.preview({ actor: f.actor, id: sealed.id, command: request })).previewId,
    ).toBe(detail.previewId);
    expect(await f.db.select().from(npAgentChangesetPreviews)).toHaveLength(1);
    await expect(
      f.service.preview({
        actor: f.actor,
        id: sealed.id,
        command: { ...request, expectedVersion: 2 },
      }),
    ).rejects.toThrow();
    await expect(
      f.service.preview({
        actor: f.actor,
        id: sealed.id,
        command: {
          ...request,
          idempotencyKey: randomUUID(),
          expectedPlanHash: `cj1:sha256:${"a".repeat(43)}`,
        },
      }),
    ).rejects.toThrow();
  });
  it("never substitutes the creator for a revoked admitting session", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const { detail } = await queued(f);
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    expect(await f.service.processPreview({ siteId, previewId: detail.previewId })).toEqual({
      state: "failed",
    });
    const [row] = await f.db.select().from(npAgentChangesetPreviews);
    expect(row.errorCode).toBe("AUTHORITY_REVOKED");
    expect(await f.db.select().from(npAgentPreviewArtifacts)).toEqual([]);
  });
  it("distinguishes a changed preview contract from revoked requester authority", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const { detail } = await queued(f);
    await f.db
      .update(npAgentChangesetPreviews)
      .set({ previewContractBody: { ...previewConfiguration().contract, rendererVersion: 2 } })
      .where(eq(npAgentChangesetPreviews.id, detail.previewId));
    expect(await f.service.processPreview({ siteId, previewId: detail.previewId })).toEqual({
      state: "failed",
    });
    const [row] = await f.db.select().from(npAgentChangesetPreviews);
    expect(row.errorCode).toBe("CONTRACT_CHANGED");
    expect(await f.db.select().from(npAgentPreviewArtifacts)).toEqual([]);
  });
  it("rejects cross-site reads and tampered frozen contracts", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const detail = await readyPreview(f);
    await expect(
      f.service.getPreview({
        actor: { ...f.actor, siteId: "draft-other" },
        previewId: detail.previewId,
      }),
    ).rejects.toThrow();
    await f.db
      .update(npAgentChangesetPreviews)
      .set({ previewContractBody: { ...previewConfiguration().contract, rendererVersion: 2 } })
      .where(eq(npAgentChangesetPreviews.id, detail.previewId));
    await expect(
      f.service.getPreview({ actor: f.actor, previewId: detail.previewId }),
    ).rejects.toThrow();
  });
  it("expires ready evidence at its exact deadline and reconciles it", async () => {
    let time = new Date();
    const f = await fixture({
      preview: previewConfiguration(),
      eligibilitySeconds: 3600,
      now: () => time,
    });
    const detail = await readyPreview(f);
    time = new Date(detail.expiresAt!);
    expect(
      (await f.service.getPreview({ actor: f.actor, previewId: detail.previewId })).state,
    ).toBe("expired");
    await f.service.reconcilePreviews({ siteId });
    const [row] = await f.db.select().from(npAgentChangesetPreviews);
    expect(row.state).toBe("expired");
    expect(row.expiresAt?.toISOString()).toBe(detail.expiresAt);
  });
  it("admits, processes, reads and renders a sealed create through a single-connection pool", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const created = await f.service.create({ actor: f.actor, command: await command(draft()) });
    const sealed = await f.service.validate({
      actor: f.actor,
      id: created.id,
      command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
    });
    const connectionString = getTestDatabaseUrl();
    if (!connectionString) throw new Error("Test database required");
    const single = createDbConnection({
      connectionString,
      poolOptions: { max: 1, connectionTimeoutMillis: 1000 },
    });
    setDb(single);
    try {
      const admitted = await f.service.preview({
        actor: f.actor,
        id: sealed.id,
        command: {
          idempotencyKey: randomUUID(),
          expectedVersion: 1,
          expectedPlanHash: sealed.planHash,
        },
      });
      expect(admitted.state).toBe("queued");
      expect(await f.service.processPreview({ siteId, previewId: admitted.previewId })).toEqual({
        state: "ready",
      });
      const detail = await f.service.getPreview({ actor: f.actor, previewId: admitted.previewId });
      expect(detail.state).toBe("ready");
      expect((await f.service.get({ actor: f.actor, id: sealed.id })).preview?.previewId).toBe(
        detail.previewId,
      );
      const rendered = await f.service.renderPreview({
        siteId,
        previewId: detail.previewId,
        route,
        render: async (context) => {
          expect(await context.tx.execute(sql`show transaction_read_only`)).toMatchObject({
            rows: [{ transaction_read_only: "on" }],
          });
          expect(context.snapshots[0].presence).toBe("absent");
          expect(context.plan.body.operations[0].beforeHash).toBeNull();
          const docs = await findDocuments(
            "posts",
            { where: { status: "draft" } },
            f.actor.actor.user,
          );
          expect(docs.docs).toMatchObject([{ title: "Proposed post", status: "draft" }]);
          return "render-complete";
        },
      });
      expect(rendered).toBe("render-complete");
      expect(await single.select().from(postsTable)).toEqual([]);
    } finally {
      setDb(f.db);
      await npCloseDbConnection(single);
    }
  });
  it("rejects a changed persisted base before invoking the renderer", async () => {
    const f = await fixture({ preview: previewConfiguration() });
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
    const value = draft();
    const operation = {
      clientOperationId: "update",
      reason: null,
      kind: "document" as const,
      operation: "update" as const,
      resource: { collection: "posts", documentId },
      base: { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` },
      input: { patch: { title: "Proposed" }, targetStatus: null },
    };
    const current = await createAgentChangeSetValidationResourceServiceV1().readBase({
      tx: f.db as unknown as NpTransaction,
      siteId,
      user: f.actor.actor.user,
      changeSetId: randomUUID(),
      ordinal: 1,
      operation,
      canonicalResourceKey: { kind: "document", collection: "posts", documentId },
    });
    if (!current.base) throw new Error("Expected existing base");
    value.operations = [{ ...operation, base: current.base }];
    const { detail } = await queued(f, value);
    await f.service.processPreview({ siteId, previewId: detail.previewId });
    await withCurrentSite(siteId, () =>
      saveDocument("posts", documentId, { title: "Changed after validation" }, f.actor.actor.user),
    );
    const render = vi.fn(() => Promise.resolve("must not return"));
    await expect(
      f.service.renderPreview({ siteId, previewId: detail.previewId, route, render }),
    ).rejects.toThrow();
    expect(render).not.toHaveBeenCalled();
  });
  it("rechecks the admitting staff session after rendering before releasing output", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const detail = await readyPreview(f);
    let rendered = false;
    await expect(
      f.service.renderPreview({
        siteId,
        previewId: detail.previewId,
        route,
        render: async () => {
          rendered = true;
          await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
          return "private output";
        },
      }),
    ).rejects.toThrow();
    expect(rendered).toBe(true);
  });
  it("rechecks the distinct viewer session after rendering without borrowing requester authority", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const detail = await readyPreview(f);
    const viewer = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, viewer.userId, "admin");
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, viewer.userId));
    let rendered = false;
    await expect(
      f.service.renderPreview({
        siteId,
        previewId: detail.previewId,
        route,
        viewer: { userId: viewer.userId, sessionId: session.id },
        render: async () => {
          rendered = true;
          await f.db.delete(npSessions).where(eq(npSessions.id, session.id));
          return "private output";
        },
      }),
    ).rejects.toThrow();
    expect(rendered).toBe(true);
    expect(
      (await f.service.getPreview({ actor: f.actor, previewId: detail.previewId })).state,
    ).toBe("ready");
  });
  it("rechecks a service principal's live status after rendering", async () => {
    const f = await fixture();
    const principal = await principalFixture(f, false, { preview: previewConfiguration() });
    const { detail } = await queued(principal);
    await principal.service.processPreview({ siteId, previewId: detail.previewId });
    let rendered = false;
    await expect(
      principal.service.renderPreview({
        siteId,
        previewId: detail.previewId,
        route,
        render: async () => {
          rendered = true;
          await f.db
            .update(npAgentPrincipals)
            .set({ status: "suspended" })
            .where(eq(npAgentPrincipals.id, principal.principal.resourceId));
          return "private output";
        },
      }),
    ).rejects.toThrow();
    expect(rendered).toBe(true);
  });
  it("bounds a stalled host renderer and fences its delayed continuation after transaction closure", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const detail = await readyPreview(f);
    const schedule = setTimeout;
    const timer = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) =>
        schedule(callback, typeof delay === "number" && delay > 100000 ? 20 : delay, ...args),
      );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let continuation!: Promise<string>;
    try {
      await expect(
        f.service.renderPreview({
          siteId,
          previewId: detail.previewId,
          route,
          render: () => {
            continuation = gate.then(() => {
              expect(() => npGetAgentChangeSetPreviewContext()).toThrow("Preview is unavailable");
              return "late output";
            });
            return continuation;
          },
        }),
      ).rejects.toThrow();
      release();
      await expect(continuation).resolves.toBe("late output");
      expect(await f.db.select().from(postsTable)).toEqual([]);
    } finally {
      timer.mockRestore();
      release?.();
    }
  });
  it("drains older ready and failed rows with a site-bound cursor without starving queued work", async () => {
    const f = await fixture({ preview: previewConfiguration() });
    const ready = await readyPreview(f);
    await f.db
      .update(npAgentChangesetPreviews)
      .set({ createdAt: new Date(Date.now() - 60000) })
      .where(eq(npAgentChangesetPreviews.id, ready.previewId));
    const failed = await queued(f);
    await f.db
      .update(npAgentChangesetPreviews)
      .set({ state: "failed", completedAt: new Date(), errorCode: "PREVIEW_FAILED" })
      .where(eq(npAgentChangesetPreviews.id, failed.detail.previewId));
    const waiting = await queued(f);
    const cleanup = vi
      .spyOn(f.service.artifacts, "reconcilePreviewCleanup")
      .mockRejectedValue(new Error("Inspection pending"));
    try {
      const first = await f.service.reconcilePreviews({ siteId, limit: 1 });
      expect(first).toMatchObject({ examined: 1, completed: 0 });
      expect(first.nextCursor).not.toBeNull();
      await expect(
        f.service.reconcilePreviews({ siteId: "draft-other", limit: 1, cursor: first.nextCursor! }),
      ).rejects.toThrow();
      await expect(
        f.service.reconcilePreviews({ siteId, limit: 2, cursor: first.nextCursor! }),
      ).rejects.toThrow();
      const second = await f.service.reconcilePreviews({
        siteId,
        limit: 1,
        cursor: first.nextCursor!,
      });
      expect(second).toMatchObject({ examined: 1, completed: 0 });
      expect(second.nextCursor).not.toBeNull();
      expect(cleanup).toHaveBeenCalledWith({ siteId, previewId: failed.detail.previewId });
      const third = await f.service.reconcilePreviews({
        siteId,
        limit: 1,
        cursor: second.nextCursor!,
      });
      expect(third).toMatchObject({ examined: 1, completed: 1 });
      const [current] = await f.db
        .select()
        .from(npAgentChangesetPreviews)
        .where(eq(npAgentChangesetPreviews.id, waiting.detail.previewId));
      expect(current.state).toBe("ready");
      expect(
        await f.service.reconcilePreviews({ siteId, limit: 1, cursor: third.nextCursor! }),
      ).toEqual({ examined: 0, completed: 0, nextCursor: null });
    } finally {
      cleanup.mockRestore();
    }
  });
});
