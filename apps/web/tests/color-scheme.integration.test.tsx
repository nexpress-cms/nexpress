import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COLOR_SCHEME_COOKIE,
  COLOR_SCHEME_STORAGE_KEY,
  NpColorSchemeScript,
  isColorScheme,
} from "@nexpress/theme";

/**
 * Color-scheme primitives. The framework no longer auto-mounts
 * `<NpColorSchemeScript />` — it's exported from `@nexpress/theme`
 * as an opt-in utility for themes that want a saved-choice
 * dark-mode policy. These tests cover only the utility shape;
 * how a theme renders dark variants is the theme's concern.
 *
 * These ride on the apps/web vitest config because the package
 * itself has no test runner wired; same pattern as
 * `search-highlight`.
 */
describe("isColorScheme", () => {
  it("accepts only 'dark' and 'light'", () => {
    expect(isColorScheme("dark")).toBe(true);
    expect(isColorScheme("light")).toBe(true);
  });

  it("rejects everything else (including system / auto / null)", () => {
    expect(isColorScheme("system")).toBe(false);
    expect(isColorScheme("auto")).toBe(false);
    expect(isColorScheme(null)).toBe(false);
    expect(isColorScheme(undefined)).toBe(false);
    expect(isColorScheme("")).toBe(false);
    expect(isColorScheme("DARK")).toBe(false);
  });
});

describe("NpColorSchemeScript", () => {
  it("emits an inline script tag", () => {
    const html = renderToStaticMarkup(<NpColorSchemeScript />);
    expect(html.startsWith("<script>")).toBe(true);
    expect(html.endsWith("</script>")).toBe(true);
  });

  it("references the shared cookie + storage names", () => {
    const html = renderToStaticMarkup(<NpColorSchemeScript />);
    expect(html).toContain(COLOR_SCHEME_COOKIE);
    expect(html).toContain(COLOR_SCHEME_STORAGE_KEY);
  });

  it("checks prefers-color-scheme as a fallback", () => {
    const html = renderToStaticMarkup(<NpColorSchemeScript />);
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("guards against storage exceptions (private mode, opt-out)", () => {
    const html = renderToStaticMarkup(<NpColorSchemeScript />);
    // Two outer try/catch blocks total — one around the whole
    // routine, one around the localStorage read.
    const tryCount = html.match(/try \{/g)?.length ?? 0;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});
