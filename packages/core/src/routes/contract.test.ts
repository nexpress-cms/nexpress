import { describe, expect, it } from "vitest";

import {
  NpCustomRouteContractError,
  isNpCustomRoutesResponse,
  npAnalyzeCustomRouteDefinitions,
  npAnalyzeCustomRoutesResponse,
  npCreateCustomRoutesResponse,
  npDefineCustomRoutes,
  npGetCustomRouteKind,
  npRequireCustomRouteSource,
  npRequireCustomRoutesResponse,
} from "./contract.js";

describe("custom route contract", () => {
  it("accepts canonical static and Next-style dynamic route definitions", () => {
    const definitions = npDefineCustomRoutes([
      {
        path: "/search",
        label: "Search",
        description: "Site search",
        icon: "search",
        group: "content",
      },
      { path: "/u/[handle]", label: "Member" },
      { path: "/docs/[...slug]", label: "Docs" },
      { path: "/archive/[[...segments]]", label: "Archive" },
    ]);

    expect(definitions).toHaveLength(4);
    expect(definitions.every((definition) => Object.isFrozen(definition))).toBe(true);
    expect(npGetCustomRouteKind("/")).toBe("static");
    expect(npGetCustomRouteKind("/u/[handle]")).toBe("dynamic");
  });

  it("rejects malformed paths, duplicate parameters, and duplicate paths", () => {
    const issues = npAnalyzeCustomRouteDefinitions([
      { path: "search", label: "Missing slash" },
      { path: "/posts/[id]/[id]", label: "Duplicate parameter" },
      { path: "/docs/[...slug]/edit", label: "Misplaced catch-all" },
      { path: "/search", label: "First" },
      { path: "/search", label: "Second" },
    ]);

    expect(issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["invalid-field", "duplicate-parameter", "duplicate-path"]),
    );
  });

  it("rejects unknown, undefined, untrimmed, and unsafe metadata", () => {
    expect(
      npAnalyzeCustomRouteDefinitions([
        {
          path: "/search",
          label: " Search ",
          description: undefined,
          icon: "Search",
          group: "content/news",
          extra: true,
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field", path: "customRoutes.0.extra" }),
        expect.objectContaining({ code: "invalid-field", path: "customRoutes.0.label" }),
        expect.objectContaining({ code: "invalid-field", path: "customRoutes.0.description" }),
        expect.objectContaining({ code: "invalid-field", path: "customRoutes.0.icon" }),
        expect.objectContaining({ code: "invalid-field", path: "customRoutes.0.group" }),
      ]),
    );
  });

  it("does not invoke accessors or custom array iterators", () => {
    let getterCalled = false;
    let iteratorCalled = false;
    let lengthRead = false;
    const route: Record<string, unknown> = { path: "/safe" };
    Object.defineProperty(route, "label", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "Unsafe";
      },
    });
    const routes = new Proxy<unknown[]>([route], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthRead = true;
          throw new Error("must not read array length through property access");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    Object.defineProperty(routes, Symbol.iterator, {
      enumerable: false,
      value() {
        iteratorCalled = true;
        throw new Error("must not run");
      },
    });

    const issues = npAnalyzeCustomRouteDefinitions(routes);

    expect(getterCalled).toBe(false);
    expect(iteratorCalled).toBe(false);
    expect(lengthRead).toBe(false);
    expect(issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["unknown-field", "shape"]),
    );
  });

  it("turns revoked proxies into contract issues instead of leaking exceptions", () => {
    const arrayProxy = Proxy.revocable<unknown[]>([], {});
    const recordProxy = Proxy.revocable<Record<string, unknown>>(
      { path: "/safe", label: "Safe" },
      {},
    );
    arrayProxy.revoke();
    recordProxy.revoke();

    expect(npAnalyzeCustomRouteDefinitions(arrayProxy.proxy)).toEqual([
      expect.objectContaining({ code: "shape", path: "customRoutes" }),
    ]);
    expect(npAnalyzeCustomRouteDefinitions([recordProxy.proxy])).toEqual([
      expect.objectContaining({ code: "shape", path: "customRoutes.0" }),
    ]);
  });

  it("rejects sparse arrays and catalogs beyond the route bound", () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = { path: "/search", label: "Search" };
    expect(npAnalyzeCustomRouteDefinitions(sparse)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "shape", path: "customRoutes.0" })]),
    );

    const oversized = Array.from({ length: 201 }, (_, index) => ({
      path: `/route-${index.toString()}`,
      label: `Route ${index.toString()}`,
    }));
    expect(npAnalyzeCustomRouteDefinitions(oversized)[0]?.code).toBe("max-items");
  });

  it("rejects numeric-looking properties that are not array entries", () => {
    const routes: unknown[] = [{ path: "/search", label: "Search" }];
    Object.defineProperty(routes, "4294967295", {
      enumerable: true,
      value: { path: "/hidden", label: "Hidden" },
    });

    expect(npAnalyzeCustomRouteDefinitions(routes)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]),
    );
  });

  it("clones and freezes definitions instead of retaining author-owned objects", () => {
    const source = { path: "/search", label: "Search" };
    const definitions = npDefineCustomRoutes([source]);
    source.label = "Changed";

    expect(definitions[0]?.label).toBe("Search");
    expect(Object.isFrozen(definitions)).toBe(true);
  });

  it("validates canonical route sources", () => {
    expect(npRequireCustomRouteSource("app:site-routes")).toBe("app:site-routes");
    for (const value of ["", "App:site", "app/site", "app:", " app:site"]) {
      expect(() => npRequireCustomRouteSource(value)).toThrow(NpCustomRouteContractError);
    }
  });

  it("requires exact response fields and path-derived kinds", () => {
    const response = npRequireCustomRoutesResponse({
      routes: [
        {
          path: "/u/[handle]",
          label: "Member",
          kind: "dynamic",
          source: "app:site",
        },
      ],
    });
    expect(response.routes[0]?.kind).toBe("dynamic");
    expect(isNpCustomRoutesResponse(response)).toBe(true);
    expect(
      npAnalyzeCustomRoutesResponse({
        routes: [{ path: "/u/[handle]", label: "Member", kind: "static", source: "app:site" }],
        extra: true,
      }).map((entry) => entry.code),
    ).toEqual(expect.arrayContaining(["unknown-field", "invalid-field"]));
  });

  it("creates an immutable exact API response", () => {
    const response = npCreateCustomRoutesResponse([
      { path: "/search", label: "Search", kind: "static", source: "app:site" },
    ]);
    expect(response).toEqual({
      routes: [{ path: "/search", label: "Search", kind: "static", source: "app:site" }],
    });
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.routes)).toBe(true);
  });
});
