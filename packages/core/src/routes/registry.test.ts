import { afterEach, describe, expect, it } from "vitest";

import {
  clearCustomRoutes,
  getCustomRoutes,
  registerCustomRoute,
} from "./registry.js";

afterEach(() => {
  clearCustomRoutes();
});

describe("custom routes registry", () => {
  it("registers and lists routes", () => {
    registerCustomRoute({ path: "/blog", label: "Blog" });
    registerCustomRoute({
      path: "/search",
      label: "Search",
      description: "Site search",
      icon: "search",
      group: "content",
    });
    const routes = getCustomRoutes();
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path).sort()).toEqual(["/blog", "/search"]);
  });

  it("overwrites silently on re-registration of the same path (HMR-safe)", () => {
    registerCustomRoute({ path: "/blog", label: "Blog" });
    registerCustomRoute({ path: "/blog", label: "Blog v2" });
    const routes = getCustomRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]?.label).toBe("Blog v2");
  });

  it("rejects paths that don't start with /", () => {
    expect(() => registerCustomRoute({ path: "blog", label: "Blog" })).toThrow(/start with/);
  });

  it("rejects empty labels", () => {
    expect(() => registerCustomRoute({ path: "/blog", label: "" })).toThrow(/non-empty/);
    expect(() => registerCustomRoute({ path: "/blog", label: "   " })).toThrow(/non-empty/);
  });

  it("returns a snapshot — mutating the result doesn't affect the registry", () => {
    registerCustomRoute({ path: "/blog", label: "Blog" });
    const snap = getCustomRoutes();
    snap.length = 0;
    expect(getCustomRoutes()).toHaveLength(1);
  });
});
