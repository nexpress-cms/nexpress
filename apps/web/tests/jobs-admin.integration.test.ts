import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 13 — admin jobs endpoints. These tests don't depend on
 * a live pg-boss process; instead we install a stub queue
 * adapter that implements the introspection methods so the
 * route logic can be exercised end-to-end without spinning up
 * the real worker.
 */
describe.skipIf(skipIfNoTestDb())("admin jobs (Phase 13)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(null);
  });
  afterAll(async () => {
    await closeTestDb();
  });

  function installStubQueue(jobs: ReturnType<typeof makeJobs>) {
    const queue = {
      enqueue: async () => "stub",
      start: async () => {},
      stop: async () => {},
      listJobs: async ({ state }: { state?: string } = {}) => {
        const filtered = state ? jobs.filter((j) => j.state === state) : jobs;
        return { jobs: filtered, total: filtered.length };
      },
      retryJob: async (id: string) => {
        const job = jobs.find((j) => j.id === id);
        if (!job) throw new Error(`Job ${id} not found`);
        return `${id}-retry`;
      },
      cancelJob: async (id: string) => {
        const idx = jobs.findIndex((j) => j.id === id && j.state === "created");
        if (idx === -1) {
          throw new Error(`Job ${id} not found or already terminal`);
        }
        jobs[idx]!.state = "cancelled";
      },
    };
    return queue;
  }

  function makeJobs() {
    return [
      {
        id: "j1",
        name: "media.processImage",
        state: "created",
        data: { mediaId: "bd134b0f-b9ea-4ff4-81ef-606e42e27703" },
        retryCount: 0,
        output: null,
        createdOn: new Date().toISOString(),
        startedOn: null,
        completedOn: null,
        source: "live",
      },
      {
        id: "j2",
        name: "content.afterSave",
        state: "completed",
        data: {
          collection: "posts",
          documentId: "d4cafb07-c120-4503-90fa-6d6fc4104ce3",
          operation: "update",
          siteId: "default",
          userId: "scheduler",
          memberId: null,
        },
        retryCount: 0,
        output: null,
        createdOn: new Date().toISOString(),
        startedOn: null,
        completedOn: new Date().toISOString(),
        source: "archive",
      },
      {
        id: "j3",
        name: "media.cleanup",
        state: "failed",
        data: {},
        retryCount: 3,
        output: "ENOENT: file disappeared mid-cleanup",
        createdOn: new Date().toISOString(),
        startedOn: null,
        completedOn: new Date().toISOString(),
        source: "archive",
      },
    ];
  }

  it("GET /api/admin/jobs returns supported:false when no queue is wired", async () => {
    const admin = await seedUser({ role: "admin" });
    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", { session: admin });
    const res = await GET(req);
    const { status, body } = await readJson<{
      supported?: boolean;
      jobs?: unknown[];
    }>(res);
    expect(status).toBe(200);
    expect(body.supported).toBe(false);
    expect(body.jobs).toEqual([]);
  });

  it("GET /api/admin/jobs lists jobs from the configured queue", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    const stub = installStubQueue(makeJobs());
    setJobQueue(stub);

    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", { session: admin });
    const res = await GET(req);
    const { status, body } = await readJson<{
      supported?: boolean;
      jobs?: Array<{ id: string }>;
      total?: number;
    }>(res);
    expect(status).toBe(200);
    expect(body.supported).toBe(true);
    expect(body.jobs?.length).toBe(3);
  });

  it("GET ?state=failed filters to failed jobs", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(makeJobs()));

    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", {
      session: admin,
      query: { state: "failed" },
    });
    const res = await GET(req);
    const { body } = await readJson<{
      jobs?: Array<{ id: string; state: string }>;
    }>(res);
    expect(body.jobs?.length).toBe(1);
    expect(body.jobs?.[0]?.state).toBe("failed");
  });

  it("GET rejects unknown filters instead of silently widening the query", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(makeJobs()));

    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", {
      session: admin,
      query: { state: "unknown" },
    });
    expect((await GET(req)).status).toBe(400);
  });

  it("GET reports adapter response corruption as an internal contract error", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    const [job] = makeJobs();
    if (!job) throw new Error("Expected a job fixture");
    setJobQueue({
      enqueue: async () => "stub",
      start: async () => {},
      stop: async () => {},
      listJobs: async () => ({
        jobs: [{ ...job, unexpected: true }],
        total: 1,
      }),
    });

    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", { session: admin });
    expect((await GET(req)).status).toBe(500);
  });

  it("GET forbids non-admin roles", async () => {
    const editor = await seedUser({ role: "editor" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(makeJobs()));

    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", { session: editor });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("GET /api/admin/jobs/health initializes and reads queue diagnostics", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue({
      ...installStubQueue(makeJobs()),
      countByState: async () => ({
        created: 1,
        active: 0,
        completed: 1,
        failed: 1,
        retry: 0,
        cancelled: 0,
        expired: 0,
      }),
    });

    const { GET } = await import("@/app/api/admin/jobs/health/route");
    const req = buildRequest("/api/admin/jobs/health", { session: admin });
    const { status, body } = await readJson<{
      stuck?: { counts: { failed: number } } | null;
      recentFailures?: Array<{ id: string }>;
    }>(await GET(req));

    expect(status).toBe(200);
    expect(body.stuck?.counts.failed).toBe(1);
    expect(body.recentFailures?.map((failure) => failure.id)).toContain("j3");
  });

  it("POST /api/admin/jobs/[id]/retry re-enqueues a failed job", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(makeJobs()));

    const { POST } = await import("@/app/api/admin/jobs/[id]/retry/route");
    const req = buildRequest("/api/admin/jobs/j3/retry", {
      session: admin,
      method: "POST",
      body: {},
    });
    const res = await POST(req, { params: Promise.resolve({ id: "j3" }) });
    const { status, body } = await readJson<{ id?: string }>(res);
    expect(status).toBe(200);
    expect(body.id).toBe("j3-retry");
  });

  it("POST retry forbids non-admins", async () => {
    const editor = await seedUser({ role: "editor" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(makeJobs()));

    const { POST } = await import("@/app/api/admin/jobs/[id]/retry/route");
    const req = buildRequest("/api/admin/jobs/j3/retry", {
      session: editor,
      method: "POST",
      body: {},
    });
    const res = await POST(req, { params: Promise.resolve({ id: "j3" }) });
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("POST /api/admin/jobs/[id]/cancel cancels a pending job", async () => {
    const admin = await seedUser({ role: "admin" });
    const jobs = makeJobs();
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(jobs));

    const { POST } = await import("@/app/api/admin/jobs/[id]/cancel/route");
    const req = buildRequest("/api/admin/jobs/j1/cancel", {
      session: admin,
      method: "POST",
      body: {},
    });
    const res = await POST(req, { params: Promise.resolve({ id: "j1" }) });
    const { status } = await readJson(res);
    expect(status).toBe(200);
    expect(jobs.find((j) => j.id === "j1")?.state).toBe("cancelled");
  });

  it("POST cancel surfaces a failure when the job is already terminal", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(makeJobs()));

    const { POST } = await import("@/app/api/admin/jobs/[id]/cancel/route");
    // j2 is `completed` — can't be cancelled.
    const req = buildRequest("/api/admin/jobs/j2/cancel", {
      session: admin,
      method: "POST",
      body: {},
    });
    const res = await POST(req, { params: Promise.resolve({ id: "j2" }) });
    const { status } = await readJson(res);
    expect(status).toBe(500);
  });

  /**
   * Phase 13.2 — schedule + handler introspection and the
   * `since` time-range filter on the jobs list.
   */
  it("GET /api/admin/jobs/schedules returns supported:false when no queue is wired (handlers still listed)", async () => {
    const admin = await seedUser({ role: "admin" });
    const { GET } = await import("@/app/api/admin/jobs/schedules/route");
    const req = buildRequest("/api/admin/jobs/schedules", { session: admin });
    const res = await GET(req);
    const { status, body } = await readJson<{
      supported?: boolean;
      schedules?: unknown[];
      handlers?: string[];
    }>(res);
    expect(status).toBe(200);
    expect(body.supported).toBe(false);
    expect(body.schedules).toEqual([]);
    // Handler list is whatever the test harness registered.
    // It might be empty (no `registerBuiltinHandlers()` in
    // the harness flow) — the contract is just "always
    // return an array, never error."
    expect(Array.isArray(body.handlers)).toBe(true);
  });

  it("GET /api/admin/jobs/schedules surfaces registered handlers in the response", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue, registerJobHandler } = await import("@nexpress/core");
    setJobQueue(null);
    registerJobHandler("test:probe", async () => {});

    const { GET } = await import("@/app/api/admin/jobs/schedules/route");
    const req = buildRequest("/api/admin/jobs/schedules", { session: admin });
    const res = await GET(req);
    const { body } = await readJson<{ handlers?: string[] }>(res);
    expect(body.handlers).toContain("test:probe");
  });

  it("GET /api/admin/jobs/schedules lists schedules from the configured queue", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    const queue = {
      enqueue: async () => "stub",
      start: async () => {},
      stop: async () => {},
      listSchedules: async () => [
        {
          name: "system.revisionPrune",
          key: "",
          cron: "0 3 * * *",
          timezone: "UTC",
          data: {},
          createdOn: new Date().toISOString(),
          updatedOn: null,
        },
        {
          name: "system.sessionCleanup",
          key: "",
          cron: "0 * * * *",
          timezone: null,
          data: {},
          createdOn: new Date().toISOString(),
          updatedOn: null,
        },
      ],
    };
    setJobQueue(queue);

    const { GET } = await import("@/app/api/admin/jobs/schedules/route");
    const req = buildRequest("/api/admin/jobs/schedules", { session: admin });
    const res = await GET(req);
    const { status, body } = await readJson<{
      supported?: boolean;
      schedules?: Array<{ name: string; cron: string }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.supported).toBe(true);
    expect(body.schedules?.length).toBe(2);
    expect(body.schedules?.[0]?.name).toBe("system.revisionPrune");
    expect(body.schedules?.[0]?.cron).toBe("0 3 * * *");
  });

  it("GET /api/admin/jobs/schedules forbids non-admin roles", async () => {
    const editor = await seedUser({ role: "editor" });
    const { GET } = await import("@/app/api/admin/jobs/schedules/route");
    const req = buildRequest("/api/admin/jobs/schedules", { session: editor });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("GET /api/admin/jobs forwards `?since=...` to the queue's listJobs", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    let receivedSince: Date | undefined;
    const queue = {
      enqueue: async () => "stub",
      start: async () => {},
      stop: async () => {},
      listJobs: async (opts: { since?: Date }) => {
        receivedSince = opts.since;
        return { jobs: [], total: 0 };
      },
    };
    setJobQueue(queue);

    const since = "2026-04-26T00:00:00.000Z";
    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", {
      session: admin,
      query: { since },
    });
    await GET(req);
    expect(receivedSince).toBeInstanceOf(Date);
    expect(receivedSince?.toISOString()).toBe(since);
  });

  it("GET /api/admin/jobs rejects an invalid `?since=...` instead of dropping the filter", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    let receivedSince: Date | undefined;
    const queue = {
      enqueue: async () => "stub",
      start: async () => {},
      stop: async () => {},
      listJobs: async (opts: { since?: Date }) => {
        receivedSince = opts.since;
        return { jobs: [], total: 0 };
      },
    };
    setJobQueue(queue);

    const { GET } = await import("@/app/api/admin/jobs/route");
    const req = buildRequest("/api/admin/jobs", {
      session: admin,
      query: { since: "not-a-date" },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(receivedSince).toBeUndefined();
  });

  /**
   * Phase 13.3 — bulk retry + manual enqueue.
   */
  it("POST /api/admin/jobs/retry-all retries every failed job and reports counts", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    const jobs = makeJobs();
    // Add a couple more failed rows so the bulk path covers
    // the loop, not just a single failure.
    jobs.push({
      id: "j4",
      name: "media.cleanup",
      state: "failed",
      data: {},
      retryCount: 3,
      output: "ENOENT again",
      createdOn: new Date().toISOString(),
      startedOn: null,
      completedOn: new Date().toISOString(),
      source: "archive",
    });
    jobs.push({
      id: "j5",
      name: "media.cleanup",
      state: "failed",
      data: {},
      retryCount: 3,
      output: "ENOENT once more",
      createdOn: new Date().toISOString(),
      startedOn: null,
      completedOn: new Date().toISOString(),
      source: "archive",
    });
    setJobQueue(installStubQueue(jobs));

    const { POST } = await import("@/app/api/admin/jobs/retry-all/route");
    const req = buildRequest("/api/admin/jobs/retry-all", {
      session: admin,
      method: "POST",
      body: {},
    });
    const res = await POST(req);
    const { status, body } = await readJson<{
      retried?: number;
      failed?: number;
      remaining?: number;
      total?: number;
    }>(res);
    expect(status).toBe(200);
    expect(body.retried).toBe(3);
    expect(body.failed).toBe(0);
    expect(body.total).toBe(3);
  });

  it("POST /api/admin/jobs/retry-all forbids non-admin", async () => {
    const editor = await seedUser({ role: "editor" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue(installStubQueue(makeJobs()));

    const { POST } = await import("@/app/api/admin/jobs/retry-all/route");
    const req = buildRequest("/api/admin/jobs/retry-all", {
      session: editor,
      method: "POST",
      body: {},
    });
    const res = await POST(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("POST /api/admin/jobs/enqueue runs a registered handler", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue, registerJobHandler } = await import("@nexpress/core");
    let capturedType: string | undefined;
    let capturedData: unknown;
    let parseCount = 0;
    const queue = {
      enqueue: async (type: string, data: unknown) => {
        capturedType = type;
        capturedData = data;
        return "enq-1";
      },
      start: async () => {},
      stop: async () => {},
    };
    setJobQueue(queue);
    registerJobHandler("test:manual", async () => {}, {
      parsePayload(data) {
        parseCount += 1;
        if (Object.keys(data).length !== 1 || typeof data.probeId !== "string") {
          throw new Error("probeId is required");
        }
        return { probeId: data.probeId };
      },
    });

    const { POST } = await import("@/app/api/admin/jobs/enqueue/route");
    const req = buildRequest("/api/admin/jobs/enqueue", {
      session: admin,
      method: "POST",
      body: { type: "test:manual", data: { probeId: "probe-1" } },
    });
    const res = await POST(req);
    const { status, body } = await readJson<{
      id?: string;
      type?: string;
    }>(res);
    expect(status).toBe(200);
    expect(body.id).toBe("enq-1");
    expect(body.type).toBe("test:manual");
    expect(capturedType).toBe("test:manual");
    expect(capturedData).toEqual({ probeId: "probe-1" });
    expect(parseCount).toBe(1);
  });

  it("POST /api/admin/jobs/enqueue rejects unknown handler types (defensive UX)", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue({
      enqueue: async () => "ignored",
      start: async () => {},
      stop: async () => {},
    });

    const { POST } = await import("@/app/api/admin/jobs/enqueue/route");
    const req = buildRequest("/api/admin/jobs/enqueue", {
      session: admin,
      method: "POST",
      body: { type: "media:nope-not-a-handler", data: {} },
    });
    const res = await POST(req);
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });

  it("POST /api/admin/jobs/enqueue forbids non-admin", async () => {
    const editor = await seedUser({ role: "editor" });
    const { setJobQueue } = await import("@nexpress/core");
    setJobQueue({
      enqueue: async () => "ignored",
      start: async () => {},
      stop: async () => {},
    });

    const { POST } = await import("@/app/api/admin/jobs/enqueue/route");
    const req = buildRequest("/api/admin/jobs/enqueue", {
      session: editor,
      method: "POST",
      body: { type: "media:cleanup", data: {} },
    });
    const res = await POST(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });
});
