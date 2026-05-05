import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 19 — worker liveness heartbeat (#6 from the audit).
 *
 * The recurring `setInterval` is exercised in the actual
 * `startWorker()` path; these tests pin the underlying
 * `recordHeartbeat` / `listWorkerHealth` / `purgeStaleWorkers`
 * helpers so the admin endpoint's contract is locked.
 */
describe.skipIf(skipIfNoTestDb())("Phase 19 — worker heartbeat", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("recordHeartbeat upserts a row and refreshes lastSeenAt on the second beat", async () => {
    const { recordHeartbeat, listWorkerHealth } = await import("@nexpress/core");
    await recordHeartbeat("worker-a", { region: "us-east-1" });
    const before = await listWorkerHealth();
    expect(before.totalCount).toBe(1);
    expect(before.workers[0]?.id).toBe("worker-a");
    expect(before.workers[0]?.alive).toBe(true);
    expect(before.workers[0]?.meta).toEqual({ region: "us-east-1" });

    // Second beat keeps the same row but bumps lastSeenAt.
    const firstSeen = before.workers[0]!.lastSeenAt.getTime();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await recordHeartbeat("worker-a", { region: "us-east-1" });
    const after = await listWorkerHealth();
    expect(after.totalCount).toBe(1);
    const secondSeen = after.workers[0]!.lastSeenAt.getTime();
    expect(secondSeen).toBeGreaterThan(firstSeen);
  });

  it("listWorkerHealth marks workers stale once last_seen_at exceeds the threshold", async () => {
    const { recordHeartbeat, listWorkerHealth, WORKER_STALE_THRESHOLD_MS } =
      await import("@nexpress/core");
    await recordHeartbeat("worker-stale");
    // Override the reference clock so the row appears 5 minutes old.
    const future = new Date(Date.now() + WORKER_STALE_THRESHOLD_MS + 60_000);
    const summary = await listWorkerHealth(future);
    expect(summary.totalCount).toBe(1);
    expect(summary.aliveCount).toBe(0);
    expect(summary.workers[0]?.alive).toBe(false);
    expect(summary.workers[0]?.lastSeenAgoMs).toBeGreaterThan(WORKER_STALE_THRESHOLD_MS);
  });

  it("markWorkerStopped flips status to `stopped` and excludes the row from alive count", async () => {
    const { recordHeartbeat, markWorkerStopped, listWorkerHealth } = await import("@nexpress/core");
    await recordHeartbeat("worker-bye");
    await markWorkerStopped("worker-bye");
    const summary = await listWorkerHealth();
    expect(summary.totalCount).toBe(1);
    expect(summary.aliveCount).toBe(0);
    expect(summary.workers[0]?.status).toBe("stopped");
    expect(summary.workers[0]?.alive).toBe(false);
  });

  it("purgeStaleWorkers deletes rows older than the cutoff", async () => {
    const { recordHeartbeat, purgeStaleWorkers, listWorkerHealth } = await import("@nexpress/core");
    await recordHeartbeat("worker-fresh");
    await recordHeartbeat("worker-old");
    // Force `worker-old` to look ancient.
    const db = (await import("@nexpress/core")).getDb();
    const { npWorkerHeartbeats } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    await db
      .update(npWorkerHeartbeats)
      .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(npWorkerHeartbeats.id, "worker-old"));

    const purged = await purgeStaleWorkers(new Date(Date.now() - 60_000));
    expect(purged).toBe(1);
    const summary = await listWorkerHealth();
    expect(summary.totalCount).toBe(1);
    expect(summary.workers[0]?.id).toBe("worker-fresh");
  });

  it("admin /api/admin/jobs/health surfaces the summary (admin only)", async () => {
    const { recordHeartbeat } = await import("@nexpress/core");
    await recordHeartbeat("worker-api");

    const { GET: healthGET } = await import("@/app/api/admin/jobs/health/route");
    const { seedUser } = await import("./harness.js");
    const session = await seedUser({ role: "admin" });
    const { NextRequest } = await import("next/server");
    const headers = new Headers({
      cookie: `nx-session=${session.accessToken}; nx-csrf=${session.csrfToken}`,
      "x-csrf-token": session.csrfToken,
    });
    const req = new NextRequest("http://localhost:3000/api/admin/jobs/health", {
      headers,
    });
    const res = await healthGET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workers: Array<{ id: string; alive: boolean }>;
      aliveCount: number;
      totalCount: number;
    };
    expect(body.totalCount).toBe(1);
    expect(body.aliveCount).toBe(1);
    expect(body.workers[0]?.id).toBe("worker-api");
  });

  it("admin /api/admin/jobs/health rejects editors (403)", async () => {
    const { GET: healthGET } = await import("@/app/api/admin/jobs/health/route");
    const { seedUser } = await import("./harness.js");
    const session = await seedUser({ role: "editor" });
    const { NextRequest } = await import("next/server");
    const headers = new Headers({
      cookie: `nx-session=${session.accessToken}; nx-csrf=${session.csrfToken}`,
      "x-csrf-token": session.csrfToken,
    });
    const req = new NextRequest("http://localhost:3000/api/admin/jobs/health", {
      headers,
    });
    const res = await healthGET(req);
    expect(res.status).toBe(403);
  });
});
