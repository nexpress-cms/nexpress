import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentInvocations,
  npAgentRuns,
  npAgentSourceReleases,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { createAgentChangeSetServiceV1 } from "../../../packages/core/src/agent/changeset-service.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
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

const day = 86_400_000;
async function proposal() {
  const definition = runtimeDefinition();
  definition.autonomy = "approved";
  definition.scopes = [
    "changeset:read",
    "changeset:write",
    "settings:read",
    "settings:write",
    "site:read",
  ];
  definition.capabilityModes = [{ capabilityId: "changeset.create", mode: "approved" }];
  const recipes = runtimeRecipes();
  recipes.recipes[0].capabilityIds = ["changeset.create"];
  const f = await runtimeFixture(undefined, true, { delegated: true, definition, recipes });
  const service = createAgentChangeSetServiceV1({
    cursorKey: new Uint8Array(32).fill(44),
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
  const claimed = { ...input, claim: acquired.claim };
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
  await store.transition({ ...claimed, state: "succeeded" });
  const cancel = () =>
    service.cancel({
      actor: f.actor,
      id: draft.id,
      command: {
        schemaVersion: "np.agent-changeset-cancel-input.v1",
        expectedDraftVersion: draft.draftVersion,
        expectedState: "draft",
        planHash: null,
        reasonCode: "OPERATOR_CANCELLED",
        reason: null,
        idempotencyKey: randomUUID(),
      },
    });
  const now = new Date(f.options.now().getTime() + 91 * day);
  const sweep = (time = now, targetSite = siteId) =>
    pruneAgentRuntimeEventsV1({ siteId: targetSite, now: time });
  return { ...f, service, input, draft, result, cancel, now, sweep };
}

describe.skipIf(skipIfNoTestDb())("Cancelled Runtime ChangeSet source retention", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it.each(["cancelled", "expired"] as const)(
    "expires %s proposal sources and retains original history without re-admission",
    async (kind) => {
      const f = await proposal();
      if (kind === "cancelled") await f.cancel();
      else {
        f.advance(91 * 86_400);
        expect((await f.service.reconcileExpired({ siteId })).cancelled).toBe(1);
        f.advance(-91 * 86_400);
      }
      const [before] = await f.db
        .select()
        .from(npAgentChangesets)
        .where(eq(npAgentChangesets.id, f.draft.id));
      const [action] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.invocationId, f.result.invocationId));
      const invocations = await f.db
        .select()
        .from(npAgentInvocations)
        .orderBy(npAgentInvocations.id);
      const audits = await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id);
      expect((await f.sweep(f.now, "draft-other")).pruned).toBe(0);
      expect((await f.sweep()).pruned).toBe(1);
      expect(
        await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.input.runId)),
      ).toHaveLength(0);
      const [release] = await f.db
        .select()
        .from(npAgentSourceReleases)
        .where(eq(npAgentSourceReleases.sourceId, f.input.runId));
      expect(release).toMatchObject({ siteId, sourceKind: "runtime-run" });
      const [after] = await f.db
        .select()
        .from(npAgentChangesets)
        .where(eq(npAgentChangesets.id, f.draft.id));
      expect(after).toEqual({ ...before, runId: null, runSourceReleaseId: release.id });
      expect(await f.db.select().from(npAgentInvocations).orderBy(npAgentInvocations.id)).toEqual(
        invocations,
      );
      expect(await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id)).toEqual(audits);
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, action.id)),
      ).toEqual([{ ...action, runId: null, runSourceReleaseId: release.id }]);
      const history = await f.service.get({ actor: f.actor, id: f.draft.id });
      expect(JSON.stringify(history)).toContain(f.draft.id);
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
      await expect(
        f.db.insert(npAuditEvents).values({
          siteId,
          actorKind: "system",
          action: "fixture.late.reference",
          payload: { runId: f.input.runId },
        }),
      ).rejects.toThrow();
      if (kind === "cancelled") {
        await expect(
          f.db.delete(npAgentActions).where(eq(npAgentActions.id, action.id)),
        ).rejects.toThrow();
        await expect(
          f.db
            .update(npAgentChangesets)
            .set({ title: "Changed retained title" })
            .where(eq(npAgentChangesets.id, before.id)),
        ).rejects.toThrow();
        await expect(
          f.db
            .delete(npAgentChangesetOperations)
            .where(eq(npAgentChangesetOperations.changesetId, before.id)),
        ).rejects.toThrow();
        await expect(
          f.db
            .update(npAgentInvocations)
            .set({ outputRedacted: {} })
            .where(eq(npAgentInvocations.id, f.result.invocationId)),
        ).rejects.toThrow();
        await expect(
          f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, action.auditEventId!)),
        ).rejects.toThrow();
        const databaseUrl = getTestDatabaseUrl();
        if (!databaseUrl) throw new Error("Expected isolated test database");
        const adapter = new PgBossAdapter(databaseUrl, { supervise: false, schedule: false });
        try {
          await adapter.startProducer();
          const boss = Reflect.get(adapter, "boss") as {
            createQueue(name: string, options: { partition: boolean }): Promise<void>;
          };
          await boss.createQueue("cancelled.retention", { partition: true });
          await adapter.startProducer();
          await expect(
            f.db.execute(
              sql`insert into pgboss.job(name,data) values('cancelled.retention',${JSON.stringify({ siteId, changeSetId: before.id })}::jsonb)`,
            ),
          ).rejects.toThrow();
          expect((await npCollectAgentHealthSummaryV1({ now: f.now })).issues).toEqual([]);
        } finally {
          await adapter.stop();
          await f.db.execute(sql`drop schema if exists pgboss cascade`);
        }
      }
      expect((await f.sweep()).pruned).toBe(0);
    },
  );

  it("pins a live proposal, unexpired invocation, and unknown reference until all fences clear", async () => {
    const f = await proposal();
    expect((await f.sweep()).pruned).toBe(0);
    await f.cancel();
    expect((await f.sweep(f.options.now())).pruned).toBe(0);
    const [invocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, f.result.invocationId));
    await f.db
      .update(npAgentInvocations)
      .set({ expiresAt: new Date(f.now.getTime() + day) })
      .where(eq(npAgentInvocations.id, invocation.id));
    expect((await f.sweep()).pruned).toBe(0);
    await f.db
      .update(npAgentInvocations)
      .set({ expiresAt: invocation.expiresAt })
      .where(eq(npAgentInvocations.id, invocation.id));
    const id = randomUUID();
    await f.db.insert(npAuditEvents).values({
      id,
      siteId: null,
      actorKind: "system",
      action: "fixture.unknown.reference",
      payload: { nested: { source: f.input.runId } },
    });
    expect((await f.sweep()).pruned).toBe(0);
    await f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, id));
    expect((await f.sweep()).pruned).toBe(1);
  });

  it("preserves a cancelled proposal with approval history", async () => {
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
    expect(
      (
        await pruneAgentRuntimeEventsV1({
          siteId,
          now: new Date(f.options.now().getTime() + 91 * day),
        })
      ).pruned,
    ).toBe(0);
    expect(
      await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.input.runId)),
    ).toHaveLength(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
  });
});
