import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NpTheme, NpThemeRoute } from "@nexpress/theme";

import {
  __resetCollisionWarnings,
  collectThemeRoutes,
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
