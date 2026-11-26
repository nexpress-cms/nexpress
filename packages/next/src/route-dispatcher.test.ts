import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NpTheme, NpThemeRoute } from "@nexpress/theme";

// Mock the @nexpress/core plugin host so the dispatcher tests
// don't have to spin up a DB-backed enabled-gate. We replace
// `getPluginPageRoutes` and `isPluginEnabled` with module-level
// `let`s the tests drive directly.
let mockPageRoutes: Array<{
  pluginId: string;
  route: {
    pattern: string;
    component: unknown;
    metadata?: unknown;
    surface: "site" | "member";
    locale: "auto" | "none";
  };
}> = [];
let mockEnabledMap: Map<string, boolean> = new Map();
vi.mock("@nexpress/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@nexpress/core");
  return {
    ...actual,
    getPluginPageRoutes: () => mockPageRoutes,
    isPluginEnabled: (id: string) => Promise.resolve(mockEnabledMap.get(id) ?? true),
  };
});

import {
  __resetCollisionWarnings,
  __resetPluginCollisionWarnings,
  buildPluginRouteRenderProps,
  collectThemeRoutes,
  dispatchPluginRoute,
  dispatchThemeRoute,
} from "./route-dispatcher.js";

const StubComponent = (() => null) as unknown as NpThemeRoute["component"];

const themeWith = (impl: NpTheme["impl"]): NpTheme => ({
  manifest: { id: "test", name: "Test", version: "0.1.0" },
  impl,
});

describe("dispatchThemeRoute", () => {
  it("returns null when theme is null", () => {
    expect(dispatchThemeRoute(null, "/anything")).toBeNull();
  });

  it("returns null when no routes match", () => {
    const theme = themeWith({
      routes: [{ pattern: "/lookbook", component: StubComponent }],
    });
    expect(dispatchThemeRoute(theme, "/about")).toBeNull();
  });

  it("matches a literal route", () => {
    const theme = themeWith({
      routes: [{ pattern: "/lookbook", component: StubComponent }],
    });
    const match = dispatchThemeRoute(theme, "/lookbook");
    expect(match).not.toBeNull();
    expect(match?.params).toEqual({});
  });

  it("captures a single :param", () => {
    const theme = themeWith({
      routes: [{ pattern: "/category/:slug", component: StubComponent }],
    });
    const match = dispatchThemeRoute(theme, "/category/politics");
    expect(match?.params).toEqual({ slug: "politics" });
  });

  it("captures multiple :params", () => {
    const theme = themeWith({
      routes: [
        {
          pattern: "/:year(\\d{4})/:month(\\d{2})",
          component: StubComponent,
        },
      ],
    });
    const match = dispatchThemeRoute(theme, "/2026/05");
    expect(match?.params).toEqual({ year: "2026", month: "05" });
  });

  it("rejects when regex constraint fails", () => {
    const theme = themeWith({
      routes: [
        {
          pattern: "/:year(\\d{4})",
          component: StubComponent,
        },
      ],
    });
    expect(dispatchThemeRoute(theme, "/notayear")).toBeNull();
    expect(dispatchThemeRoute(theme, "/2026")).not.toBeNull();
  });

  it("first match wins (declaration order)", () => {
    const a = StubComponent;
    const b = StubComponent;
    const theme = themeWith({
      routes: [
        { pattern: "/:slug", component: a },
        { pattern: "/lookbook", component: b },
      ],
    });
    const match = dispatchThemeRoute(theme, "/lookbook");
    // The first pattern (`/:slug`) is broader and wins; explicit
    // pattern needs to be declared first if the theme wants it
    // to take precedence. This is documented behavior.
    expect(match?.route.component).toBe(a);
    expect(match?.params).toEqual({ slug: "lookbook" });
  });

  it("rejects when segment count mismatches", () => {
    const theme = themeWith({
      routes: [{ pattern: "/category/:slug", component: StubComponent }],
    });
    expect(dispatchThemeRoute(theme, "/category")).toBeNull();
    expect(dispatchThemeRoute(theme, "/category/foo/bar")).toBeNull();
  });

  it("normalizes path without leading slash", () => {
    const theme = themeWith({
      routes: [{ pattern: "/lookbook", component: StubComponent }],
    });
    expect(dispatchThemeRoute(theme, "lookbook")).not.toBeNull();
  });
});

describe("collectThemeRoutes — archives expansion", () => {
  it("expands byCategory to /category/:slug", () => {
    const theme = themeWith({
      archives: {
        posts: { byCategory: { component: StubComponent } },
      },
    });
    const routes = collectThemeRoutes(theme);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.pattern).toBe("/category/:slug");
  });

  it("expands byDate granularities to expected patterns", () => {
    const yr = themeWith({
      archives: {
        posts: {
          byDate: { component: StubComponent, granularity: "year" },
        },
      },
    });
    expect(collectThemeRoutes(yr)[0]?.pattern).toBe("/:year(\\d{4})");

    const mo = themeWith({
      archives: {
        posts: {
          byDate: { component: StubComponent, granularity: "month" },
        },
      },
    });
    expect(collectThemeRoutes(mo)[0]?.pattern).toBe("/:year(\\d{4})/:month(\\d{2})");

    const day = themeWith({
      archives: {
        posts: {
          byDate: { component: StubComponent, granularity: "day" },
        },
      },
    });
    expect(collectThemeRoutes(day)[0]?.pattern).toBe("/:year(\\d{4})/:month(\\d{2})/:day(\\d{2})");
  });

  it("respects per-entry pattern override", () => {
    const theme = themeWith({
      archives: {
        posts: {
          byTag: { component: StubComponent, pattern: "/topics/:tag" },
        },
      },
    });
    expect(collectThemeRoutes(theme)[0]?.pattern).toBe("/topics/:tag");
  });

  it("explicit routes come before expanded archives", () => {
    const explicit = StubComponent;
    const archive = StubComponent;
    const theme = themeWith({
      routes: [{ pattern: "/explicit", component: explicit }],
      archives: {
        posts: { byCategory: { component: archive } },
      },
    });
    const routes = collectThemeRoutes(theme);
    expect(routes).toHaveLength(2);
    expect(routes[0]?.component).toBe(explicit);
    expect(routes[1]?.component).toBe(archive);
  });

  it("empty when neither routes nor archives declared", () => {
    expect(collectThemeRoutes(themeWith({}))).toEqual([]);
  });
});

describe("collectThemeRoutes — pattern collision warning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetCollisionWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("warns when two archive entries on different collections produce the same default pattern", () => {
    const theme = themeWith({
      archives: {
        posts: { byCategory: { component: StubComponent } },
        products: { byCategory: { component: StubComponent } },
      },
    });
    collectThemeRoutes(theme);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("/category/:slug");
  });

  it("does not warn when patterns differ via per-entry override", () => {
    const theme = themeWith({
      archives: {
        posts: { byCategory: { component: StubComponent } },
        products: {
          byCategory: {
            component: StubComponent,
            pattern: "/products/category/:slug",
          },
        },
      },
    });
    collectThemeRoutes(theme);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once per process per pattern even across multiple collectThemeRoutes calls", () => {
    const theme = themeWith({
      archives: {
        posts: { byCategory: { component: StubComponent } },
        products: { byCategory: { component: StubComponent } },
      },
    });
    collectThemeRoutes(theme);
    collectThemeRoutes(theme);
    collectThemeRoutes(theme);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Plugin route dispatch (PRT.2, #623)
// ─────────────────────────────────────────────────────────────

const PluginStub = (() => null) as unknown;

function pluginEntry(
  pluginId: string,
  pattern: string,
  overrides: Partial<{
    surface: "site" | "member";
    locale: "auto" | "none";
    component: unknown;
    metadata: unknown;
  }> = {},
) {
  return {
    pluginId,
    route: {
      pattern,
      component: overrides.component ?? PluginStub,
      metadata: overrides.metadata,
      surface: overrides.surface ?? "site",
      locale: overrides.locale ?? "auto",
    },
  };
}

describe("dispatchPluginRoute", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const context = {
    localeAwarePath: "/discussions",
    rawPath: "/discussions",
    themeRoutes: [],
  };

  beforeEach(() => {
    mockPageRoutes = [];
    mockEnabledMap = new Map();
    __resetPluginCollisionWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("matches literal, parameterized, unprefixed and root paths", async () => {
    for (const { pattern, path, params } of [
      { pattern: "/discussions", path: "/discussions", params: {} },
      {
        pattern: "/discussions/:slug",
        path: "/discussions/my-thread",
        params: { slug: "my-thread" },
      },
      { pattern: "/discussions", path: "discussions", params: {} },
      { pattern: "/", path: "/", params: {} },
    ]) {
      mockPageRoutes = [pluginEntry("forum", pattern)];
      expect(
        await dispatchPluginRoute({ ...context, localeAwarePath: path, rawPath: path }),
        path,
      ).toMatchObject({ pluginId: "forum", route: { pattern }, params });
    }
  });

  it("returns null for absent routes, unmatched paths and invalid components", async () => {
    expect(await dispatchPluginRoute(context), "no registered routes").toBeNull();
    mockPageRoutes = [pluginEntry("forum", "/elsewhere")];
    expect(await dispatchPluginRoute(context), "unmatched pattern").toBeNull();
    mockPageRoutes = [pluginEntry("bad", "/discussions", { component: "not-a-component" })];
    expect(await dispatchPluginRoute(context), "non-callable component").toBeNull();
  });

  it("uses registration order and reevaluates the enabled gate on every request", async () => {
    mockPageRoutes = [
      pluginEntry("forum-a", "/discussions"),
      pluginEntry("forum-b", "/discussions"),
    ];
    expect((await dispatchPluginRoute(context))?.pluginId).toBe("forum-a");
    mockEnabledMap.set("forum-a", false);
    expect((await dispatchPluginRoute(context))?.pluginId).toBe("forum-b");
    mockEnabledMap.set("forum-b", false);
    expect(await dispatchPluginRoute(context)).toBeNull();
  });

  it("matches locale=auto against the locale-stripped path", async () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    expect((await dispatchPluginRoute({ ...context, rawPath: "/ko/discussions" }))?.pluginId).toBe(
      "forum",
    );
  });

  it("matches locale=none only against the raw path and preserves route metadata", async () => {
    const metadata = () => ({ title: "New discussion" });
    mockPageRoutes = [
      pluginEntry("forum", "/discussions", { surface: "member", locale: "none", metadata }),
    ];
    expect(await dispatchPluginRoute({ ...context, rawPath: "/ko/discussions" })).toBeNull();
    expect(await dispatchPluginRoute(context)).toMatchObject({
      pluginId: "forum",
      route: { surface: "member", locale: "none", component: PluginStub, metadata },
    });
  });

  it("warns once when the active theme shadows a plugin pattern", async () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    const withTheme = {
      ...context,
      themeRoutes: [{ pattern: "/discussions", component: StubComponent }],
    };
    await dispatchPluginRoute(withTheme);
    await dispatchPluginRoute(withTheme);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("shadowed by the active theme");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("/discussions");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("forum");
  });

  it("warns once when plugins claim the same pattern", async () => {
    mockPageRoutes = [
      pluginEntry("forum-a", "/discussions"),
      pluginEntry("forum-b", "/discussions"),
    ];
    await dispatchPluginRoute(context);
    await dispatchPluginRoute(context);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("forum-a");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("forum-b");
  });

  it("does not warn when plugin and theme patterns differ", async () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    await dispatchPluginRoute({
      ...context,
      themeRoutes: [{ pattern: "/lookbook", component: StubComponent }],
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("buildPluginRouteRenderProps", () => {
  it("forwards params, searchParams, and blockCtx onto the props", () => {
    const blockCtx = {
      siteId: "site-1",
    } as unknown as Parameters<typeof buildPluginRouteRenderProps>[0]["blockCtx"];
    const props = buildPluginRouteRenderProps({
      match: {
        pluginId: "forum",
        route: {
          pattern: "/discussions/:slug",
          component: PluginStub as never,
          surface: "site",
          locale: "auto",
        },
        params: { slug: "x" },
      },
      searchParams: { tab: "open" },
      blockCtx,
    });
    expect(props.params).toEqual({ slug: "x" });
    expect(props.searchParams).toEqual({ tab: "open" });
    expect(props.blockCtx).toBe(blockCtx);
  });
});
