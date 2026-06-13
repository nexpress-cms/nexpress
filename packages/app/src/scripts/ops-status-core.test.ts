import { describe, expect, it } from "vitest";

import {
  buildOpsStatusJson,
  collectOpsStatusChecks,
  renderBriefOpsStatus,
  summarizeOpsChecks,
} from "./ops-status-core.js";
import type { CheckResult } from "./doctor-readiness.js";

const checks: CheckResult[] = [
  { id: "runtime.node", state: "ok", label: "Node.js >= 20", detail: "24.11.1" },
  {
    id: "jobs.enabled",
    state: "warn",
    label: "Jobs enabled",
    detail: "NP_ENABLE_JOBS not set",
  },
  {
    id: "env.database_url",
    state: "error",
    label: "DATABASE_URL",
    detail: "not set",
  },
];

describe("ops status core", () => {
  it("summarizes checks for the stable ops JSON contract", () => {
    expect(summarizeOpsChecks(checks)).toEqual({ total: 3, errors: 1, warnings: 1 });
  });

  it("builds an agent-readable blocked report", () => {
    expect(buildOpsStatusJson(checks)).toEqual({
      schemaVersion: "np.ops.v1",
      ok: false,
      status: "blocked",
      summary: { total: 3, errors: 1, warnings: 1 },
      nextCommand: "pnpm run doctor -- --fix-plan",
      projectNextCommand: "pnpm run doctor -- --fix-plan",
      checks,
    });
  });

  it("includes the worker heartbeat check in the stable summary count", () => {
    expect(buildOpsStatusJson(checks).summary.total).toBe(3);
  });

  it("omits nextCommand when the site is ready", () => {
    expect(
      buildOpsStatusJson([{ id: "runtime.node", state: "ok", label: "Node.js >= 20" }]),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        status: "ready",
        nextCommand: null,
      }),
    );
  });

  it("promotes actionable check hints into the low-token next command", () => {
    const report = buildOpsStatusJson([
      {
        id: "jobs.worker_stale",
        state: "warn",
        label: "Worker heartbeat",
        hint: "nexpress ops jobs retry-all --state failed --json",
      },
    ]);

    expect(report).toEqual(
      expect.objectContaining({
        status: "attention",
        nextCommand: "nexpress ops jobs retry-all --state failed --json",
        projectNextCommand: "pnpm run ops:jobs -- retry-all --state failed --json",
      }),
    );
  });

  it("renders compact human output", () => {
    expect(renderBriefOpsStatus(buildOpsStatusJson(checks), { color: false })).toBe(
      [
        "NexPress ops status",
        "blocked: 1 errors, 1 warnings.",
        "[ok] runtime.node Node.js >= 20 - 24.11.1",
        "[warn] jobs.enabled Jobs enabled - NP_ENABLE_JOBS not set",
        "[error] env.database_url DATABASE_URL - not set",
        "Next: pnpm run doctor -- --fix-plan",
      ].join("\n"),
    );
  });

  it("collects a blocking DATABASE_URL check when the env is missing it", async () => {
    const collected = await collectOpsStatusChecks({
      NP_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
      SITE_URL: "http://localhost:3000",
      NP_STORAGE_ADAPTER: "s3",
      NP_S3_BUCKET: "media",
      NP_S3_REGION: "us-east-1",
    });

    expect(collected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "env.database_url",
          state: "error",
          label: "DATABASE_URL",
        }),
        expect.objectContaining({
          id: "database.reachable",
          state: "error",
        }),
      ]),
    );
  });
});
