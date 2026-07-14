import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapEnsureFor: vi.fn(() => Promise.resolve()),
  registerCustomRoutes: vi.fn(),
  registerWordPressImportJobs: vi.fn(),
}));

vi.mock("@/lib/bootstrap", () => ({
  ensureFor: mocks.bootstrapEnsureFor,
  getDb: vi.fn(),
  nexpressConfig: { collections: [], site: { name: "Test" } },
}));
vi.mock("./custom-routes", () => ({ registerCustomRoutes: mocks.registerCustomRoutes }));
vi.mock("./wp-import-admin", () => ({
  registerWordPressImportJobs: mocks.registerWordPressImportJobs,
}));

const { ensureFor } = await import("./init-core.js");

describe("app bootstrap intent boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalid intent before opening the read runtime", async () => {
    await expect(ensureFor("unknown" as never)).rejects.toThrow("Invalid bootstrap intent");

    expect(mocks.bootstrapEnsureFor).not.toHaveBeenCalled();
    expect(mocks.registerCustomRoutes).not.toHaveBeenCalled();
    expect(mocks.registerWordPressImportJobs).not.toHaveBeenCalled();
  });
});
