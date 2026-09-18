import { generateKeyPairSync, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentChangesetValidationAttempts,
  npAgentChangesetPreviews,
  npAgentPreviewArtifacts,
  npAgentPreviewArtifactUploads,
  npAgentPreviewRenderSessions,
  npAgentInvocations,
  npAgentRuns,
  npAgentSourceReleases,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { createAgentChangeSetServiceV1 } from "../../../packages/core/src/agent/changeset-service.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { createAgentPreviewAccessServiceV1 } from "../../../packages/core/src/agent/preview-access-service.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import {
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
} from "../../../packages/core/src/agent-contract/installed-capability-contract.js";
import {
  runtimeDefinition,
  runtimeFixture,
  runtimeFingerprint,
  runtimeRecipes,
  siteId,
} from "./agent-runtime-service-fixture.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { previewConfiguration, previewStorageFixture } from "./agent-changeset-fixture.js";

const day = 86_400_000;
async function proposal(withPreview = true, renderSession = false, separateRequester = false) {
  const definition = runtimeDefinition();
  definition.autonomy = "approved";
  definition.scopes = [
    "changeset:read",
    "changeset:write",
    "settings:read",
    "settings:write",
    "site:read",
  ];
  definition.capabilityModes = ["changeset.create", "changeset.preview", "changeset.validate"].map(
    (capabilityId) => ({
      capabilityId: capabilityId as "changeset.create" | "changeset.validate" | "changeset.preview",
      mode: "approved",
    }),
  );
  const recipes = runtimeRecipes();
  recipes.recipes[0].capabilityIds = definition.capabilityModes.map((row) => row.capabilityId);
  const f = await runtimeFixture(undefined, true, {
    delegated: true,
    definition,
    recipes,
    maxCapabilityCalls: 4,
    maxAttempts: 4,
  });
  const storage = previewStorageFixture();
  const configuration = previewConfiguration();
  let storageUnavailable = false;
  const adapter = {
    ...storage.adapter,
    delete: (input: Parameters<typeof storage.adapter.delete>[0]) =>
      storageUnavailable
        ? Promise.reject(new Error("Fixture storage outcome unknown"))
        : storage.adapter.delete(input),
  };
  const service = createAgentChangeSetServiceV1({
    cursorKey: new Uint8Array(32).fill(44),
    preview: {
      ...configuration,
      storageAdapter: adapter,
      resolveAdapter: () => adapter,
      checks: {
        rendererId: configuration.contract.rendererId,
        rendererVersion: configuration.contract.rendererVersion,
        rendererFingerprint: configuration.contract.rendererFingerprint,
        productionOrigins: ["https://site.example"],
        resolveManifest: () => Promise.resolve([{ route: "/", locale: null, audience: "public" }]),
        render: () =>
          Promise.resolve(
            '<html lang="en"><head><title>Review</title><meta name="description" content="Review"></head><body><main>Preview</main></body></html>',
          ),
      },
    },
    runtimeAdmission: f.admission,
    now: f.options.now,
    reauthentication: {
      verify: () => ({
        reauthenticatedAt: f.options.now().toISOString(),
        sessionFactFingerprint: runtimeFingerprint,
      }),
    },
    approvals: {
      integrityKeys: {
        active: {
          owner: "approval-integrity",
          id: "cancelled-retention",
          bytes: new Uint8Array(32).fill(71),
        },
      },
      challengeKeys: { active: { id: "cancelled-retention", key: new Uint8Array(32).fill(73) } },
      lifetimeSeconds: 600,
      resolveExecutionBinding: ({ intendedOperation }) =>
        Promise.resolve(
          npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(`changeset.${intendedOperation}`),
        ),
    },
    execution: {
      resolveIntent: () => Promise.resolve({ enabled: true, paused: false }),
      verificationFingerprint: runtimeFingerprint,
      verifyConvergence: () => Promise.resolve({ status: "passed", evidenceRefs: [] }),
    },
  });
  const store = createAgentRuntimeExecutionStoreV1({ admission: f.admission, now: f.options.now });
  const admitted = await f.admission.admit(f.runInput);
  const input = { siteId, runId: admitted.runId };
  const acquired = await store.claim(input);
  if (!acquired.claim) throw new Error("Expected real Runtime claim");
  let claimed = { ...input, claim: acquired.claim };
  const request = npRequireAgentInstalledCapabilityInvocationRequestV1({
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId: "changeset.create",
    arguments: {
      idempotencyKey: randomUUID(),
      input: {
        title: "Cancelled proposal retention",
        summary: null,
        operations: [
          {
            kind: "setting",
            operation: "replace",
            clientOperationId: "seo",
            reason: null,
            resource: { key: "seo" },
            base: null,
            input: {
              value: { defaultOgImage: null, twitterHandle: "retained", defaultLocale: "en" },
            },
          },
        ],
      },
    },
  }) as NpAgentChangeSetCapabilityInvocationRequestV1;
  const result = await service.invokeRuntimeCapability({ ...claimed, sequence: 1, request });
  if (!("changeSet" in result.output)) throw new Error("Expected actual ChangeSet proposal");
  const draft = result.output.changeSet;
  if (separateRequester) {
    await store.transition({ ...claimed, state: "succeeded" });
    const second = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
    const requester = { siteId, runId: second.runId };
    const nextClaim = await store.claim(requester);
    if (!nextClaim.claim) throw new Error("Expected separate requester Run claim");
    claimed = { ...requester, claim: nextClaim.claim };
  }
  const invoke = (
    capabilityId: "changeset.validate" | "changeset.preview",
    input: unknown,
    sequence: number,
  ) =>
    service.invokeRuntimeCapability({
      ...claimed,
      sequence,
      request: npRequireAgentInstalledCapabilityInvocationRequestV1({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId,
        arguments: { input, idempotencyKey: randomUUID() },
      }) as NpAgentChangeSetCapabilityInvocationRequestV1,
    });
  const validated = await invoke(
    "changeset.validate",
    { changeSetId: draft.id, draftVersion: draft.draftVersion, draftHash: draft.draftHash },
    separateRequester ? 1 : 2,
  );
  if (!("changeSet" in validated.output)) throw new Error("Expected validated ChangeSet");
  const sealed = validated.output.changeSet;
  if (withPreview) {
    await invoke(
      "changeset.preview",
      { changeSetId: draft.id, planHash: sealed.planHash },
      separateRequester ? 2 : 3,
    );
    const [preview] = await f.db
      .select()
      .from(npAgentChangesetPreviews)
      .where(eq(npAgentChangesetPreviews.changesetId, draft.id));
    if (renderSession) {
      const access = createAgentPreviewAccessServiceV1({
        changesets: service,
        previewOrigin: "https://preview.example.net",
        servedOrigins: ["https://site.example.com"],
        siteOrigin: async () => "https://site.example.com",
        signingKeys: { active: { id: "validated-retention", ...generateKeyPairSync("ed25519") } },
        sessionKeys: { active: { id: "session.1", key: new Uint8Array(32).fill(1) } },
        exchangeKeys: { active: { id: "exchange.1", key: new Uint8Array(32).fill(2) } },
        renderCookieKeys: { active: { id: "render-cookie.1", key: new Uint8Array(32).fill(3) } },
        captureKeys: { active: { id: "capture.1", key: new Uint8Array(32).fill(4) } },
        reauthentication: { verify: () => true },
        now: f.options.now,
        capturePlan: (row) => [
          {
            ordinal: 1,
            route: row.allowedRoutes[0].route,
            locale: row.allowedRoutes[0].locale,
            audience: "public",
            viewportName: "desktop",
            width: 1280,
            height: 720,
            deviceScaleFactor: 1,
          },
        ],
      });
      const origin = "https://127.0.0.1:39841";
      const lease = await access.prepareRender({ siteId, previewId: preview.id, origin });
      await lease.use(async (prepared) => {
        const bootstrapped = await access.bootstrapRender({
          token: prepared.token,
          origin,
          body: prepared.bootstrapInput,
        });
        await access.consumeCapture({
          renderSessionId: prepared.renderSessionId,
          ordinal: 1,
          cookie: bootstrapped.cookie.split(";", 1)[0],
          ticket: prepared.captures[0].ticket,
        });
      });
    }
    expect(await service.processPreview({ siteId, previewId: preview.id })).toEqual({
      state: "ready",
    });
  }
  await store.transition({ ...claimed, state: "succeeded" });
  const cancel = () =>
    service.cancel({
      actor: f.actor,
      id: draft.id,
      command: {
        schemaVersion: "np.agent-changeset-cancel-input.v1",
        expectedDraftVersion: draft.draftVersion,
        expectedState: "ready",
        planHash: sealed.planHash,
        reasonCode: "OPERATOR_CANCELLED",
        reason: null,
        idempotencyKey: randomUUID(),
      },
    });
  const now = new Date(f.options.now().getTime() + 91 * day);
  const sweep = (time = now, targetSite = siteId) =>
    pruneAgentRuntimeEventsV1({ siteId: targetSite, now: time });
  return {
    ...f,
    service,
    input,
    requesterRunId: claimed.runId,
    draft,
    sealed,
    result,
    cancel,
    now,
    sweep,
    storage,
    setStorageUnavailable: (value: boolean) => {
      storageUnavailable = value;
    },
  };
}

/** Model a fresh login at the advanced fixture clock without extending the original session. */
async function refreshViewerSession(f: Awaited<ReturnType<typeof proposal>>) {
  const [original] = await f.db
    .select()
    .from(npSessions)
    .where(eq(npSessions.id, f.actor.actor.sessionId));
  const id = randomUUID();
  const current = f.options.now();
  await f.db
    .insert(npSessions)
    .values({
      ...original,
      id,
      accessTokenHash: randomUUID(),
      refreshTokenHash: randomUUID(),
      createdAt: current,
      updatedAt: current,
      accessExpiresAt: new Date(current.getTime() + day),
      refreshExpiresAt: new Date(current.getTime() + 7 * day),
    });
  f.actor.actor.sessionId = id;
}

async function evidence(f: Awaited<ReturnType<typeof proposal>>) {
  return {
    invocations: await f.db.select().from(npAgentInvocations).orderBy(npAgentInvocations.id),
    audits: await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id),
    attempts: await f.db
      .select()
      .from(npAgentChangesetValidationAttempts)
      .orderBy(npAgentChangesetValidationAttempts.id),
    previews: await f.db
      .select()
      .from(npAgentChangesetPreviews)
      .orderBy(npAgentChangesetPreviews.id),
    operations: await f.db
      .select()
      .from(npAgentChangesetOperations)
      .orderBy(npAgentChangesetOperations.id),
    artifacts: await f.db
      .select()
      .from(npAgentPreviewArtifacts)
      .orderBy(npAgentPreviewArtifacts.id),
    uploads: await f.db
      .select()
      .from(npAgentPreviewArtifactUploads)
      .orderBy(npAgentPreviewArtifactUploads.id),
  };
}

describe.skipIf(skipIfNoTestDb())("Validated Runtime ChangeSet source retention", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it.each(["validated cancellation", "preview expiry"] as const)(
    "releases %s while retaining canonical evidence, current item access and consumed keys",
    async (kind) => {
      const f = await proposal(kind === "preview expiry");
      if (kind === "validated cancellation") await f.cancel();
      f.advance(91 * 86_400);
      await refreshViewerSession(f);
      if (kind === "preview expiry") {
        expect((await f.service.reconcileExpired({ siteId })).cancelled).toBe(1);
        expect((await f.sweep()).pruned).toBe(0);
        await f.service.reconcilePreviews({ siteId });
        expect(f.storage.objects.size).toBe(0);
      }
      if (kind === "validated cancellation") {
        const [original] = await f.db
          .select()
          .from(npAgentChangesets)
          .where(eq(npAgentChangesets.id, f.draft.id));
        await f.db
          .update(npAgentChangesets)
          .set({ agentConfigHash: runtimeFingerprint })
          .where(eq(npAgentChangesets.id, f.draft.id));
        expect((await f.sweep()).pruned).toBe(0);
        await f.db
          .update(npAgentChangesets)
          .set({ agentConfigHash: original.agentConfigHash })
          .where(eq(npAgentChangesets.id, f.draft.id));
      }
      const before = await evidence(f);
      const [changeSet] = await f.db
        .select()
        .from(npAgentChangesets)
        .where(eq(npAgentChangesets.id, f.draft.id));
      const actions = await f.db.select().from(npAgentActions).orderBy(npAgentActions.id);
      expect((await f.sweep(f.now, "draft-other")).pruned).toBe(0);
      expect((await f.sweep()).pruned).toBe(1);
      expect(
        await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.input.runId)),
      ).toEqual([]);
      const [release] = await f.db
        .select()
        .from(npAgentSourceReleases)
        .where(eq(npAgentSourceReleases.sourceId, f.input.runId));
      expect(release).toMatchObject({ siteId, sourceKind: "runtime-run" });
      expect(await evidence(f)).toEqual(before);
      expect(
        await f.db.select().from(npAgentChangesets).where(eq(npAgentChangesets.id, f.draft.id)),
      ).toEqual([{ ...changeSet, runId: null, runSourceReleaseId: release.id }]);
      expect(await f.db.select().from(npAgentActions).orderBy(npAgentActions.id)).toEqual(
        actions.map((action) => ({ ...action, runId: null, runSourceReleaseId: release.id })),
      );
      expect(await f.service.get({ actor: f.actor, id: f.draft.id })).toMatchObject({
        id: f.draft.id,
        state: "cancelled",
      });
      const activity = createAgentActivityServiceV1({
        cursorHmacKey: new Uint8Array(32).fill(61),
        now: f.options.now,
        changesets: f.service,
      });
      await expect(
        activity.getRun({ siteId, actor: f.actor.actor, id: f.input.runId }),
      ).resolves.toMatchObject({
        schemaVersion: "np.agent-activity-run-expired.v1",
        runId: f.input.runId,
        evidence: "expired",
      });
      await expect(
        activity.getRun({ siteId: "draft-other", actor: f.actor.actor, id: f.input.runId }),
      ).rejects.toMatchObject({ status: 404 });
      const hidden = createAgentActivityServiceV1({
        cursorHmacKey: new Uint8Array(32).fill(61),
        now: f.options.now,
        changesets: { get: () => Promise.reject(new Error("Current item access denied")) },
      });
      await expect(
        hidden.getRun({ siteId, actor: f.actor.actor, id: f.input.runId }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(f.admission.admit(f.runInput)).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_REUSED",
      });
      const [attempt] = before.attempts;
      await expect(
        f.db
          .delete(npAgentChangesetValidationAttempts)
          .where(eq(npAgentChangesetValidationAttempts.id, attempt.id)),
      ).rejects.toThrow();
      await expect(
        f.db
          .update(npAgentChangesetOperations)
          .set({ reason: "Altered retained evidence" })
          .where(eq(npAgentChangesetOperations.changesetId, f.draft.id)),
      ).rejects.toThrow();
      if (before.previews[0])
        await expect(
          f.db
            .delete(npAgentChangesetPreviews)
            .where(eq(npAgentChangesetPreviews.id, before.previews[0].id)),
        ).rejects.toThrow();
      expect((await npCollectAgentHealthSummaryV1({ now: f.now })).issues).toEqual([]);
      expect((await f.sweep()).pruned).toBe(0);
    },
  );

  it("pins unresolved preview storage, active jobs and tampered evidence until each owner clears", async () => {
    const f = await proposal(true, true);
    expect(await f.db.select().from(npAgentPreviewRenderSessions)).toEqual([
      expect.objectContaining({ state: "completed" }),
    ]);
    await f.cancel();
    f.advance(91 * 86_400);
    expect((await f.sweep()).pruned).toBe(0);
    f.setStorageUnavailable(true);
    await f.service.reconcilePreviews({ siteId });
    expect(f.storage.objects.size).toBeGreaterThan(0);
    expect((await f.sweep()).pruned).toBe(0);
    f.setStorageUnavailable(false);
    await f.service.reconcilePreviews({ siteId });
    expect(f.storage.objects.size).toBe(0);
    const [session] = await f.db.select().from(npAgentPreviewRenderSessions);
    expect(session.state).toBe("completed");
    // Model an unresolved legacy session independently after storage has settled.
    await f.db
      .update(npAgentPreviewRenderSessions)
      .set({ state: "active", closedAt: null, closeReason: null })
      .where(eq(npAgentPreviewRenderSessions.id, session.id));
    expect((await f.sweep()).pruned).toBe(0);
    await f.db
      .update(npAgentPreviewRenderSessions)
      .set({ state: session.state, closedAt: session.closedAt, closeReason: session.closeReason })
      .where(eq(npAgentPreviewRenderSessions.id, session.id));

    const databaseUrl = getTestDatabaseUrl();
    if (!databaseUrl) throw new Error("Expected isolated test database");
    const adapter = new PgBossAdapter(databaseUrl, { supervise: false, schedule: false });
    try {
      await adapter.startProducer();
      const boss = Reflect.get(adapter, "boss") as {
        createQueue(name: string, options: { partition: boolean }): Promise<void>;
      };
      await boss.createQueue("validated.retention", { partition: true });
      await adapter.startProducer();
      const jobId = randomUUID();
      const [preview] = await f.db
        .select()
        .from(npAgentChangesetPreviews)
        .where(eq(npAgentChangesetPreviews.changesetId, f.draft.id));
      await f.db.execute(
        sql`insert into pgboss.job(id,name,data) values(${jobId}::uuid,'validated.retention',${JSON.stringify({ siteId, previewId: preview.id })}::jsonb)`,
      );
      expect((await f.sweep()).pruned).toBe(0);
      await f.db.execute(sql`delete from pgboss.job where id=${jobId}::uuid`);
      const [attempt] = await f.db
        .select()
        .from(npAgentChangesetValidationAttempts)
        .where(eq(npAgentChangesetValidationAttempts.changesetId, f.draft.id));
      await f.db
        .update(npAgentChangesetValidationAttempts)
        .set({ authorizationContextFingerprint: runtimeFingerprint })
        .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
      expect((await f.sweep()).pruned).toBe(0);
      await f.db
        .update(npAgentChangesetValidationAttempts)
        .set({ authorizationContextFingerprint: attempt.authorizationContextFingerprint })
        .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
      expect((await f.sweep()).pruned).toBe(1);
      await expect(
        f.db.execute(
          sql`insert into pgboss.job(name,data) values('validated.retention',${JSON.stringify({ siteId, previewId: preview.id })}::jsonb)`,
        ),
      ).rejects.toThrow();
      await expect(
        f.db.execute(
          sql`insert into pgboss.job(name,data) values('validated.retention',${JSON.stringify({ validationAttemptId: attempt.id })}::jsonb)`,
        ),
      ).rejects.toThrow();
    } finally {
      await adapter.stop();
      await f.db.execute(sql`drop schema if exists pgboss cascade`);
    }
  });

  it("freezes a separate requester Run's evidence when the creator releases first", async () => {
    const f = await proposal(true, false, true);
    expect(f.requesterRunId).not.toBe(f.input.runId);
    await f.cancel();
    f.advance(91 * 86_400);
    await refreshViewerSession(f);
    await f.service.reconcilePreviews({ siteId });
    const blockerId = randomUUID();
    await f.db.insert(npAuditEvents).values({
      id: blockerId,
      siteId,
      actorKind: "system",
      action: "fixture.unowned.requester-reference",
      payload: { runId: f.requesterRunId },
    });
    const before = await evidence(f);
    const actions = await f.db.select().from(npAgentActions).orderBy(npAgentActions.id);
    const requesterActions = actions.filter((action) => action.runId === f.requesterRunId);
    expect(requesterActions).toHaveLength(2);
    expect((await f.sweep()).pruned).toBe(1);
    const [creatorRelease] = await f.db
      .select()
      .from(npAgentSourceReleases)
      .where(eq(npAgentSourceReleases.sourceId, f.input.runId));
    expect(creatorRelease).toBeDefined();
    expect(
      await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.requesterRunId)),
    ).toHaveLength(1);
    expect(await evidence(f)).toEqual(before);
    expect(await f.service.get({ actor: f.actor, id: f.draft.id })).toMatchObject({
      id: f.draft.id,
      state: "cancelled",
    });
    expect((await npCollectAgentHealthSummaryV1({ now: f.now })).issues).toEqual([]);
    for (const action of requesterActions) {
      expect(action.runSourceReleaseId).toBeNull();
      await expect(
        f.db
          .update(npAgentActions)
          .set({ outputRedacted: {} })
          .where(eq(npAgentActions.id, action.id)),
      ).rejects.toThrow();
      await expect(
        f.db.delete(npAgentActions).where(eq(npAgentActions.id, action.id)),
      ).rejects.toThrow();
      await expect(
        f.db
          .update(npAgentInvocations)
          .set({ outputRedacted: {} })
          .where(eq(npAgentInvocations.id, action.invocationId!)),
      ).rejects.toThrow();
      await expect(
        f.db.delete(npAgentInvocations).where(eq(npAgentInvocations.id, action.invocationId!)),
      ).rejects.toThrow();
      await expect(
        f.db
          .update(npAuditEvents)
          .set({ payload: {} })
          .where(eq(npAuditEvents.id, action.auditEventId!)),
      ).rejects.toThrow();
      await expect(
        f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, action.auditEventId!)),
      ).rejects.toThrow();
    }
    await f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, blockerId));
    expect((await f.sweep()).pruned).toBe(1);
    const [requesterRelease] = await f.db
      .select()
      .from(npAgentSourceReleases)
      .where(eq(npAgentSourceReleases.sourceId, f.requesterRunId));
    expect(requesterRelease.id).not.toBe(creatorRelease.id);
    expect(await f.db.select().from(npAgentRuns)).toEqual([]);
    expect(await evidence(f)).toEqual({
      ...before,
      audits: before.audits.filter((audit) => audit.id !== blockerId),
    });
    expect(await f.db.select().from(npAgentActions).orderBy(npAgentActions.id)).toEqual(
      actions.map((action) => ({
        ...action,
        runId: null,
        runSourceReleaseId:
          action.runId === f.input.runId ? creatorRelease.id : requesterRelease.id,
      })),
    );
    expect(await f.service.get({ actor: f.actor, id: f.draft.id })).toMatchObject({
      id: f.draft.id,
      state: "cancelled",
    });
    const activity = createAgentActivityServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(61),
      now: f.options.now,
      changesets: f.service,
    });
    await expect(
      activity.getRun({ siteId, actor: f.actor.actor, id: f.requesterRunId }),
    ).resolves.toMatchObject({
      schemaVersion: "np.agent-activity-run-expired.v1",
      runId: f.requesterRunId,
      evidence: "expired",
    });
    const hidden = createAgentActivityServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(61),
      now: f.options.now,
      changesets: { get: () => Promise.reject(new Error("Current item access denied")) },
    });
    await expect(
      hidden.getRun({ siteId, actor: f.actor.actor, id: f.requesterRunId }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await npCollectAgentHealthSummaryV1({ now: f.now })).issues).toEqual([]);
  });

  it("keeps approval history pinned despite terminal validation and cleaned preview evidence", async () => {
    const f = await runtimeApprovalResumeFixture();
    await f.service.cancel({
      actor: f.actor,
      id: f.sealed.id,
      command: {
        schemaVersion: "np.agent-changeset-cancel-input.v1",
        expectedDraftVersion: f.sealed.draftVersion,
        expectedState: "approval_pending",
        planHash: f.sealed.planHash,
        reasonCode: "OPERATOR_CANCELLED",
        reason: null,
        idempotencyKey: randomUUID(),
      },
    });
    await f.store.cancel(f.input);
    f.advance(91 * 86_400);
    await f.service.reconcilePreviews({ siteId });
    expect((await pruneAgentRuntimeEventsV1({ siteId, now: f.options.now() })).pruned).toBe(0);
    expect(
      await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.input.runId)),
    ).toHaveLength(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toEqual([]);
  });
});
