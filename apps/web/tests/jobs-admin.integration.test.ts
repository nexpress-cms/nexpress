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
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
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
        const filtered = state
          ? jobs.filter((j) => j.state === state)
          : jobs;
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
        data: { mediaId: "m1" },
        createdOn: new Date().toISOString(),
      },
      {
        id: "j2",
        name: "content.afterSave",
        state: "completed",
        data: { docId: "d1" },
        createdOn: new Date().toISOString(),
        completedOn: new Date().toISOString(),
      },
      {
        id: "j3",
        name: "media.cleanup",
        state: "failed",
        data: { mediaId: "m2" },
        retryCount: 3,
        output: "ENOENT: file disappeared mid-cleanup",
        createdOn: new Date().toISOString(),
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
});
