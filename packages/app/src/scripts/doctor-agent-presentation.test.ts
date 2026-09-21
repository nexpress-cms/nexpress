import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { npRequireAgentHealthSummaryV1 } from "@nexpress/core/agent-contract";

const { collectAgentSummary, collectMaintenance, collectBudget, collectWorkers, clients } =
  vi.hoisted(() => ({
    collectAgentSummary: vi.fn(),
    collectMaintenance: vi.fn(),
    collectBudget: vi.fn(),
    collectWorkers: vi.fn(),
    clients: [] as object[],
  }));
vi.mock("@nexpress/core/agents", () => ({
  npCollectAgentHealthSummaryV1: collectAgentSummary,
  npCollectAgentMaintenanceHealthV1: collectMaintenance,
  npCollectAgentBudgetHealthV1: collectBudget,
  npCollectAgentWorkerHealthV1: collectWorkers,
}));
vi.mock("pg", () => ({
  default: {
    Client: class {
      constructor() {
        clients.push(this);
      }
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
import { formatAgentWorkerDetail } from "../lib/agent-worker-presentation.js";
import { formatAgentBudgetDetail } from "../lib/agent-budget-presentation.js";
import { collectDoctorChecks } from "./doctor-core.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  collectAgentSummary.mockReset();
  collectMaintenance.mockReset();
  collectBudget.mockReset();
  collectWorkers.mockReset();
  clients.length = 0;
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
      const budget = {
        schemaVersion: "np.agent-budget-health.v1" as const,
        generatedAt: "2026-09-21T00:00:00.000Z",
        state: "observed" as const,
        sampledSites: 3,
        hasMore: false,
        measuredSites: 1,
        unresolvedUsageSites: 1,
        unavailableSites: 1,
      };
      if (state !== "error")
        collectBudget.mockRejectedValueOnce(new Error("must-not-leak-budget-failure"));
      else collectBudget.mockResolvedValueOnce(budget);
      const workers = {
        schemaVersion: "np.agent-worker-health.v1" as const,
        generatedAt: "2026-09-21T00:00:00.000Z",
        state: "observed" as const,
        sampledWorkers: 3,
        hasMore: false,
        subscribedWorkers: 1,
        pausedWorkers: 1,
        inactiveWorkers: 0,
        staleWorkers: 0,
        stoppedWorkers: 0,
        unknownWorkers: 1,
      };
      if (state === "ok")
        collectWorkers.mockRejectedValueOnce(new Error("must-not-leak-worker-failure"));
      else collectWorkers.mockResolvedValueOnce(workers);
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
      expect(collectBudget).toHaveBeenCalledTimes(1);
      const budgetDb = collectBudget.mock.calls[0]?.[0]?.db;
      expect(clients).toContain(budgetDb.$client);
      expect(collectWorkers).toHaveBeenCalledExactlyOnceWith({ db: budgetDb });
      expect(typeof budgetDb.transaction).toBe("function");
      // The exact client passed to the budget collector also serves existing
      // contract queries, and remains the actual client rather than a shim.
      const maintenanceClient = collectMaintenance.mock.calls[0]?.[0]?.client;
      const query = vi.spyOn(budgetDb.$client, "query");
      await maintenanceClient.query("select 1");
      expect(query).toHaveBeenCalledWith("select 1", undefined);
      const check = checks.find((candidate) => candidate.id === "agents.contract");
      expect(check).toEqual({
        id: "agents.contract",
        state,
        label: "Agent persistence contracts",
        detail: `${formatAgentHealthDetail(summary)}\n\n${state === "ok" ? "Agent maintenance evidence: unavailable. This does not change persistence contract severity." : formatAgentMaintenanceDetail(maintenance)}\n\n${state !== "error" ? "Agent budget measurement evidence: unavailable. This does not change persistence contract severity." : formatAgentBudgetDetail(budget)}\n\n${state === "ok" ? "Agent worker subscription evidence: unavailable. This does not change persistence contract severity." : formatAgentWorkerDetail(workers)}`,
        hint: expect.any(String),
      });
      expect(check?.detail).not.toContain("must-not-leak-private-locator");
      expect(check?.detail).not.toContain("must-not-leak-budget-failure");
      expect(check?.detail).not.toContain("must-not-leak-worker-failure");
      expect(check?.detail).toContain(summary.generatedAt);
      expect(check?.detail).toContain("7201");
      expect(check?.detail).toContain("invocation");
      if (state === "error") expect(check?.detail).toContain("AGENT_STALE_INVOCATION");
      if (state === "warn") expect(check?.hint).toContain("cannot confirm");
    },
  );
});
