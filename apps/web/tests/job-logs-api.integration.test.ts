import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { npJobLogs } from "@nexpress/core/db";
import { listJobLogs, recordJobLog, runInJobContext } from "@nexpress/core/jobs";

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

  it("returns the captured log entries for the job to an admin", async () => {
    const session = await seedUser({ email: "logs-admin@example.com", role: "admin" });

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

  it("rejects callers below admin with 403", async () => {
    const session = await seedUser({ email: "logs-editor@example.com", role: "editor" });
    const request = buildRequest("/api/admin/jobs/anything/logs", { session });

    const { status } = await readJson<unknown>(
      await logsGET(request, { params: Promise.resolve({ id: "anything" }) }),
    );
    expect(status).toBe(403);
  });

  it("paginates tied timestamps in stable ID order in both directions", async () => {
    const session = await seedUser({ email: "logs-pagination@example.com", role: "admin" });
    const db = await getTestDb();
    const jobId = "api-test-tied-logs";
    const ids = [1, 2, 3, 4, 5].map(
      (value) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`,
    );
    // Insert ties out of ID order so heap order cannot satisfy the contract.
    await db.insert(npJobLogs).values(
      [4, 2, 1, 3, 0].map((index) => ({
        id: ids[index],
        jobId,
        level: "info",
        message: `entry-${index}`,
        createdAt: new Date(
          index === 0
            ? "2026-09-22T00:00:00Z"
            : index === 4
              ? "2026-09-24T00:00:00Z"
              : "2026-09-23T00:00:00Z",
        ),
      })),
    );
    const chronological: string[] = [];
    const reverse: string[] = [];
    for (const offset of [0, 2, 4, 6]) {
      const request = buildRequest(`/api/admin/jobs/${jobId}/logs?limit=2&offset=${offset}`, {
        session,
      });
      const { status, body } = await readJson<{
        jobId: string;
        total: number;
        entries: Array<{ id: string }>;
      }>(await logsGET(request, { params: Promise.resolve({ id: jobId }) }));
      expect(status).toBe(200);
      expect(body.jobId).toBe(jobId);
      expect(body.total).toBe(5);
      expect(body.entries).toHaveLength(Math.min(2, Math.max(0, 5 - offset)));
      chronological.push(...body.entries.map((entry) => entry.id));
      // The service supports descending order; the HTTP route is oldest-first only.
      const descending = await listJobLogs(jobId, { limit: 2, offset, order: "desc" });
      reverse.push(...descending.map((entry) => entry.id));
    }
    expect(chronological).toEqual(ids);
    expect(reverse).toEqual([...ids].reverse());
  });

  it("returns an empty entries array for a job with no captured logs", async () => {
    const session = await seedUser({ email: "logs-empty@example.com", role: "admin" });
    const request = buildRequest("/api/admin/jobs/no-such-job/logs", { session });

    const { status, body } = await readJson<{ total: number; entries: unknown[] }>(
      await logsGET(request, { params: Promise.resolve({ id: "no-such-job" }) }),
    );
    expect(status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.entries).toEqual([]);
  });
});
