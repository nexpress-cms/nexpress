import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { npRequireAgentHealthSummaryV1 } from "@nexpress/core/agent-contract";

const { collectAgentSummary, collectMaintenance } = vi.hoisted(() => ({
  collectAgentSummary: vi.fn(),
  collectMaintenance: vi.fn(),
}));
vi.mock("@nexpress/core/agents", () => ({
  npCollectAgentHealthSummaryV1: collectAgentSummary,
  npCollectAgentMaintenanceHealthV1: collectMaintenance,
}));
vi.mock("pg", () => ({
  default: {
    Client: class {
      async connect() {}
      query() {
        return Promise.resolve({ rows: [] });
      }
      async end() {}
    },
  },
}));

import { formatAgentHealthDetail } from "../lib/agent-health-presentation.js";
import { formatAgentMaintenanceDetail } from "../lib/agent-maintenance-presentation.js";
import { collectDoctorChecks } from "./doctor-core.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  collectAgentSummary.mockReset();
  collectMaintenance.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("Doctor Agent health presentation", () => {
  it.each(["ok", "warn", "error"] as const)(
    "preserves %s severity and the complete returned aggregate in the shared detail",
    async (state) => {
      const summary = npRequireAgentHealthSummaryV1({
        schemaVersion: "np.agent-health-summary.v1",
        generatedAt: "2026-09-20T00:00:00.000Z",
        state,
        issueCount: state === "error" ? 3 : 0,
        issues:
          state === "error"
            ? [{ code: "AGENT_STALE_INVOCATION", count: 3, oldestAgeSeconds: 7201 }]
            : [],
        states: [
          { entity: "connection", state: "ready", count: 0, oldestAgeSeconds: null },
          { entity: "invocation", state: "running", count: 3, oldestAgeSeconds: 7201 },
        ],
        readiness: {
          providers: {
            state: state === "warn" ? "unknown" : "ready",
            requiredCount: 2,
            availableCount: state === "warn" ? 0 : 2,
          },
          vault: { state: "not-required", requiredCount: 0, availableCount: 0 },
        },
      });
      collectAgentSummary.mockResolvedValueOnce(summary);
      const maintenance = {
        schemaVersion: "np.agent-maintenance-health.v1" as const,
        generatedAt: "2026-09-21T00:00:00.000Z",
        registration: "unknown" as const,
        workers: {
          state: "unavailable" as const,
          aliveCount: null,
          totalCount: null,
          newestHeartbeat: null,
        },
        queue: { state: "unavailable" as const, retainedFailures: null },
        receipts: {
          state: "never-recorded" as const,
          sampledSites: 0,
          hasMore: false,
          completedSweepSites: 0,
          latestBatch: null,
          latestSweepAt: null,
        },
      };
      if (state === "ok")
        collectMaintenance.mockRejectedValueOnce(new Error("must-not-leak-private-locator"));
      else collectMaintenance.mockResolvedValueOnce(maintenance);
      const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-agent-presentation-"));
      temporaryDirectories.push(cwd);
      const checks = await collectDoctorChecks({
        cwd,
        env: { DATABASE_URL: "postgresql://fixture.invalid/never-connect" },
        customRoutes: [],
        i18nConfig: { locales: ["en"], defaultLocale: "en" },
      });
      expect(collectAgentSummary).toHaveBeenCalledTimes(1);
      expect(collectMaintenance).toHaveBeenCalledExactlyOnceWith({
        client: { query: expect.any(Function) },
        runtime: false,
      });
      const check = checks.find((candidate) => candidate.id === "agents.contract");
      expect(check).toEqual({
        id: "agents.contract",
        state,
        label: "Agent persistence contracts",
        detail: `${formatAgentHealthDetail(summary)}\n\n${state === "ok" ? "Agent maintenance evidence: unavailable. This does not change persistence contract severity." : formatAgentMaintenanceDetail(maintenance)}`,
        hint: expect.any(String),
      });
      expect(check?.detail).not.toContain("must-not-leak-private-locator");
      expect(check?.detail).toContain(summary.generatedAt);
      expect(check?.detail).toContain("7201");
      expect(check?.detail).toContain("invocation");
      if (state === "error") expect(check?.detail).toContain("AGENT_STALE_INVOCATION");
      if (state === "warn") expect(check?.hint).toContain("cannot confirm");
    },
  );
});
