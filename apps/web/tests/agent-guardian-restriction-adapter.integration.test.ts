import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentPostgresRestrictionAdapterV1,
  npReadAgentActiveRestrictionProjectionRefsV1,
} from "../../../packages/core/src/agent/guardian-restriction-adapter.js";
import { npDigestAgentRestrictionCanonical } from "../../../packages/core/src/agent-contract/canonical-restriction.js";
import { npAgentRestrictionSubjectKeyV1 } from "../../../packages/core/src/agent-contract/restriction-adapter-contract.js";
import { npDeleteAgentSiteRows } from "../../../packages/core/src/agent/site-deletion.js";
import { npAgentRestrictionEnforcements } from "../../../packages/core/src/db/schema/agent.js";
import type { NpAgentRestrictionCanonicalV1 } from "../../../packages/core/src/agent-contract/types.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function setup() {
  const f = await fixture();
  let clock = new Date("2026-10-18T00:00:00.000Z");
  const now = () => clock;
  const adapter = createAgentPostgresRestrictionAdapterV1({ db: () => f.db, now });
  const descriptor = (
    change: Partial<NpAgentRestrictionCanonicalV1> = {},
  ): NpAgentRestrictionCanonicalV1 => ({
    schemaVersion: "np.agent-restriction.v1",
    restrictionId: randomUUID(),
    siteId,
    subject: {
      kind: "opaque_actor_bucket",
      purpose: "network-address",
      projectionVersion: 1,
      projectionFingerprint: "fixture-projector",
      keyId: "fixture-key",
      bucket: "A".repeat(43),
    },
    actionScopes: ["auth.staff"],
    startsAt: now().toISOString(),
    expiresAt: new Date(now().getTime() + 60_000).toISOString(),
    reasonCode: "GUARDIAN_REVIEWED",
    targetVersionDigest: `cj1:sha256:${"A".repeat(43)}`,
    ...change,
  });
  const context = (key: string) => ({
    idempotencyKey: key,
    expectedRowVersion: 1,
    signal: new AbortController().signal,
  });
  const check = (d: NpAgentRestrictionCanonicalV1) =>
    adapter.check(
      {
        schemaVersion: "np.agent-restriction-check.v1",
        siteId: d.siteId,
        subjects: [d.subject],
        actionScope: "auth.staff",
        observedAt: now().toISOString(),
      },
      { signal: new AbortController().signal },
    );
  return {
    ...f,
    adapter,
    descriptor,
    context,
    check,
    now,
    setTime: (time: Date) => {
      clock = time;
    },
  };
}
describe.skipIf(skipIfNoTestDb())("Guardian shared PostgreSQL restriction adapter", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("shares exact installation across replicas and retries, with scope/site/projection isolation", async () => {
    const f = await setup(),
      d = f.descriptor(),
      ctx = f.context("install-1");
    const receipts = await Promise.all([f.adapter.install(d, ctx), f.adapter.install(d, ctx)]);
    expect(receipts.map((r) => r.status).sort()).toEqual(["already_installed", "installed"]);
    const other = createAgentPostgresRestrictionAdapterV1({ db: () => f.db, now: f.now });
    expect(await f.check(d)).toMatchObject({ decision: "deny", restrictionId: d.restrictionId });
    expect(
      await other.check(
        {
          schemaVersion: "np.agent-restriction-check.v1",
          siteId: d.siteId,
          subjects: [d.subject],
          actionScope: "auth.member",
          observedAt: f.now().toISOString(),
        },
        { signal: ctx.signal },
      ),
    ).toMatchObject({ decision: "allow" });
    expect(await f.check({ ...d, siteId: "draft-other" })).toMatchObject({ decision: "allow" });
    if (d.subject.kind !== "opaque_actor_bucket") throw new Error("Expected opaque fixture");
    expect(
      await f.check({
        ...d,
        subject: { ...d.subject, projectionFingerprint: "changed-projector" },
      }),
    ).toMatchObject({ decision: "allow" });
    expect(await f.db.select().from(npAgentRestrictionEnforcements)).toHaveLength(1);
    await expect(f.adapter.install({ ...d, reasonCode: "CHANGED" }, ctx)).rejects.toThrow();
    await expect(f.adapter.remove(d, { ...ctx, expectedRowVersion: 2 })).rejects.toThrow();
  });
  it("expires access exactly at TTL without worker cleanup and never extends the immutable descriptor", async () => {
    const f = await setup(),
      d = f.descriptor(),
      ctx = f.context("install-expiry");
    await f.adapter.install(d, ctx);
    f.setTime(new Date(d.expiresAt));
    expect(await f.check(d)).toMatchObject({ decision: "allow" });
    expect(await f.adapter.verify(d, ctx)).toMatchObject({ state: "expired" });
    await expect(npDeleteAgentSiteRows(f.db, siteId)).rejects.toThrow(
      "confirmed actor restriction cleanup",
    );
    await expect(f.adapter.install(d, ctx)).rejects.toThrow();
    const [row] = await f.db.select().from(npAgentRestrictionEnforcements);
    expect(row?.state).toBe("installed");
    expect(await f.adapter.remove(d, f.context("expire-1"))).toMatchObject({ status: "removed" });
    expect(await f.adapter.verify(d, ctx)).toMatchObject({ state: "absent" });
  });
  it("removal of an absent restriction fences delayed installation, and concurrent removal converges", async () => {
    const f = await setup(),
      d = f.descriptor();
    expect(await f.adapter.remove(d, f.context("remove-first"))).toMatchObject({
      status: "already_absent",
    });
    await expect(f.adapter.install(d, f.context("late-install"))).rejects.toThrow();
    expect(await f.check(d)).toMatchObject({ decision: "allow" });
    const second = f.descriptor();
    const results = await Promise.allSettled([
      f.adapter.install(second, f.context("race-install")),
      f.adapter.remove(second, f.context("race-remove")),
    ]);
    expect(results[1]?.status).toBe("fulfilled");
    expect(await f.check(second)).toMatchObject({ decision: "allow" });
    await expect(f.adapter.install(second, f.context("race-install"))).rejects.toThrow();
    expect(await f.adapter.remove(second, f.context("race-remove"))).toMatchObject({
      status: "already_absent",
    });
  });
  it("uses trusted time, contains aborts and refuses malformed persisted evidence", async () => {
    const f = await setup(),
      d = f.descriptor(),
      ctx = f.context("validate");
    const aborted = new AbortController();
    aborted.abort();
    await expect(f.adapter.install(d, { ...ctx, signal: aborted.signal })).rejects.toThrow();
    await expect(
      f.adapter.install(
        {
          ...d,
          startsAt: new Date(f.now().getTime() + 1000).toISOString(),
          expiresAt: new Date(f.now().getTime() + 61000).toISOString(),
        },
        ctx,
      ),
    ).rejects.toThrow();
    await f.adapter.install(d, ctx);
    await expect(
      f.adapter.check(
        {
          schemaVersion: "np.agent-restriction-check.v1",
          siteId,
          subjects: [d.subject],
          actionScope: "auth.staff",
          observedAt: "2030-01-01T00:00:00.000Z",
        },
        ctx,
      ),
    ).rejects.toThrow();
    await f.db
      .update(npAgentRestrictionEnforcements)
      .set({ restrictionHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(
        and(
          eq(npAgentRestrictionEnforcements.siteId, siteId),
          eq(npAgentRestrictionEnforcements.id, d.restrictionId),
        ),
      );
    await expect(f.adapter.verify(d, ctx)).rejects.toThrow();
    await expect(f.check(d)).rejects.toThrow();
  });
  it("enumerates frozen projection metadata without a per-actor cardinality failure", async () => {
    const f = await setup();
    const descriptors = Array.from({ length: 129 }, (_, i) => {
      const descriptor = f.descriptor();
      if (descriptor.subject.kind !== "opaque_actor_bucket")
        throw new Error("Expected opaque fixture");
      descriptor.subject.bucket = createHash("sha256")
        .update(`scale-actor-${i}`)
        .digest("base64url");
      return descriptor;
    });
    const rows = await Promise.all(
      descriptors.map(async (descriptor) => ({
        id: descriptor.restrictionId,
        siteId,
        descriptor,
        restrictionHash: await npDigestAgentRestrictionCanonical(descriptor),
        subjectKey: npAgentRestrictionSubjectKeyV1(descriptor.subject),
        actionScopes: descriptor.actionScopes,
        installKey: `install:${descriptor.restrictionId}`,
        expectedRowVersion: 1,
        state: "installed",
        startsAt: new Date(descriptor.startsAt),
        expiresAt: new Date(descriptor.expiresAt),
        createdAt: f.now(),
        updatedAt: f.now(),
      })),
    );
    await f.db.insert(npAgentRestrictionEnforcements).values(rows);
    expect(
      await npReadAgentActiveRestrictionProjectionRefsV1({ db: f.db, siteId, now: f.now() }),
    ).toHaveLength(1);
    const descriptor = descriptors[128];
    if (!descriptor) throw new Error("Missing scale fixture");
    expect(await f.check(descriptor)).toMatchObject({
      decision: "deny",
      restrictionId: descriptor.restrictionId,
    });
  });
  it("retains every active frozen key/projection reference and refuses a ninth candidate", async () => {
    const f = await setup();
    for (let i = 0; i < 8; i++) {
      const d = f.descriptor();
      if (d.subject.kind !== "opaque_actor_bucket") throw new Error("Expected opaque fixture");
      d.subject.keyId = `rotation-${i}`;
      await f.adapter.install(d, f.context(`rotation-install-${i}`));
    }
    expect(
      await npReadAgentActiveRestrictionProjectionRefsV1({ db: f.db, siteId, now: f.now() }),
    ).toHaveLength(8);
    const d = f.descriptor();
    await expect(f.adapter.install(d, f.context("rotation-overflow"))).rejects.toThrow();
    expect(
      await npReadAgentActiveRestrictionProjectionRefsV1({ db: f.db, siteId, now: f.now() }),
    ).toHaveLength(8);
    f.setTime(new Date(f.now().getTime() + 60_000));
    expect(
      await npReadAgentActiveRestrictionProjectionRefsV1({ db: f.db, siteId, now: f.now() }),
    ).toEqual([]);
  });
});
