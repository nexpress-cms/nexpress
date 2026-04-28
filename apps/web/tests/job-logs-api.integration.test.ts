import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { recordJobLog, runInJobContext } from "@nexpress/core";

import { GET as logsGET } from "@/app/api/admin/jobs/[id]/logs/route";

describe.skipIf(skipIfNoTestDb())("GET /api/admin/jobs/[id]/logs (Phase 20.3b)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("returns the captured log entries for the job to an editor", async () => {
    const session = await seedUser({ email: "logs-editor@example.com", role: "editor" });

    await runInJobContext("api-test-job-1", async () => {
      await recordJobLog("info", "first");
      await recordJobLog("warn", "second", { extra: 1 });
    });

    const request = buildRequest("/api/admin/jobs/api-test-job-1/logs", { session });
    const { status, body } = await readJson<{
      jobId: string;
      total: number;
      entries: Array<{ level: string; message: string; context: unknown }>;
    }>(await logsGET(request, { params: Promise.resolve({ id: "api-test-job-1" }) }));

    expect(status).toBe(200);
    expect(body.jobId).toBe("api-test-job-1");
    expect(body.total).toBe(2);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]?.message).toBe("first");
    expect(body.entries[1]?.context).toEqual({ extra: 1 });
  });

  it("rejects callers below editor with 403", async () => {
    const session = await seedUser({ email: "logs-viewer@example.com", role: "viewer" });
    const request = buildRequest("/api/admin/jobs/anything/logs", { session });

    const { status } = await readJson<unknown>(
      await logsGET(request, { params: Promise.resolve({ id: "anything" }) }),
    );
    expect(status).toBe(403);
  });

  it("returns an empty entries array for a job with no captured logs", async () => {
    const session = await seedUser({ email: "logs-empty@example.com", role: "editor" });
    const request = buildRequest("/api/admin/jobs/no-such-job/logs", { session });

    const { status, body } = await readJson<{ total: number; entries: unknown[] }>(
      await logsGET(request, { params: Promise.resolve({ id: "no-such-job" }) }),
    );
    expect(status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.entries).toEqual([]);
  });
});
