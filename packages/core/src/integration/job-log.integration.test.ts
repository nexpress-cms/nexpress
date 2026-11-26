import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  countJobLogs,
  listJobLogs,
  pruneJobLogsOlderThan,
  recordJobLog,
  runInJobContext,
} from "../jobs/job-log.js";
import { getLogger } from "../observability/logger.js";
import { npJobLogs } from "../db/schema/system.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

async function waitForJobLog(jobId: string, message: string) {
  const deadline = Date.now() + 1000;
  let rows = await listJobLogs(jobId);

  while (!rows.some((row) => row.message === message) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = await listJobLogs(jobId);
  }

  return rows;
}

describe.skipIf(skipIfNoTestDb())("np_job_logs (Phase 20.3a integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("recordJobLog inside runInJobContext writes a row stamped with the job id", async () => {
    await runInJobContext("job-A", async () => {
      await recordJobLog("info", "hello", { extra: 1 });
    });

    const rows = await listJobLogs("job-A");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.level).toBe("info");
    expect(rows[0]?.message).toBe("hello");
    expect(rows[0]?.context).toEqual({ extra: 1 });
  });

  it("recordJobLog outside any job context is a silent no-op", async () => {
    await recordJobLog("info", "should-not-land");
    const rows = await listJobLogs("anything");
    expect(rows).toHaveLength(0);
  });

  it("logger.info inside a job context tees into np_job_logs via the lazy import", async () => {
    await runInJobContext("job-B", async () => {
      getLogger().info("via logger", { source: "test" });
    });

    const rows = await waitForJobLog("job-B", "via logger");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const teed = rows.find((r) => r.message === "via logger");
    expect(teed).toBeDefined();
    expect(teed?.level).toBe("info");
    expect(teed?.context).toMatchObject({ source: "test" });
  });

  it("concurrent contexts do not cross-contaminate (ALS isolation)", async () => {
    await Promise.all([
      runInJobContext("job-C1", async () => {
        await recordJobLog("info", "from-C1");
      }),
      runInJobContext("job-C2", async () => {
        await recordJobLog("warn", "from-C2");
      }),
    ]);

    const c1 = await listJobLogs("job-C1");
    const c2 = await listJobLogs("job-C2");
    expect(c1).toHaveLength(1);
    expect(c1[0]?.message).toBe("from-C1");
    expect(c2).toHaveLength(1);
    expect(c2[0]?.level).toBe("warn");
  });

  it("counts only the requested job and preserves the inclusive timestamp boundary through pruning", async () => {
    const db = await getTestDb();
    const cutoff = new Date("2026-07-01T00:00:00.000Z");
    const after = new Date(cutoff.getTime() + 1);
    await db.insert(npJobLogs).values([
      { jobId: "job-D", level: "info", message: "old", createdAt: new Date(cutoff.getTime() - 1) },
      { jobId: "job-D", level: "info", message: "boundary", createdAt: cutoff },
      { jobId: "job-D", level: "error", message: "new", createdAt: after },
      { jobId: "job-other", level: "info", message: "other", createdAt: cutoff },
    ]);

    expect(await countJobLogs("job-D")).toBe(3);
    expect(await countJobLogs("missing")).toBe(0);
    expect(await countJobLogs("job-D", cutoff)).toBe(2);
    expect(await countJobLogs("job-D", after)).toBe(1);
    expect(await countJobLogs("job-D", new Date(after.getTime() + 1))).toBe(0);
    expect(await countJobLogs("job-other", cutoff)).toBe(1);

    expect(await pruneJobLogsOlderThan(cutoff)).toBe(1);
    expect((await listJobLogs("job-D")).map((row) => row.message)).toEqual(["boundary", "new"]);
    expect(await countJobLogs("job-D")).toBe(2);
    expect(await countJobLogs("job-other")).toBe(1);
  });
});
