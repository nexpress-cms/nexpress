import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COLOR_SCHEME_COOKIE,
  COLOR_SCHEME_STORAGE_KEY,
  NxColorSchemeScript,
  generateThemeCss,
  isColorScheme,
} from "@nexpress/theme";
import { DEFAULT_THEME } from "@nexpress/core";

/**
 * Phase 11.5 — color scheme primitives. These ride on the
 * apps/web vitest config because the package itself has no
 * test runner wired; same pattern as `search-highlight`.
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

describe("NxColorSchemeScript", () => {
  it("emits an inline script tag", () => {
    const html = renderToStaticMarkup(<NxColorSchemeScript />);
    expect(html.startsWith("<script>")).toBe(true);
    expect(html.endsWith("</script>")).toBe(true);
  });

  it("references the shared cookie + storage names", () => {
    const html = renderToStaticMarkup(<NxColorSchemeScript />);
    expect(html).toContain(COLOR_SCHEME_COOKIE);
    expect(html).toContain(COLOR_SCHEME_STORAGE_KEY);
  });

  it("checks prefers-color-scheme as a fallback", () => {
    const html = renderToStaticMarkup(<NxColorSchemeScript />);
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("guards against storage exceptions (private mode, opt-out)", () => {
    const html = renderToStaticMarkup(<NxColorSchemeScript />);
    // Two outer try/catch blocks total — one around the whole
    // routine, one around the localStorage read.
    const tryCount = html.match(/try \{/g)?.length ?? 0;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});

describe("generateThemeCss dark-mode emit", () => {
  it("emits a [data-theme=\"dark\"] block when darkMode.colors is set", () => {
    const css = generateThemeCss(DEFAULT_THEME);
    expect(css).toContain('[data-theme="dark"]');
    // The default theme overrides background — make sure the
    // dark value (not the light one) lands in the dark block.
    const darkBlock = css.split('[data-theme="dark"]')[1] ?? "";
    expect(darkBlock).toContain("--nx-color-background");
  });

  it("omits the [data-theme=\"dark\"] block when darkMode is absent", () => {
    const noDarkTheme = { ...DEFAULT_THEME, darkMode: undefined };
    const css = generateThemeCss(noDarkTheme);
    expect(css).not.toContain('[data-theme="dark"]');
  });

  it("only emits dark overrides for the keys explicitly provided", () => {
    const partial = {
      ...DEFAULT_THEME,
      darkMode: { colors: { background: "#000" } },
    };
    const css = generateThemeCss(partial);
    const darkBlock = css.split('[data-theme="dark"]')[1] ?? "";
    expect(darkBlock).toContain("--nx-color-background: #000");
    // primary is in light tokens but NOT overridden in dark, so
    // it shouldn't appear in the dark block.
    expect(darkBlock.split("}")[0]).not.toContain("--nx-color-primary");
  });
});
