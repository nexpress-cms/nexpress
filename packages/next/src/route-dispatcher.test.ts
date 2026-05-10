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
  dispatchPluginRouteSync,
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
    expect(collectThemeRoutes(mo)[0]?.pattern).toBe(
      "/:year(\\d{4})/:month(\\d{2})",
    );

    const day = themeWith({
      archives: {
        posts: {
          byDate: { component: StubComponent, granularity: "day" },
        },
      },
    });
    expect(collectThemeRoutes(day)[0]?.pattern).toBe(
      "/:year(\\d{4})/:month(\\d{2})/:day(\\d{2})",
    );
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

describe("dispatchPluginRouteSync", () => {
  beforeEach(() => {
    mockPageRoutes = [];
    mockEnabledMap = new Map();
    __resetPluginCollisionWarnings();
  });

  it("returns null when no plugin routes registered", () => {
    expect(
      dispatchPluginRouteSync({ localeAwarePath: "/anything", themeRoutes: [] }),
    ).toBeNull();
  });

  it("matches a literal plugin route", () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    const match = dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    expect(match?.pluginId).toBe("forum");
    expect(match?.route.pattern).toBe("/discussions");
    expect(match?.params).toEqual({});
  });

  it("captures :param tokens", () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions/:slug")];
    const match = dispatchPluginRouteSync({
      localeAwarePath: "/discussions/my-thread",
      themeRoutes: [],
    });
    expect(match?.params).toEqual({ slug: "my-thread" });
  });

  it("normalizes path without leading slash", () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    expect(
      dispatchPluginRouteSync({
        localeAwarePath: "discussions",
        themeRoutes: [],
      }),
    ).not.toBeNull();
  });

  it("first registered plugin wins on duplicate pattern", () => {
    mockPageRoutes = [
      pluginEntry("forum-a", "/discussions"),
      pluginEntry("forum-b", "/discussions"),
    ];
    const match = dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    expect(match?.pluginId).toBe("forum-a");
  });

  it("skips disabled plugins via the enabled callback", () => {
    mockPageRoutes = [
      pluginEntry("forum-a", "/discussions"),
      pluginEntry("forum-b", "/discussions"),
    ];
    const match = dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [],
      enabled: (id) => id !== "forum-a",
    });
    expect(match?.pluginId).toBe("forum-b");
  });

  it("returns null when path matches no registered pattern", () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    expect(
      dispatchPluginRouteSync({
        localeAwarePath: "/elsewhere",
        themeRoutes: [],
      }),
    ).toBeNull();
  });

  it("rejects entries whose component is a primitive (defense-in-depth)", () => {
    mockPageRoutes = [
      pluginEntry("bad", "/x", { component: "not-a-component" as unknown }),
    ];
    expect(
      dispatchPluginRouteSync({ localeAwarePath: "/x", themeRoutes: [] }),
    ).toBeNull();
  });

  it("preserves surface and locale fields on the match", () => {
    mockPageRoutes = [
      pluginEntry("forum", "/discussions/new", {
        surface: "member",
        locale: "none",
      }),
    ];
    const match = dispatchPluginRouteSync({
      localeAwarePath: "/discussions/new",
      themeRoutes: [],
    });
    expect(match?.route.surface).toBe("member");
    expect(match?.route.locale).toBe("none");
  });

  it("matches a plugin route registered at site root '/'", () => {
    mockPageRoutes = [pluginEntry("landing", "/")];
    const match = dispatchPluginRouteSync({
      localeAwarePath: "/",
      themeRoutes: [],
    });
    expect(match?.pluginId).toBe("landing");
    expect(match?.params).toEqual({});
  });
});

describe("dispatchPluginRoute (async, with enabled-gate)", () => {
  beforeEach(() => {
    mockPageRoutes = [];
    mockEnabledMap = new Map();
    __resetPluginCollisionWarnings();
  });

  it("matches when plugin is enabled (default)", async () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    const match = await dispatchPluginRoute({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    expect(match?.pluginId).toBe("forum");
  });

  it("skips disabled plugins per the gate", async () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    mockEnabledMap.set("forum", false);
    const match = await dispatchPluginRoute({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    expect(match).toBeNull();
  });

  it("falls through disabled plugin to enabled one on same pattern", async () => {
    mockPageRoutes = [
      pluginEntry("forum-a", "/discussions"),
      pluginEntry("forum-b", "/discussions"),
    ];
    mockEnabledMap.set("forum-a", false);
    const match = await dispatchPluginRoute({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    expect(match?.pluginId).toBe("forum-b");
  });
});

describe("dispatchPluginRoute — collision warnings", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPageRoutes = [];
    mockEnabledMap = new Map();
    __resetPluginCollisionWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("warns when a theme route shadows a plugin pattern", () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    const themeRoute: NpThemeRoute = {
      pattern: "/discussions",
      component: StubComponent,
    };
    dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [themeRoute],
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("shadowed by the active theme");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("/discussions");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("forum");
  });

  it("warns when two plugins claim the same pattern", () => {
    mockPageRoutes = [
      pluginEntry("forum-a", "/discussions"),
      pluginEntry("forum-b", "/discussions"),
    ];
    dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("forum-a");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("forum-b");
  });

  it("warns once per pattern across multiple dispatch calls", () => {
    mockPageRoutes = [
      pluginEntry("forum-a", "/discussions"),
      pluginEntry("forum-b", "/discussions"),
    ];
    dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [],
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does not warn when plugin and theme patterns differ", () => {
    mockPageRoutes = [pluginEntry("forum", "/discussions")];
    const themeRoute: NpThemeRoute = {
      pattern: "/lookbook",
      component: StubComponent,
    };
    dispatchPluginRouteSync({
      localeAwarePath: "/discussions",
      themeRoutes: [themeRoute],
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
