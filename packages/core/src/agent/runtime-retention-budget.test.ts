import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({
  execute: vi.fn<(query: SQL) => Promise<{ rows: Array<Record<string, unknown>> }>>(),
  transaction: vi.fn(),
}));
vi.mock("../db/runtime.js", () => ({ getDb: () => ({ transaction: mocks.transaction }) }));
import { npWithAgentRuntimeRetentionBudgetV1 } from "./runtime-retention-budget.js";

describe("Runtime retention transaction budget", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation((callback) => callback({ execute: mocks.execute }));
    mocks.execute.mockResolvedValue({ rows: [] });
  });
  afterEach(() => vi.restoreAllMocks());
  it("honors a stricter caller timeout and restores its exact setting", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ original: "100ms", milliseconds: "100" }] });
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(21);
    await expect(
      npWithAgentRuntimeRetentionBudgetV1(async (_db, beforeStatement) => {
        await beforeStatement();
        return "complete";
      }),
    ).resolves.toBe("complete");
    const dialect = new PgDialect();
    const params = mocks.execute.mock.calls
      .slice(1)
      .map(([query]) => dialect.sqlToQuery(query).params);
    expect(params).toEqual([["99ms"], ["80ms"], ["79ms"], ["100ms"]]);
  });
  it("rejects an exhausted overall budget before the transaction can commit", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ original: "0", milliseconds: "0" }] });
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(5001);
    await expect(
      npWithAgentRuntimeRetentionBudgetV1(() => Promise.resolve("must not commit")),
    ).rejects.toMatchObject({ code: "RUNTIME_MAINTENANCE_TIMEOUT" });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
