import { describe, expect, it } from "vitest";

import { buildOpsJobsJson, renderBriefOpsJobsStatus, type OpsJobsCounts } from "./ops-jobs-core.js";

const emptyCounts: OpsJobsCounts = {
  created: 0,
  active: 0,
  completed: 0,
  failed: 0,
  retry: 0,
  cancelled: 0,
  expired: 0,
};

const pause = {
  paused: false,
  changedAt: new Date(0).toISOString(),
  changedByUserId: null,
  reason: null,
};

describe("ops jobs core", () => {
  it("reports disabled jobs as a non-blocking status", () => {
    expect(buildOpsJobsJson({ enabled: false, pause, counts: emptyCounts, workers: [] })).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-jobs.v1",
        ok: true,
        status: "disabled",
        nextCommand: null,
        projectNextCommand: null,
      }),
    );
  });

  it("blocks when queued jobs exist but no worker is alive", () => {
    const report = buildOpsJobsJson({
      enabled: true,
      pause,
      counts: { ...emptyCounts, created: 3 },
      workers: [],
    });
    expect(report).toEqual(
      expect.objectContaining({
        ok: false,
        status: "blocked",
        nextCommand: "NP_ENABLE_JOBS=1 pnpm run worker",
        projectNextCommand: "NP_ENABLE_JOBS=1 pnpm run worker",
      }),
    );
  });

  it("marks failed jobs as attention without blocking deploy", () => {
    const report = buildOpsJobsJson({
      enabled: true,
      pause,
      counts: { ...emptyCounts, failed: 1 },
      workers: [
        {
          id: "worker-1",
          status: "running",
          startedAt: "2026-06-09T00:00:00.000Z",
          lastSeenAt: "2026-06-09T00:01:00.000Z",
          lastSeenAgoMs: 1_000,
          alive: true,
          meta: {},
        },
      ],
    });
    expect(report.status).toBe("attention");
    expect(report.ok).toBe(true);
    expect(report.nextCommand).toBe("nexpress ops jobs retry-all --state failed --json");
    expect(report.projectNextCommand).toBe(
      "pnpm --silent run ops:jobs -- retry-all --state failed --json",
    );
    expect(renderBriefOpsJobsStatus(report, { color: false })).toContain("attention: enabled");
  });

  it("points expired-only failures at the expired retry command", () => {
    const report = buildOpsJobsJson({
      enabled: true,
      pause,
      counts: { ...emptyCounts, expired: 2 },
      workers: [
        {
          id: "worker-1",
          status: "running",
          startedAt: "2026-06-09T00:00:00.000Z",
          lastSeenAt: "2026-06-09T00:01:00.000Z",
          lastSeenAgoMs: 1_000,
          alive: true,
          meta: {},
        },
      ],
    });

    expect(report.status).toBe("attention");
    expect(report.nextCommand).toBe("nexpress ops jobs retry-all --state expired --json");
  });

  it("surfaces recent failure details in the stable jobs report", () => {
    const report = buildOpsJobsJson({
      enabled: true,
      pause,
      counts: { ...emptyCounts, failed: 1 },
      workers: [],
      recentFailures: [
        {
          id: "job-1",
          name: "media.processImage",
          state: "failed",
          source: "archive",
          output: "sharp failed",
          createdOn: "2026-07-01T00:00:00.000Z",
          startedOn: "2026-07-01T00:01:00.000Z",
          completedOn: "2026-07-01T00:02:00.000Z",
          logCount: 1,
          lastLog: {
            id: "log-1",
            level: "error",
            message: "variant generation failed",
            context: null,
            createdAt: "2026-07-01T00:02:00.000Z",
          },
        },
      ],
    });

    expect(report.recentFailures).toHaveLength(1);
    expect(renderBriefOpsJobsStatus(report, { color: false })).toContain(
      "- failed media.processImage job-1: variant generation failed",
    );
  });

  it("points paused queues at resume instead of a passive status check", () => {
    const report = buildOpsJobsJson({
      enabled: true,
      pause: { ...pause, paused: true, reason: "maintenance" },
      counts: emptyCounts,
      workers: [],
    });

    expect(report).toEqual(
      expect.objectContaining({
        status: "blocked",
        nextCommand: "nexpress ops jobs resume --json",
        projectNextCommand: "pnpm --silent run ops:jobs -- resume --json",
      }),
    );
  });

  it("includes mutation audit details in jobs reports", () => {
    const report = buildOpsJobsJson({
      enabled: true,
      pause: { ...pause, paused: true, reason: "maintenance" },
      counts: emptyCounts,
      workers: [],
      mutation: {
        action: "pause",
        applied: true,
        reason: "maintenance",
        error: null,
      },
    });

    expect(report.mutation).toEqual(
      expect.objectContaining({
        action: "pause",
        applied: true,
      }),
    );
    expect(renderBriefOpsJobsStatus(report, { color: false })).toContain(
      "mutation: pause applied=true",
    );
  });

  it("describes retry-all dry-run audits without marking them applied", () => {
    const report = buildOpsJobsJson({
      enabled: true,
      pause,
      counts: { ...emptyCounts, failed: 2 },
      workers: [],
      mutation: {
        action: "retry-all",
        applied: false,
        mode: "dry-run",
        reason: "state=failed",
        error: null,
        target: { state: "failed", name: null, limit: 200 },
        result: { matched: 2, planned: 2, remaining: 0 },
      },
    });

    expect(report.mutation).toEqual(
      expect.objectContaining({
        action: "retry-all",
        mode: "dry-run",
        applied: false,
      }),
    );
    expect(renderBriefOpsJobsStatus(report, { color: false })).toContain(
      "mutation: retry-all applied=false",
    );
  });
});
