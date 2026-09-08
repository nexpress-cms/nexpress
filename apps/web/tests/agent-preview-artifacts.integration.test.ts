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
  return {
    db,
    user,
    changeset,
    attempt,
    service,
    actor: { kind: "staff" as const, siteId, actor: { user: staff!, sessionId: session!.id } },
  };
}
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentChangesetPreviews,
  npAgentPreviewArtifacts,
  npAgentPreviewArtifactUploads,
} from "../../../packages/core/src/db/schema/agent.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  createAgentPreviewArtifactServiceV1,
  npAgentPreviewArtifactDispatchWindowMillisecondsV1,
} from "../../../packages/core/src/agent/preview-artifact-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import type { NpAgentPreviewArtifactStorageAdapterV1 } from "../../../packages/core/src/agent/preview-artifact-contract.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npDigestAgentPreviewContractCanonical } from "../../../packages/core/src/agent-contract/canonical-preview.js";
// eslint-disable-next-line import-x/no-relative-packages
import { serializeAgentCanonicalJson } from "../../../packages/core/src/agent-contract/canonical-foundation.js";
const contract = {
  schemaVersion: "np.agent-preview-contract.v1" as const,
  overlayResolverVersion: 1,
  rendererId: "test",
  rendererVersion: 1,
  rendererFingerprint: "test-renderer",
  screenshotAdapterId: null,
  screenshotAdapterVersion: null,
  screenshotAdapterFingerprint: null,
  routeParserVersion: 1,
  checkRegistryVersion: 1,
  linkAllowlistVersion: 1,
  linkAllowlistOrigins: [],
  networkPolicyVersion: 1,
  artifactLimitsVersion: 1,
  reportSchemaVersion: 1,
  responseHeaderBuilderVersion: 1,
  cspBuilderVersion: 1,
};
async function previewFixture(mode: "committed" | "unknown" | "mismatch" = "committed") {
  const f = await fixture();
  const ready = await f.service.validate({
    actor: f.actor,
    id: f.changeset.id,
    command: { idempotencyKey: randomUUID(), expectedVersion: f.changeset.draftVersion },
  });
  let clock = new Date();
  const stamp = clock;
  const [preview] = await f.db
    .insert(npAgentChangesetPreviews)
    .values({
      siteId,
      changesetId: f.changeset.id,
      planHash: ready.planHash!,
      generation: 1,
      previewContractBody: contract,
      previewContractFingerprint: await npDigestAgentPreviewContractCanonical(contract),
      admittingInvocationId: f.attempt.admittingInvocationId,
      authorizationContextBody: f.attempt.authorizationContextBody,
      authorizationContextFingerprint: f.attempt.authorizationContextFingerprint,
      authorityRef: f.attempt.authorityRef,
      requesterKind: "staff",
      requesterId: f.user.userId,
      requesterFingerprint: f.attempt.requesterFingerprint,
      state: "rendering",
      createdAt: stamp,
      renderingStartedAt: stamp,
      allowedRoutes: [],
      allowedRoutesDigest: digest,
    })
    .returning();
  let puts = 0,
    deletes = 0;
  const objects = new Map<string, Uint8Array>();
  const adapter: NpAgentPreviewArtifactStorageAdapterV1 = {
    id: "test-store",
    contractVersion: 1,
    fingerprint: digest,
    async put({ request, bytes }) {
      puts++;
      objects.set(request.storageKey, new Uint8Array(bytes));
      return { operationRef: "opaque-operation" };
    },
    async resolveOperation() {
      return mode === "unknown"
        ? { status: "unknown", resolvedAt: null, safeCode: null }
        : { status: "committed", resolvedAt: new Date().toISOString(), safeCode: null };
    },
    async stat({ storageKey }) {
      const b = objects.get(storageKey);
      return b
        ? { state: "present", mime: "application/json", bytes: b.byteLength }
        : { state: "absent" };
    },
    async read({ storageKey }) {
      const b = objects.get(storageKey);
      if (!b) throw new Error("absent");
      return {
        bytes: mode === "mismatch" ? new Uint8Array([1]) : new Uint8Array(b),
        mime: "application/json",
      };
    },
    async delete({ storageKey }) {
      deletes++;
      return { status: objects.delete(storageKey) ? "deleted" : "already_absent" };
    },
  };
  const service = createAgentPreviewArtifactServiceV1({
    storageAdapter: adapter,
    now: () => clock,
    resolveAdapter: () => adapter,
    withPreviewAuthority: async (input) =>
      f.db.transaction(async (db) => {
        const [p] = await db
          .select()
          .from(npAgentChangesetPreviews)
          .where(
            and(
              eq(npAgentChangesetPreviews.siteId, input.siteId),
              eq(npAgentChangesetPreviews.id, input.previewId),
            ),
          )
          .for("update");
        if (!p) throw new Error("missing");
        return input.mutate(db as unknown as typeof f.db, p);
      }),
  });
  const bytes = new TextEncoder().encode(
    serializeAgentCanonicalJson({
      schemaVersion: "np.agent-preview-report.v1",
      siteId,
      changeSetId: f.changeset.id,
      previewId: preview!.id,
      generation: 1,
      planHash: ready.planHash,
      previewContractFingerprint: preview!.previewContractFingerprint,
      part: 1,
      totalParts: 1,
      generatedAt: stamp.toISOString(),
      results: [],
      issues: [],
    }),
  );
  const input = {
    kind: "report" as const,
    route: null,
    locale: null,
    viewport: null,
    reportPart: 1,
    reportTotalParts: 1,
    mime: "application/json" as const,
    bytes,
  };
  return {
    ...f,
    service,
    preview: preview!,
    input,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    puts: () => puts,
    deletes: () => deletes,
  };
}
describe.skipIf(skipIfNoTestDb())("Preview artifact persistence and storage journal", () => {
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
  it("performs one PUT and publishes verified report bytes atomically", async () => {
    const f = await previewFixture(),
      r = await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] });
    expect(
      await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] }),
    ).toEqual(r);
    await expect(
      f.service.readArtifact({
        siteId,
        previewId: f.preview.id,
        artifactId: r.uploads[0]!.artifactId,
        authorize: async () => {},
      }),
    ).rejects.toThrow();
    await f.service.dispatch({ siteId, uploadId: r.uploads[0]!.uploadId, bytes: f.input.bytes });
    await f.service.dispatch({ siteId, uploadId: r.uploads[0]!.uploadId, bytes: f.input.bytes });
    expect(f.puts()).toBe(1);
    await f.service.finalize({ siteId, previewId: f.preview.id });
    expect(
      (
        await f.service.readArtifact({
          siteId,
          previewId: f.preview.id,
          artifactId: r.uploads[0]!.artifactId,
          authorize: async () => {},
        })
      ).bytes,
    ).toEqual(f.input.bytes);
    await expect(
      f.service.readArtifact({
        siteId: "validation-other",
        previewId: f.preview.id,
        artifactId: r.uploads[0]!.artifactId,
        authorize: async () => {},
      }),
    ).rejects.toThrow();
  });
  it("bounds unknown-write inspections and never retries PUT or permits deletion", async () => {
    const f = await previewFixture("unknown"),
      r = await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] });
    await f.service.dispatch({ siteId, uploadId: r.uploads[0]!.uploadId, bytes: f.input.bytes });
    for (let i = 0; i < 8; i++)
      await f.service.reconcileUpload({ siteId, uploadId: r.uploads[0]!.uploadId });
    expect(f.puts()).toBe(1);
    const [u] = await f.db.select().from(npAgentPreviewArtifactUploads);
    expect(u!.attempt).toBe(5);
    expect(u!.state).toBe("waiting_inspection");
    await expect(f.service.finalize({ siteId, previewId: f.preview.id })).rejects.toThrow();
    await expect(npDeleteAgentSiteRows(f.db, siteId)).rejects.toThrow();
  });
  it("keeps mismatched bytes cleanup-owned until a confirmed deletion receipt", async () => {
    const f = await previewFixture("mismatch"),
      r = await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] });
    await f.service.dispatch({ siteId, uploadId: r.uploads[0]!.uploadId, bytes: f.input.bytes });
    const [a] = await f.db.select().from(npAgentPreviewArtifacts);
    expect(a!.objectState).toBe("delete_pending");
    await f.service.reconcilePreviewCleanup({ siteId, previewId: f.preview.id });
    const [deleted] = await f.db.select().from(npAgentPreviewArtifacts);
    expect(deleted!.objectState).toBe("absent");
    expect(deleted!.deleteReceiptDigest).toMatch(/^adr1:/);
    expect(f.deletes()).toBe(1);
  });
  it("reserves and finalizes empty sets without storage calls", async () => {
    const f = await previewFixture();
    await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [] });
    await f.service.finalize({ siteId, previewId: f.preview.id });
    expect(f.puts()).toBe(0);
    const [p] = await f.db.select().from(npAgentChangesetPreviews);
    expect(p!.state).toBe("ready");
    expect(p!.expectedArtifactCount).toBe(0);
    expect(p!.digest).toMatch(/^cj1:/);
  });
  it("enforces preview and artifact same-site, state and immutable reservation constraints", async () => {
    const f = await previewFixture();
    await expect(
      f.db
        .update(npAgentChangesetPreviews)
        .set({ state: "ready" })
        .where(eq(npAgentChangesetPreviews.id, f.preview.id)),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentChangesetPreviews)
        .set({ renderingStartedAt: null })
        .where(eq(npAgentChangesetPreviews.id, f.preview.id)),
    ).rejects.toThrow();
    const r = await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] });
    await expect(
      f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [] }),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentPreviewArtifacts)
        .set({ siteId: "validation-other" })
        .where(eq(npAgentPreviewArtifacts.id, r.uploads[0]!.artifactId)),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentPreviewArtifacts)
        .set({ objectState: "ready" })
        .where(eq(npAgentPreviewArtifacts.id, r.uploads[0]!.artifactId)),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentPreviewArtifactUploads)
        .set({ state: "succeeded" })
        .where(eq(npAgentPreviewArtifactUploads.id, r.uploads[0]!.uploadId)),
    ).rejects.toThrow();
  });
  it("fails closed when frozen contract or full upload set is tampered", async () => {
    const f = await previewFixture(),
      r = await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] });
    await f.db
      .update(npAgentPreviewArtifactUploads)
      .set({ uploadSetDigest: "aus1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })
      .where(eq(npAgentPreviewArtifactUploads.id, r.uploads[0]!.uploadId));
    await expect(
      f.service.dispatch({ siteId, uploadId: r.uploads[0]!.uploadId, bytes: f.input.bytes }),
    ).rejects.toThrow();
    expect(f.puts()).toBe(0);
    await f.db
      .update(npAgentChangesetPreviews)
      .set({ previewContractBody: { ...contract, rendererVersion: 2 } })
      .where(eq(npAgentChangesetPreviews.id, f.preview.id));
    await expect(
      f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] }),
    ).rejects.toThrow();
  });
  it("cancels undispatched source loss only after the complete bounded dispatch window", async () => {
    const f = await previewFixture(),
      r = await f.service.reserve({ siteId, previewId: f.preview.id, artifacts: [f.input] });
    f.advance(npAgentPreviewArtifactDispatchWindowMillisecondsV1 - 1);
    await f.service.reconcileUpload({ siteId, uploadId: r.uploads[0]!.uploadId });
    let [u] = await f.db.select().from(npAgentPreviewArtifactUploads);
    expect(u!.state).toBe("queued");
    f.advance(1);
    await Promise.all([
      f.service.reconcileUpload({ siteId, uploadId: r.uploads[0]!.uploadId }),
      f.service.dispatch({ siteId, uploadId: r.uploads[0]!.uploadId, bytes: f.input.bytes }),
    ]);
    [u] = await f.db.select().from(npAgentPreviewArtifactUploads);
    expect(u!.state).toBe("cancelled");
    expect(u!.attempt).toBe(0);
    expect(u!.adapterOperationStatus).toBe("not_dispatched");
    expect(f.puts()).toBe(0);
    const [p] = await f.db.select().from(npAgentChangesetPreviews);
    expect(p!.state).toBe("failed");
    expect(p!.errorCode).toBe("PREVIEW_FAILED");
    await f.service.reconcilePreviewCleanup({ siteId, previewId: f.preview.id });
    expect(f.deletes()).toBe(0);
  });
});
