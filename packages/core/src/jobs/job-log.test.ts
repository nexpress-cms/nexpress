import { describe, expect, it } from "vitest";

import { countJobLogs, listJobLogs, pruneJobLogsOlderThan } from "./job-log.js";

describe("job log runtime boundaries", () => {
  it("rejects invalid query options before database access", async () => {
    await expect(listJobLogs("job-1", { limit: 0 })).rejects.toThrow("job.logs.limit");
    await expect(listJobLogs("job-1", { extra: true } as never)).rejects.toThrow("job.logs.extra");
    await expect(countJobLogs("job-1", "not-a-date" as never)).rejects.toThrow(
      "job.logs.sinceCreatedAt",
    );
  });

  it("rejects invalid retention cutoffs before database access", async () => {
    await expect(pruneJobLogsOlderThan(null as never)).rejects.toThrow("job.logs.cutoff");
  });
});
