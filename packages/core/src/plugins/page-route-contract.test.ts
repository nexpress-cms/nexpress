import { describe, expect, expectTypeOf, it } from "vitest";

import {
  npCompilePluginPageRoutePattern,
  npIsPluginPageRouteLocale,
  npIsPluginPageRouteSurface,
  npMatchPluginPageRoutePattern,
  npPluginPageRouteLocales,
  npPluginPageRouteSurfaces,
  npValidatePluginPageRouteDefinition,
  npValidatePluginPageRoutePattern,
  type NpPluginPageRouteLocale,
  type NpPluginPageRouteSurface,
} from "./page-route-contract.js";

describe("plugin page route contract", () => {
  it("keeps runtime inventories aligned with their types", () => {
    expect(npPluginPageRouteSurfaces).toEqual(["site", "member"]);
    expect(npPluginPageRouteLocales).toEqual(["auto", "none"]);
    expectTypeOf<
      (typeof npPluginPageRouteSurfaces)[number]
    >().toEqualTypeOf<NpPluginPageRouteSurface>();
    expectTypeOf<
      (typeof npPluginPageRouteLocales)[number]
    >().toEqualTypeOf<NpPluginPageRouteLocale>();
    expect(npIsPluginPageRouteSurface("member")).toBe(true);
    expect(npIsPluginPageRouteSurface("admin")).toBe(false);
    expect(npIsPluginPageRouteLocale("none")).toBe(true);
    expect(npIsPluginPageRouteLocale("inherit")).toBe(false);
  });

  it.each([
    "/",
    "/discussions",
    "/discussions/:slug",
    "/:year(\\d{4})/:month(\\d{2})",
    "/문서/:slug",
  ])("accepts canonical pattern %s", (pattern) => {
    expect(npValidatePluginPageRoutePattern(pattern)).toEqual({ ok: true });
  });

  it.each([
    ["", /non-empty/],
    ["discussions", /start with/],
    ["/discussions/", /trailing/],
    ["/discussions//new", /empty/],
    ["/../new", /dot segments/],
    ["/discussions/*", /literal segments/],
    ["/discussions/:", /identifier/],
    ["/:slug/:slug", /must not repeat/],
    ["/:year([)", /invalid regular expression/],
  ])("rejects malformed pattern %s", (pattern, message) => {
    const result = npValidatePluginPageRoutePattern(pattern);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("validates an exact complete definition", () => {
    expect(
      npValidatePluginPageRouteDefinition({
        pattern: "/discussions/:slug",
        component: () => null,
        metadata: () => ({ title: "Discussion" }),
        surface: "member",
        locale: "none",
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    [{ pattern: "/x", component: "./page.js" }, /component/],
    [{ pattern: "/x", component: (): null => null, metadata: {} }, /metadata/],
    [{ pattern: "/x", component: (): null => null, surface: "admin" }, /surface/],
    [{ pattern: "/x", component: (): null => null, locale: "inherit" }, /locale/],
    [{ pattern: "/x", component: (): null => null, auth: true }, /contain only/],
  ])("rejects malformed definition %#", (definition, message) => {
    const result = npValidatePluginPageRouteDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("compiles once and matches literal, parameter, regex, and root routes", () => {
    const matcher = npCompilePluginPageRoutePattern("/events/:year(\\d{4})/:slug");
    expect(npCompilePluginPageRoutePattern(matcher.pattern)).toBe(matcher);
    expect(matcher.match("events/2026/launch")).toEqual({ year: "2026", slug: "launch" });
    expect(matcher.match("/events/soon/launch")).toBeNull();
    expect(matcher.match("/events/2026")).toBeNull();
    expect(npMatchPluginPageRoutePattern("/", "/")).toEqual({});
  });

  it("fails closed instead of throwing when an unchecked pattern reaches matching", () => {
    expect(() => npMatchPluginPageRoutePattern("/:year([)", "/2026")).not.toThrow();
    expect(npMatchPluginPageRoutePattern("/:year([)", "/2026")).toBeNull();
  });
});
