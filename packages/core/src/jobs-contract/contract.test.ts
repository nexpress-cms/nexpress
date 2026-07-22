import { describe, expect, it } from "vitest";

import {
  npAnalyzeJobData,
  npAnalyzeJobListWire,
  npAnalyzeJobPayload,
  npAnalyzeJobType,
  npAnalyzeJobsHealthWire,
  npAnalyzeJobsEnabledFlag,
  npAnalyzeRetryAllJobsWire,
  npAnalyzeScheduleListWire,
  npNormalizeJobData,
  npPluginScheduledTaskQueueName,
  npRequireJobQueueName,
  npRequireJobLogsWire,
  npSerializeWorkerHealthEntry,
} from "./contract.js";

const STAFF_ID = "8dbb88e6-eb42-4c5d-968d-0b253fd5012f";
const MEMBER_ID = "7d133e30-8079-47a7-b970-66cd478956de";
const DOCUMENT_ID = "d4cafb07-c120-4503-90fa-6d6fc4104ce3";

describe("job runtime contract", () => {
  it("keeps the registry extensible while rejecting non-canonical job types", () => {
    expect(npAnalyzeJobType("search:reindex")).toEqual({
      ok: true,
      value: "search:reindex",
    });
    expect(npAnalyzeJobType("search reindex").ok).toBe(false);
    expect(npAnalyzeJobType("reindex").ok).toBe(false);
    expect(() => npRequireJobQueueName("queue@invalid")).toThrow(/pg-boss queue-name/u);
  });

  it("uses one exact jobs-enabled environment contract", () => {
    expect(npAnalyzeJobsEnabledFlag("1")).toEqual({ ok: true, value: true });
    expect(npAnalyzeJobsEnabledFlag("true")).toEqual({ ok: true, value: true });
    expect(npAnalyzeJobsEnabledFlag(undefined)).toEqual({ ok: true, value: false });
    expect(npAnalyzeJobsEnabledFlag("yes").ok).toBe(false);
  });

  it("normalizes bounded JSON deterministically and rejects unsafe values", () => {
    expect(npNormalizeJobData({ z: 1, a: { b: true } })).toEqual({
      a: { b: true },
      z: 1,
    });
    expect(npAnalyzeJobData({ invalid: undefined }).ok).toBe(false);
    expect(npAnalyzeJobData({ invalid: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(npAnalyzeJobData([]).ok).toBe(false);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(npAnalyzeJobData(circular).ok).toBe(false);

    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "present";
    expect(npAnalyzeJobData({ sparse }).ok).toBe(false);

    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "hidden work",
    });
    expect(npAnalyzeJobData({ accessor }).ok).toBe(false);

    const negativeZero = npNormalizeJobData({ value: -0 });
    expect(Object.is(negativeZero.value, -0)).toBe(false);
    expect(negativeZero.value).toBe(0);
  });

  it("enforces exact built-in payloads and one content actor", () => {
    expect(
      npAnalyzeJobPayload("content:afterSave", {
        siteId: "default",
        collection: "posts",
        documentId: DOCUMENT_ID,
        operation: "update",
        userId: STAFF_ID,
        memberId: null,
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeJobPayload("content:afterSave", {
        siteId: "tenant-a",
        collection: "posts",
        documentId: DOCUMENT_ID,
        operation: "update",
        userId: null,
        memberId: MEMBER_ID,
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeJobPayload("content:afterSave", {
        siteId: "default",
        collection: "posts",
        documentId: DOCUMENT_ID,
        operation: "update",
        userId: STAFF_ID,
        memberId: MEMBER_ID,
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeJobPayload("content:afterSave", {
        siteId: "Tenant A",
        collection: "posts",
        documentId: DOCUMENT_ID,
        operation: "update",
        userId: STAFF_ID,
        memberId: null,
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeJobPayload("content:afterDelete", {
        siteId: "tenant-a",
        collection: "posts",
        documentId: DOCUMENT_ID,
        userId: null,
        memberId: MEMBER_ID,
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeJobPayload("content:afterDelete", {
        collection: "posts",
        documentId: DOCUMENT_ID,
        userId: null,
        memberId: MEMBER_ID,
      }).ok,
    ).toBe(false);
    expect(npAnalyzeJobPayload("search:reindex", { collection: "forum-posts" })).toEqual({
      ok: true,
      value: { collection: "forum-posts" },
    });
    expect(npAnalyzeJobPayload("search:reindex", { collection: "Forum Posts" }).ok).toBe(false);
    expect(
      npAnalyzeJobPayload("search:reindex", { collection: "forum-posts", extra: true }).ok,
    ).toBe(false);
    expect(npAnalyzeJobPayload("media:cleanup", { unexpected: true }).ok).toBe(false);
    expect(npAnalyzeJobPayload("notifications:sendDigest", { cadence: "monthly" }).ok).toBe(false);
    expect(
      npAnalyzeJobPayload("auth:sendPasswordReset", {
        email: "admin@example.com",
        name: "Admin",
        purpose: "reset",
        resetUrl: "https://example.com/admin/set-password?token=secret",
        expiresAt: "2026-07-20T12:30:00.000Z",
        siteName: "Example",
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeJobPayload("auth:sendPasswordReset", {
        email: "admin@example.com",
        name: "Admin",
        token: "duplicate-secret",
        purpose: "reset",
        resetUrl: "https://example.com/admin/set-password?token=secret",
        expiresAt: "2026-07-20T12:30:00.000Z",
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeJobPayload("members:sendVerifyEmail", {
        email: "member@example.com",
        displayName: "Member",
        verifyUrl: "https://example.com/members/verify?token=secret",
        expiresAt: "tomorrow",
      }).ok,
    ).toBe(false);
  });

  it("rejects incomplete or widened job-list responses", () => {
    const valid = {
      supported: true,
      total: 1,
      jobs: [
        {
          id: "job-1",
          name: "media.processImage",
          state: "failed",
          data: { mediaId: DOCUMENT_ID },
          retryCount: 2,
          output: "processor failed",
          createdOn: "2026-07-13T01:00:00.000Z",
          startedOn: "2026-07-13T01:00:01.000Z",
          completedOn: "2026-07-13T01:00:02.000Z",
          source: "archive",
        },
      ],
    };
    expect(npAnalyzeJobListWire(valid).ok).toBe(true);
    expect(npAnalyzeJobListWire({ ...valid, extra: true }).ok).toBe(false);
    expect(
      npAnalyzeJobListWire({
        ...valid,
        jobs: valid.jobs.map(({ retryCount: _retryCount, ...job }) => job),
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeJobListWire({
        ...valid,
        jobs: [{ ...valid.jobs[0], data: { mediaId: "not-a-uuid" } }],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeJobListWire({ ...valid, total: 2, jobs: [valid.jobs[0], valid.jobs[0]] }).ok,
    ).toBe(false);

    const accessorWire = Object.defineProperty({ ...valid }, "supported", {
      enumerable: true,
      get: () => true,
    });
    expect(npAnalyzeJobListWire(accessorWire).ok).toBe(false);
  });

  it("ties bulk retry errors exactly to failed result rows", () => {
    expect(
      npAnalyzeRetryAllJobsWire({
        retried: 1,
        failed: 1,
        total: 2,
        remaining: 1,
        results: [
          { id: "job-1", ok: true },
          { id: "job-2", ok: false, error: "still broken" },
        ],
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeRetryAllJobsWire({
        retried: 0,
        failed: 1,
        total: 1,
        remaining: 1,
        results: [{ id: "job-1", ok: false }],
      }).ok,
    ).toBe(false);
  });

  it("connects persisted schedules to their built-in payload contract", () => {
    const schedule = {
      name: "notifications.sendDigest",
      key: "daily",
      cron: "0 8 * * *",
      timezone: "UTC",
      data: { cadence: "daily" },
      createdOn: "2026-07-13T00:00:00.000Z",
      updatedOn: null,
    };
    expect(
      npAnalyzeScheduleListWire({ supported: true, schedules: [schedule], handlers: [] }).ok,
    ).toBe(true);
    expect(
      npAnalyzeScheduleListWire({
        supported: true,
        schedules: [{ ...schedule, data: { cadence: "weekly" } }],
        handlers: [],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeScheduleListWire({
        supported: true,
        schedules: [{ ...schedule, data: { cadence: "monthly" } }],
        handlers: [],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeScheduleListWire({
        supported: true,
        schedules: [{ ...schedule, updatedOn: "2026-07-12T23:59:59.000Z" }],
        handlers: [],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeScheduleListWire({
        supported: true,
        schedules: [
          {
            ...schedule,
            name: npPluginScheduledTaskQueueName("analytics", "daily"),
            key: "",
            data: { pluginId: "analytics", taskId: "weekly" },
          },
        ],
        handlers: [],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeScheduleListWire({
        supported: true,
        schedules: [
          {
            ...schedule,
            name: npPluginScheduledTaskQueueName("analytics", "daily"),
            key: "unexpected",
            data: { pluginId: "analytics", taskId: "daily" },
          },
        ],
        handlers: [],
      }).ok,
    ).toBe(false);
  });

  it("builds pg-boss-safe collision-free plugin schedule queue names", () => {
    const scoped = npPluginScheduledTaskQueueName("@scope/plugin", "daily.rollup");
    expect(scoped).toMatch(/^plugin\.scheduledTask\.[a-f0-9]+\.[a-f0-9]+$/u);
    expect(scoped).not.toContain("@");
    expect(scoped).not.toBe(npPluginScheduledTaskQueueName("scope-plugin", "daily.rollup"));
  });

  it("keeps maximum-length plugin schedule queue names inside the wire contract", () => {
    const name = npPluginScheduledTaskQueueName("p".repeat(128), "t".repeat(128));

    expect(name).toHaveLength(534);
    expect(npRequireJobQueueName(name)).toBe(name);
  });

  it("checks aggregate health and exact log wire shapes", () => {
    const pause = {
      paused: false,
      changedAt: "2026-07-13T00:00:00.000Z",
      changedByUserId: null,
      reason: null,
    };
    const worker = {
      id: "worker-1",
      status: "running",
      startedAt: "2026-07-13T00:00:00.000Z",
      lastSeenAt: "2026-07-13T00:01:00.000Z",
      meta: {},
      alive: true,
      lastSeenAgoMs: 1_000,
    };
    expect(
      npAnalyzeJobsHealthWire({
        workers: [worker],
        aliveCount: 1,
        totalCount: 1,
        newestHeartbeat: worker.lastSeenAt,
        pause,
        stuck: null,
        recentFailures: [],
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeJobsHealthWire({
        workers: [worker],
        aliveCount: 0,
        totalCount: 1,
        newestHeartbeat: worker.lastSeenAt,
        pause,
        stuck: null,
        recentFailures: [],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeJobsHealthWire({
        workers: [worker],
        aliveCount: 1,
        totalCount: 1,
        newestHeartbeat: worker.lastSeenAt,
        pause,
        stuck: {
          counts: {
            created: 0,
            active: 0,
            completed: 0,
            failed: 0,
            retry: 0,
            cancelled: 0,
            expired: 0,
          },
          thresholds: { failed: 0, expired: 0 },
        },
        recentFailures: [],
      }).ok,
    ).toBe(true);

    expect(() =>
      npRequireJobLogsWire({
        jobId: "job-1",
        total: 1,
        entries: [
          {
            id: "c53030ad-14e3-4295-868f-37e4bd49e166",
            level: "fatal",
            message: "bad",
            context: null,
            createdAt: "2026-07-13T00:01:00.000Z",
          },
        ],
      }),
    ).toThrow(/job\.logs\.entries\[0\]\.level/u);
  });

  it("rejects invalid worker health serialization inputs", () => {
    const heartbeat = {
      id: "worker-1",
      status: "running" as const,
      startedAt: new Date("2026-07-13T00:00:00.000Z"),
      lastSeenAt: new Date("2026-07-13T00:01:00.000Z"),
      meta: {},
    };
    expect(() =>
      npSerializeWorkerHealthEntry(heartbeat, new Date("2026-07-13T00:02:00.000Z"), 0),
    ).toThrow(/worker\.staleThresholdMs/u);
  });
});
