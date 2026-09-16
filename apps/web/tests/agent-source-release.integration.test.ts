import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentInvocations,
  npAgentRuns,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSites } from "../../../packages/core/src/db/schema/system.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { deleteSite } from "../../../packages/core/src/sites/registry.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import {
  npAgentReleaseActionDigestV1,
  npRequireAgentSourceReleaseRecordV1,
  npVerifyAgentReleaseReadAttributionV1,
  npResolveReleasedAgentActionPrincipalV1,
} from "../../../packages/core/src/agent/source-release-read.js";
import { npDigestAgentAuthorizationContextCanonical } from "../../../packages/core/src/agent-contract/canonical-authorization-context.js";
import { npDigestAgentInvocationRequestCanonical } from "../../../packages/core/src/agent-contract/canonical-idempotency-request.js";
import { runtimeReadCapabilityFixture } from "./agent-runtime-capability-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof runtimeReadCapabilityFixture>>;
const day = 86_400_000;
async function finishedRead() {
  const f = await runtimeReadCapabilityFixture();
  const result = await f.capability.invokeRuntime(f.input);
  await f.store.transition({
    siteId,
    runId: f.input.runId,
    claim: f.input.claim,
    state: "succeeded",
  });
  const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.input.runId));
  const [action] = await f.db
    .select()
    .from(npAgentActions)
    .where(eq(npAgentActions.id, result.actionId));
  const [invocation] = await f.db
    .select()
    .from(npAgentInvocations)
    .where(eq(npAgentInvocations.id, result.invocationId));
  if (!run || !action || !invocation) throw new Error("Expected actual retained read evidence");
  return {
    ...f,
    result,
    run,
    action,
    invocation,
    now: new Date(f.options.now().getTime() + 91 * day),
  };
}
async function sweep(f: Fixture, now: Date) {
  return pruneAgentRuntimeEventsV1({ siteId: f.runInput.siteId, now });
}

describe.skipIf(skipIfNoTestDb())("Runtime immutable evidence source-release lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("releases a real read Run while preserving audit, invocation authorization, Action hashes and historical attribution", async () => {
    const f = await finishedRead();
    const audit = await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id);
    expect(
      audit.some((row) => row.action === "agent.runtime.admitted" && row.targetId === f.run.id),
    ).toBe(true);
    expect(
      audit.some((row) => row.action === "agent.runtime.execution" && row.targetId === f.run.id),
    ).toBe(true);
    expect(
      await npVerifyAgentReleaseReadAttributionV1({
        action: f.action,
        invocation: f.invocation,
        runId: f.run.id,
        runFingerprint: f.run.admissionFingerprint,
        principalId: f.run.principalId,
        agentVersionId: f.run.agentVersionId!,
        deadlineAt: f.run.deadlineAt.toISOString(),
      }),
    ).not.toBeNull();
    expect((await sweep(f, f.now)).pruned).toBe(1);
    expect(await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.run.id))).toHaveLength(
      0,
    );
    const [release] = await f.db
      .select()
      .from(npAgentSourceReleases)
      .where(eq(npAgentSourceReleases.sourceId, f.run.id));
    if (!release) throw new Error("Missing committed release receipt");
    await expect(npRequireAgentSourceReleaseRecordV1(release)).resolves.toMatchObject({
      kind: "runtime-run",
      sourceId: f.run.id,
      principalId: f.run.principalId,
      deadlineAt: f.run.deadlineAt.toISOString(),
    });
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.id, f.action.id));
    expect(action).toEqual({ ...f.action, runId: null, runSourceReleaseId: release.id });
    expect(await npAgentReleaseActionDigestV1(action)).toBe(f.action.inputHash);
    expect(
      await f.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, f.invocation.id)),
    ).toEqual([f.invocation]);
    expect(await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id)).toEqual(audit);
    expect(await npResolveReleasedAgentActionPrincipalV1({ db: f.db, action })).toBe(
      f.run.principalId,
    );
    const activity = createAgentActivityServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(61),
      now: f.options.now,
    });
    const detail = await activity.getAction({ siteId, actor: f.actor.actor, id: action.id });
    expect(detail).toMatchObject({
      principalId: f.run.principalId,
      evidence: "expired",
      inputHash: f.action.inputHash,
      action: { id: action.id, runId: null, inputRedacted: {}, outputRedacted: {} },
    });
    expect(JSON.stringify(detail)).not.toContain(release.id);
    await expect(
      activity.getRun({ siteId, actor: f.actor.actor, id: f.run.id }),
    ).rejects.toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
    const originalCollection = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...originalCollection,
      access: { ...originalCollection.access, read: () => false },
    });
    try {
      await expect(
        activity.getAction({ siteId, actor: f.actor.actor, id: action.id }),
      ).rejects.toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
    } finally {
      registerCollection("posts", getCollectionTable("posts"), originalCollection);
    }
    const admitted = audit.find(
      (row) => row.action === "agent.runtime.admitted" && row.targetId === f.run.id,
    );
    if (!admitted) throw new Error("Missing retained admission audit");
    await expect(
      f.db
        .update(npAuditEvents)
        .set({ payload: { ...admitted.payload, altered: true } })
        .where(eq(npAuditEvents.id, admitted.id)),
    ).rejects.toThrow();
    expect(await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id)).toEqual(audit);
    const edges = await f.db
      .select()
      .from(npAgentSourceReleaseEdges)
      .where(eq(npAgentSourceReleaseEdges.sourceReleaseId, release.id));
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerKind: "read-action",
          ownerId: action.id,
          edgeCode: "action-run",
        }),
        expect.objectContaining({
          ownerKind: "read-invocation",
          ownerId: f.invocation.id,
          edgeCode: "invocation-authority-run",
        }),
      ]),
    );
    await expect(f.admission.admit(f.runInput)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(
      f.admission.admit({ ...f.runInput, goal: "Changed request using consumed key" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await sweep(f, f.now)).pruned).toBe(0);
  });

  it.each(["unknown-nested", "known-action-extra-occurrence", "null-site"] as const)(
    "pins %s audit references without rewriting evidence",
    async (kind) => {
      const f = await finishedRead();
      if (kind === "known-action-extra-occurrence") {
        const [admitted] = await f.db
          .select()
          .from(npAuditEvents)
          .where(
            and(
              eq(npAuditEvents.action, "agent.runtime.admitted"),
              eq(npAuditEvents.targetId, f.run.id),
            ),
          );
        if (!admitted) throw new Error("Expected admission audit");
        await f.db
          .update(npAuditEvents)
          .set({ payload: { ...admitted.payload, nested: { runId: f.run.id } } })
          .where(eq(npAuditEvents.id, admitted.id));
      } else
        await f.db.insert(npAuditEvents).values({
          id: randomUUID(),
          siteId: kind === "null-site" ? null : siteId,
          actorKind: "system",
          action: "fixture.unknown.reference",
          targetType: null,
          targetId: null,
          payload: { nested: [{ sourceId: f.run.id }] },
          createdAt: f.options.now(),
        });
      const audit = await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id);
      expect((await sweep(f, f.now)).pruned).toBe(0);
      expect(
        await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.run.id)),
      ).toHaveLength(1);
      expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
      expect(await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id)).toEqual(audit);
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, f.action.id)),
      ).toEqual([f.action]);
    },
  );

  it.each([
    { count: 1, mebibytes: 33 },
    { count: 3, mebibytes: 23 },
  ])(
    "retains oversized reference evidence and advances the cursor for $count × $mebibytes MiB audit rows",
    async ({ count, mebibytes }) => {
      const f = await finishedRead();
      // Generate and fingerprint the adversarial evidence in PostgreSQL; never transfer large bodies to JS.
      await f.db
        .execute(sql`insert into np_audit_events(id,site_id,actor_kind,action,payload,created_at)
        select gen_random_uuid(), ${siteId}, 'system', 'fixture.oversized-reference',
          jsonb_build_object('nested', jsonb_build_object('runId', ${f.run.id}::text),
            'padding', repeat('x', ${mebibytes * 1024 * 1024})), ${f.options.now()}
        from generate_series(1, ${count})`);
      const fingerprint = () =>
        f.db
          .execute(sql`select id, octet_length(payload::text) as bytes, md5(payload::text) as digest
        from np_audit_events where site_id=${siteId} and action='fixture.oversized-reference' order by id`);
      const before = await fingerprint();
      expect(before.rows).toHaveLength(count);
      for (const row of before.rows)
        expect(Number(row.bytes)).toBeGreaterThan(mebibytes * 1024 * 1024);
      expect(await pruneAgentRuntimeEventsV1({ siteId, now: f.now, limit: 1 })).toEqual({
        examined: 1,
        pruned: 0,
        nextCursor: f.run.id,
      });
      expect(
        await pruneAgentRuntimeEventsV1({ siteId, now: f.now, limit: 1, cursor: f.run.id }),
      ).toEqual({ examined: 0, pruned: 0, nextCursor: null });
      expect(
        await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.run.id)),
      ).toHaveLength(1);
      expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
      expect((await fingerprint()).rows).toEqual(before.rows);
    },
    // PostgreSQL constructs, guards and fingerprints up to 69 MiB of fixture
    // evidence before/after cleanup. Allow CI time for that I/O without changing
    // the production maintenance statement budget or any preservation assertion.
    120_000,
  );

  it.each(["action", "invocation"] as const)(
    "pins a mismatched %s idempotency key carrying extra Run occurrences",
    async (owner) => {
      const f = await finishedRead();
      const table = owner === "action" ? npAgentActions : npAgentInvocations;
      const id = owner === "action" ? f.action.id : f.invocation.id;
      await f.db
        .update(table)
        .set({ idempotencyKey: `runtime:${f.run.id}:1:extra:${f.run.id}` })
        .where(eq(table.id, id));
      expect((await sweep(f, f.now)).pruned).toBe(0);
      expect(
        await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.run.id)),
      ).toHaveLength(1);
      expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
    },
  );

  it("pins malformed admitted audit payload without crashing or trapping the cursor", async () => {
    const f = await finishedRead();
    await f.db
      .update(npAuditEvents)
      .set({ payload: sql`'null'::jsonb` })
      .where(
        and(
          eq(npAuditEvents.action, "agent.runtime.admitted"),
          eq(npAuditEvents.targetId, f.run.id),
        ),
      );
    expect(await pruneAgentRuntimeEventsV1({ siteId, now: f.now, limit: 1 })).toEqual({
      examined: 1,
      pruned: 0,
      nextCursor: f.run.id,
    });
    expect(
      await pruneAgentRuntimeEventsV1({ siteId, now: f.now, limit: 1, cursor: f.run.id }),
    ).toEqual({ examined: 0, pruned: 0, nextCursor: null });
    expect(await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.run.id))).toHaveLength(
      1,
    );
    expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
    const [audit] = await f.db
      .select({ payload: npAuditEvents.payload })
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.action, "agent.runtime.admitted"),
          eq(npAuditEvents.targetId, f.run.id),
        ),
      );
    expect(audit?.payload).toBeNull();
  });

  it("retains an active read Run and canonical evidence even beyond nominal retention", async () => {
    const f = await runtimeReadCapabilityFixture();
    const result = await f.capability.invokeRuntime(f.input);
    expect((await sweep(f, new Date(f.options.now().getTime() + 401 * day))).pruned).toBe(0);
    expect(
      await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.input.runId)),
    ).toHaveLength(1);
    expect(
      await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, result.actionId)),
    ).toHaveLength(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
  });

  it("pins a malformed admission source fingerprint", async () => {
    const f = await finishedRead();
    await f.db
      .update(npAgentRuns)
      .set({ admissionFingerprint: `cj1:sha256:${"Z".repeat(43)}` })
      .where(eq(npAgentRuns.id, f.run.id));
    expect((await sweep(f, f.now)).pruned).toBe(0);
    expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
    expect(await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.run.id))).toHaveLength(
      1,
    );
  });

  it.each(["agentVersionId", "deadlineAt"] as const)(
    "pins mismatched %s with recomputed authorization/request/Action digests",
    async (key) => {
      const f = await finishedRead();
      const authorization = structuredClone(f.invocation.authorizationContextBody);
      if (authorization.authorityRef.kind !== "runtime-run")
        throw new Error("Expected actual runtime authority");
      authorization.authorityRef = {
        ...authorization.authorityRef,
        [key]:
          key === "agentVersionId"
            ? randomUUID()
            : new Date(f.run.deadlineAt.getTime() + 1000).toISOString(),
      };
      const authorizationContextFingerprint =
        await npDigestAgentAuthorizationContextCanonical(authorization);
      const requestBody = { ...f.invocation.requestBody, authorizationContextFingerprint };
      const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
      const alteredAction = { ...f.action, invocationFingerprint: requestHash };
      const inputHash = await npAgentReleaseActionDigestV1(alteredAction);
      await f.db
        .update(npAgentInvocations)
        .set({
          authorizationContextBody: authorization,
          authorizationContextFingerprint,
          authorityRef: { ...authorization.authorityRef },
          requestBody,
          requestHash,
        })
        .where(eq(npAgentInvocations.id, f.invocation.id));
      await f.db
        .update(npAgentActions)
        .set({ invocationFingerprint: requestHash, inputHash })
        .where(eq(npAgentActions.id, f.action.id));
      expect((await sweep(f, f.now)).pruned).toBe(0);
      expect(
        await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.run.id)),
      ).toHaveLength(1);
      expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
    },
  );

  it("deletes site-owned receipts in normal site cascade while preserving another site and global coordination", async () => {
    const f = await finishedRead();
    await sweep(f, f.now);
    expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(1);
    const other = await f.db.select().from(npSites).where(eq(npSites.id, "draft-other"));
    expect(other).toHaveLength(1);
    const fence = await f.db.execute(sql`select id, epoch from np_agent_reference_fence`);
    await deleteSite(siteId, { cascade: true });
    expect(
      await f.db
        .select()
        .from(npAgentSourceReleases)
        .where(eq(npAgentSourceReleases.siteId, siteId)),
    ).toHaveLength(0);
    expect(
      await f.db
        .select()
        .from(npAgentSourceReleaseEdges)
        .where(eq(npAgentSourceReleaseEdges.siteId, siteId)),
    ).toHaveLength(0);
    expect(await f.db.select().from(npSites).where(eq(npSites.id, siteId))).toHaveLength(0);
    expect(await f.db.select().from(npSites).where(eq(npSites.id, "draft-other"))).toEqual(other);
    const after = await f.db.execute(sql`select id, epoch from np_agent_reference_fence`);
    expect(after.rows).toEqual(fence.rows);
  });
});
