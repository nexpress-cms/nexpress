import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "../db/runtime.js";
import { npCollectAgentBudgetHealthV1 } from "./budget-health.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAgentBudgetSnapshotCountersIncludedKeysV1 } from "../agent-contract/canonical-budget-snapshot.js";
type Db = ReturnType<typeof getDb>;
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  known: vi.fn(),
  measure: vi.fn(),
  control: vi.fn(),
}));
vi.mock("../db/runtime.js", () => ({ getDb: mocks.getDb }));
vi.mock("./runtime-budget.js", () => ({
  npRequireAgentRuntimeUsageKnownV1: mocks.known,
  npMeasureAgentRuntimeBudgetV1: mocks.measure,
}));
vi.mock("./runtime-controls.js", () => ({ npWithAgentRuntimeControlTransactionV1: mocks.control }));
const now = new Date("2026-09-21T00:00:00.000Z");
const rows = vi.fn();
const execute = vi.fn();
const transaction = vi.fn();
const tx = {
  execute,
  select: () => ({ from: () => ({ orderBy: () => ({ limit: rows }) }) }),
} as unknown as Db;
const db = { transaction } as unknown as Db;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockReturnValue(db);
  transaction.mockImplementation((operation: (current: Db) => Promise<unknown>) => operation(tx));
  rows.mockResolvedValue([{ id: "default" }]);
  execute.mockResolvedValue({ rows: [{ original: "0", milliseconds: 0 }] });
  mocks.control.mockImplementation(
    (_id: string, operation: (context: { db: Db }) => Promise<void>, current: Db) =>
      operation({ db: current }),
  );
  mocks.known.mockResolvedValue(undefined);
  mocks.measure.mockResolvedValue(
    Object.fromEntries(npAgentBudgetSnapshotCountersIncludedKeysV1.map((key) => [key, 0])),
  );
});
afterEach(() => vi.restoreAllMocks());
describe("budget measurement collection", () => {
  it("requires actual measurement under the supplied transaction and excludes usage or site identity", async () => {
    const result = await npCollectAgentBudgetHealthV1({ db, now });
    expect(result).toMatchObject({
      state: "observed",
      sampledSites: 1,
      measuredSites: 1,
      unresolvedUsageSites: 0,
      unavailableSites: 0,
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.control).toHaveBeenCalledWith("default", expect.any(Function), tx);
    expect(mocks.known).toHaveBeenCalledWith({ db: tx, siteId: "default" });
    expect(mocks.measure).toHaveBeenCalledWith({ db: tx, siteId: "default", now });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toMatch(/default|siteId|costMicros|token/);
  });
  it("separates exact unresolved usage from query failure and invalid measurement", async () => {
    mocks.known.mockRejectedValueOnce(
      new NpAgentGatewayError("RUNTIME_USAGE_UNKNOWN", 409, "private"),
    );
    expect(await npCollectAgentBudgetHealthV1({ now })).toMatchObject({
      unresolvedUsageSites: 1,
      measuredSites: 0,
    });
    expect(mocks.measure).not.toHaveBeenCalled();
    mocks.measure.mockResolvedValueOnce({});
    expect(await npCollectAgentBudgetHealthV1({ now })).toMatchObject({
      unavailableSites: 1,
      measuredSites: 0,
    });
    rows.mockRejectedValueOnce(new Error("private locator"));
    expect(await npCollectAgentBudgetHealthV1({ now })).toMatchObject({
      state: "unavailable",
      sampledSites: null,
      measuredSites: null,
      hasMore: null,
    });
  });
  it("bounds the sample and leaves unattempted sites unavailable after the scheduling deadline", async () => {
    rows.mockResolvedValue(Array.from({ length: 26 }, (_, i) => ({ id: `site-${i}` })));
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    mocks.measure.mockImplementation(() => {
      elapsed = 6_000;
      return Promise.resolve(
        Object.fromEntries(npAgentBudgetSnapshotCountersIncludedKeysV1.map((key) => [key, 0])),
      );
    });
    expect(await npCollectAgentBudgetHealthV1({ now })).toMatchObject({
      state: "observed",
      sampledSites: 25,
      hasMore: true,
      measuredSites: 1,
      unavailableSites: 24,
    });
    expect(rows).toHaveBeenCalledWith(26);
    expect(mocks.control).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
