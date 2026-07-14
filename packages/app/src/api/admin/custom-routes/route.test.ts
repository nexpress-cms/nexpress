import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CoreModule from "@nexpress/core";

import {
  npRegisterCustomRoutes,
  npUnregisterCustomRoutes,
  npRequireCustomRoutesResponse,
} from "@nexpress/core/routes";

const mocks = vi.hoisted(() => ({
  ensureFor: vi.fn(() => Promise.resolve()),
  requireAuth: vi.fn(() => Promise.resolve({ role: "admin" })),
  can: vi.fn(() => true),
}));

vi.mock("@nexpress/core", async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  can: mocks.can,
}));
vi.mock("../../../lib/auth-helpers", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("../../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));

const { GET } = await import("./route.js");

describe("admin custom routes API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    npRegisterCustomRoutes("app:test", [
      { path: "/search", label: "Search", group: "content" },
      { path: "/u/[handle]", label: "Member" },
    ]);
  });

  afterEach(() => {
    npUnregisterCustomRoutes("app:test");
  });

  it("returns the exact shared route wire contract", async () => {
    const response = await GET({} as never);
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(npRequireCustomRoutesResponse(payload).routes).toEqual([
      {
        path: "/search",
        label: "Search",
        group: "content",
        kind: "static",
        source: "app:test",
      },
      {
        path: "/u/[handle]",
        label: "Member",
        kind: "dynamic",
        source: "app:test",
      },
    ]);
    expect(mocks.ensureFor).toHaveBeenCalledWith("read");
  });

  it("keeps the inventory capability-gated", async () => {
    mocks.can.mockReturnValueOnce(false);

    const response = await GET({} as never);

    expect(response.status).toBe(403);
  });
});
