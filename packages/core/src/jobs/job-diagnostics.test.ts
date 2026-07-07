import { describe, expect, it, vi } from "vitest";

import { listRecentJobFailures } from "./job-diagnostics.js";
import type { NpJobListOptions, NpJobQueue, NpJobSummary } from "./queue.js";

vi.mock("./job-log.js", () => ({
  listJobLogs: vi.fn((jobId: string) =>
    Promise.resolve([
      {
        id: `log-${jobId}`,
        jobId,
        level: "error",
        message: `last log for ${jobId}`,
        context: null,
        createdAt: new Date("2026-07-01T00:10:00.000Z"),
      },
    ]),
  ),
  countJobLogs: vi.fn(() => Promise.resolve(3)),
}));

function job(input: Partial<NpJobSummary> & Pick<NpJobSummary, "id" | "state">): NpJobSummary {
  return {
    id: input.id,
    name: input.name ?? "media.processImage",
    state: input.state,
    data: input.data ?? {},
    retryCount: input.retryCount,
    output: input.output ?? null,
    createdOn: input.createdOn ?? "2026-07-01T00:00:00.000Z",
    startedOn: input.startedOn ?? null,
    completedOn: input.completedOn ?? null,
    source: input.source,
  };
}

describe("listRecentJobFailures", () => {
  it("returns unsupported when the queue cannot list jobs", async () => {
    await expect(listRecentJobFailures(null)).resolves.toEqual({
      supported: false,
      failures: [],
    });
  });

  it("sorts recent failed jobs and attaches their latest log", async () => {
    const listJobs = vi.fn(({ state }: NpJobListOptions) =>
      Promise.resolve({
        total: 1,
        jobs:
          state === "failed"
            ? [
                job({
                  id: "job-old",
                  state: "failed",
                  completedOn: "2026-07-01T00:05:00.000Z",
                }),
                job({
                  id: "job-new",
                  state: "failed",
                  completedOn: "2026-07-01T00:20:00.000Z",
                }),
              ]
            : [],
      }),
    );
    const queue = {
      enqueue: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      listJobs,
    } satisfies NpJobQueue;

    const result = await listRecentJobFailures(queue, {
      states: ["failed"],
      limit: 1,
    });

    expect(result.supported).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toEqual(
      expect.objectContaining({
        id: "job-new",
        state: "failed",
        logCount: 3,
        lastLog: expect.objectContaining({ message: "last log for job-new" }),
      }),
    );
    expect(listJobs).toHaveBeenCalledWith({ state: "failed", limit: 1 });
  });
});
