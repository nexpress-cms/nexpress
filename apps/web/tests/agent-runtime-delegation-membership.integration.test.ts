import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  grantSiteMembership,
  revokeSiteMembership,
  setSuperAdmin,
} from "../../../packages/core/src/sites/memberships.js";
import { npAgentPrincipals } from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import {
  runtimeFixture,
  runtimeDefinition,
  siteId as runtimeSiteId,
} from "./agent-runtime-service-fixture.js";
import {
  npBuildAgentRuntimeDefinitionInputV1,
  npResolveAgentRuntimeAuthorityV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { npSites, npUsers } from "../../../packages/core/src/db/schema/system.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const siteId = "delegation-membership";
const otherSiteId = "delegation-other";
const fingerprint = `cj1:sha256:${"A".repeat(43)}`;

async function fixture() {
  const db = await getTestDb();
  const user = await seedUser({ role: "admin" });
  await db
    .insert(npSites)
    .values([
      { id: siteId, name: "Delegation membership" },
      { id: otherSiteId, name: "Other delegation" },
    ])
    .onConflictDoNothing();
  await grantSiteMembership(siteId, user.userId, "admin");
  await grantSiteMembership(otherSiteId, user.userId, "admin");
  const ids = {
    runtime: randomUUID(),
    other: randomUUID(),
    external: randomUUID(),
    deployment: randomUUID(),
  };
  await db.insert(npAgentPrincipals).values(
    Object.entries(ids).map(([key, id]) => ({
      id,
      siteId: key === "other" ? otherSiteId : siteId,
      kind: key === "external" ? "external" : "runtime",
      name: "Delegation lifecycle fixture",
      status: "active",
      scopes: ["site:read"],
      authorityKind: key === "deployment" ? "deployment" : "user",
      authorityUserId: key === "deployment" ? null : user.userId,
      authorityPolicyId: key === "deployment" ? "test-deployment" : null,
      authorityFingerprint: fingerprint,
    })),
  );
  async function versions() {
    const rows = await db.select().from(npAgentPrincipals);
    return Object.fromEntries(
      Object.entries(ids).map(([key, id]) => {
        const row = rows.find((entry) => entry.id === id)!;
        expect(row.rowVersion).toBe(row.tokenVersion);
        expect(row.status).toBe("active");
        return [key, row.tokenVersion];
      }),
    );
  }
  return { db, user, ids, versions };
}

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function requireBlockedBy(db: Awaited<ReturnType<typeof getTestDb>>, pid: number, count = 1) {
  await vi.waitFor(
    async () => {
      const result = await db.execute(
        sql`with recursive blocked(pid) as (
          select ${pid}::int
          union
          select activity.pid from pg_stat_activity activity
          join blocked parent on parent.pid = any(pg_blocking_pids(activity.pid))
          where activity.datname=current_database()
        ) select (count(*)-1)::int as count from blocked`,
      );
      expect(Number((result.rows[0] as { count: number }).count)).toBeGreaterThanOrEqual(count);
    },
    { timeout: 10_000, interval: 25 },
  );
}

describe.skipIf(skipIfNoTestDb())("Runtime staff delegation membership invalidation", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("invalidates removed and re-added delegation without changing Gateway or other sites", async () => {
    const f = await fixture();
    await revokeSiteMembership(siteId, f.user.userId);
    expect(await f.versions()).toEqual({ runtime: 2, other: 1, external: 1, deployment: 1 });
    await revokeSiteMembership(siteId, f.user.userId);
    expect((await f.versions()).runtime).toBe(2);
    await grantSiteMembership(siteId, f.user.userId, "admin");
    expect((await f.versions()).runtime).toBe(3);
    const audit = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.targetId, f.ids.runtime));
    expect(audit).toHaveLength(2);
    expect(audit.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        { outcome: "invalidated", reason: "membership_removed" },
        { outcome: "invalidated", reason: "membership_changed" },
      ]),
    );
  });

  it("invalidates both role narrowing and widening but preserves identical grants", async () => {
    const f = await fixture();
    await grantSiteMembership(siteId, f.user.userId, "admin");
    expect((await f.versions()).runtime).toBe(1);
    await grantSiteMembership(siteId, f.user.userId, "viewer");
    await grantSiteMembership(siteId, f.user.userId, "admin");
    expect(await f.versions()).toEqual({ runtime: 3, other: 1, external: 1, deployment: 1 });
  });

  it("invalidates all delegated sites on super-admin changes, preserving no-op sets", async () => {
    const f = await fixture();
    await setSuperAdmin(f.user.userId, false);
    expect((await f.versions()).runtime).toBe(1);
    await setSuperAdmin(f.user.userId, true);
    await setSuperAdmin(f.user.userId, true);
    expect(await f.versions()).toEqual({ runtime: 2, other: 2, external: 1, deployment: 1 });
    await setSuperAdmin(f.user.userId, false);
    expect(await f.versions()).toEqual({ runtime: 3, other: 3, external: 1, deployment: 1 });
  });

  it("serializes concurrent identical grants without duplicate invalidation", async () => {
    const f = await fixture();
    await Promise.all([
      grantSiteMembership(siteId, f.user.userId, "editor"),
      grantSiteMembership(siteId, f.user.userId, "editor"),
    ]);
    expect((await f.versions()).runtime).toBe(2);
  });

  it("serializes membership downgrade after a held Run and rejects its old authority afterwards", async () => {
    const f = await runtimeFixture(undefined, true, { delegated: true });
    const { runId } = await f.admission.admit(f.runInput);
    const entered = signal();
    const release = signal();
    let pid = 0;
    const held = f.admission.withCurrentRun({ siteId: runtimeSiteId, runId }, async (current) => {
      const result = await current.db.execute(sql`select pg_backend_pid() as pid`);
      pid = Number((result.rows[0] as { pid: number }).pid);
      entered.resolve();
      await release.promise;
      return current.staffUser?.role;
    });
    await entered.promise;
    const changed = grantSiteMembership(runtimeSiteId, f.actor.actor.user.id, "viewer");
    const outcome = changed.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await requireBlockedBy(f.db, pid);
    } finally {
      release.resolve();
    }
    expect(await held).toBe("admin");
    expect(await outcome).toBeNull();
    await expect(
      f.admission.withCurrentRun({ siteId: runtimeSiteId, runId }, async () => true),
    ).rejects.toThrow();
    await grantSiteMembership(runtimeSiteId, f.actor.actor.user.id, "admin");
    await expect(
      f.admission.withCurrentRun({ siteId: runtimeSiteId, runId }, async () => true),
    ).rejects.toThrow();
  });

  it("does not publish usable delegation when creation races membership removal", async () => {
    const f = await runtimeFixture(undefined, true, { delegated: true });
    const entered = signal();
    const release = signal();
    let pid = 0;
    let holderDb!: typeof f.db;
    const holder = f.db.transaction(async (tx) => {
      holderDb = tx as typeof f.db;
      await tx
        .select({ id: npUsers.id })
        .from(npUsers)
        .where(eq(npUsers.id, f.actor.actor.user.id))
        .for("update");
      const result = await tx.execute(sql`select pg_backend_pid() as pid`);
      pid = Number((result.rows[0] as { pid: number }).pid);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const creation = f.service.executeAdmin({
      siteId: runtimeSiteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.create",
      targetId: null,
      command: {
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1(runtimeDefinition()),
        authority: { kind: "user", userId: f.actor.actor.user.id },
      },
    });
    const creationOutcome = creation.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let removal: Promise<unknown> | undefined;
    try {
      await requireBlockedBy(f.db, pid);
      removal = revokeSiteMembership(runtimeSiteId, f.actor.actor.user.id).then(
        () => null,
        (error: unknown) => error,
      );
      // The harness pool has three slots, occupied by holder/create/revoke.
      // Observe from the held transaction rather than queueing a fourth connection.
      await requireBlockedBy(holderDb, pid, 2);
    } finally {
      release.resolve();
    }
    await holder;
    expect(await removal).toBeNull();
    await creationOutcome;
    const principals = await f.db
      .select()
      .from(npAgentPrincipals)
      .where(eq(npAgentPrincipals.authorityUserId, f.actor.actor.user.id));
    for (const principal of principals) {
      await expect(
        f.db.transaction((tx) =>
          npResolveAgentRuntimeAuthorityV1({
            db: tx as typeof f.db,
            siteId: runtimeSiteId,
            principal,
            scopes: ["site:read"],
            deploymentAuthority: f.options.deploymentAuthority,
          }),
        ),
      ).rejects.toThrow();
    }
  });
});
