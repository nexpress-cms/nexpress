import { afterEach, describe, expect, it } from "vitest";

import { NpCustomRouteContractError } from "./contract.js";
import {
  npGetCustomRoutes,
  npRegisterCustomRoutes,
  npUnregisterCustomRoutes,
  resetCustomRoutesForTests,
} from "./registry.js";

afterEach(() => {
  resetCustomRoutesForTests();
});

describe("custom route registry", () => {
  it("derives wire metadata and returns deterministic immutable snapshots", () => {
    npRegisterCustomRoutes("app:site", [
      { path: "/search", label: "Search" },
      { path: "/blog/[slug]", label: "Post" },
    ]);

    const routes = npGetCustomRoutes();
    expect(routes).toEqual([
      { path: "/blog/[slug]", label: "Post", kind: "dynamic", source: "app:site" },
      { path: "/search", label: "Search", kind: "static", source: "app:site" },
    ]);
    expect(Object.isFrozen(routes)).toBe(true);
    expect(routes.every((route) => Object.isFrozen(route))).toBe(true);
  });

  it("atomically replaces one source so removed HMR entries do not survive", () => {
    npRegisterCustomRoutes("app:site", [
      { path: "/old", label: "Old" },
      { path: "/keep", label: "Keep" },
    ]);
    npRegisterCustomRoutes("app:site", [{ path: "/keep", label: "Keep v2" }]);

    expect(npGetCustomRoutes()).toEqual([
      { path: "/keep", label: "Keep v2", kind: "static", source: "app:site" },
    ]);
  });

  it("rejects cross-source path collisions without mutating either catalog", () => {
    npRegisterCustomRoutes("app:framework", [{ path: "/search", label: "Search" }]);
    npRegisterCustomRoutes("app:site", [{ path: "/about", label: "About" }]);

    expect(() =>
      npRegisterCustomRoutes("app:site", [{ path: "/search", label: "Override" }]),
    ).toThrow(NpCustomRouteContractError);
    expect(npGetCustomRoutes()).toEqual([
      { path: "/about", label: "About", kind: "static", source: "app:site" },
      { path: "/search", label: "Search", kind: "static", source: "app:framework" },
    ]);
  });

  it("unregisters one source without disturbing other owners", () => {
    npRegisterCustomRoutes("app:framework", [{ path: "/search", label: "Search" }]);
    npRegisterCustomRoutes("app:site", [{ path: "/about", label: "About" }]);

    npUnregisterCustomRoutes("app:site");
    npUnregisterCustomRoutes("app:site");

    expect(npGetCustomRoutes()).toEqual([
      { path: "/search", label: "Search", kind: "static", source: "app:framework" },
    ]);
  });

  it("fails before mutation on malformed sources or definitions", () => {
    expect(() => npRegisterCustomRoutes("App Site", [])).toThrow(/custom route source/u);
    expect(() => npRegisterCustomRoutes("app:site", [{ path: "search", label: "Search" }])).toThrow(
      /custom route paths/u,
    );
    expect(npGetCustomRoutes()).toEqual([]);
  });
});
