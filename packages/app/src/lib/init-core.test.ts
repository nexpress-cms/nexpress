import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as CoreRoutesModule from "@nexpress/core/routes";

const mocks = vi.hoisted(() => ({
  bootstrapEnsureFor: vi.fn(() => Promise.resolve()),
  npRegisterCustomRoutes: vi.fn(),
  registerWordPressImportJobs: vi.fn(),
}));

vi.mock("@nexpress/core/routes", async (importOriginal) => ({
  ...(await importOriginal<typeof CoreRoutesModule>()),
  npRegisterCustomRoutes: mocks.npRegisterCustomRoutes,
}));

vi.mock("@/lib/bootstrap", () => ({
  ensureFor: mocks.bootstrapEnsureFor,
  getDb: vi.fn(),
  nexpressConfig: { collections: [], site: { name: "Test" } },
}));
vi.mock("@/lib/custom-routes", () => ({
  npCustomRoutes: [{ path: "/search", label: "Search" }],
}));
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
    expect(mocks.npRegisterCustomRoutes).not.toHaveBeenCalled();
    expect(mocks.registerWordPressImportJobs).not.toHaveBeenCalled();
  });

  it("registers the consumer catalog after the read runtime is ready", async () => {
    await ensureFor("read");

    expect(mocks.bootstrapEnsureFor).toHaveBeenCalledWith("read");
    expect(mocks.npRegisterCustomRoutes).toHaveBeenCalledWith("app:site", [
      { path: "/search", label: "Search" },
    ]);
    expect(mocks.registerWordPressImportJobs).toHaveBeenCalledOnce();
  });
});
