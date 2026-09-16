import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COLOR_SCHEME_COOKIE,
  COLOR_SCHEME_STORAGE_KEY,
  NpColorSchemeScript,
  isColorScheme,
} from "@nexpress/theme";

// Render and execute the opt-in early-init utility without a browser or database.
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
  const html = renderToStaticMarkup(<NpColorSchemeScript />);
  const script = html.match(/^<script>([\s\S]*)<\/script>$/)?.[1];
  if (!script) throw new Error("Expected an inline color-scheme script");

  it.each([
    {
      label: "cookie overrides storage and system",
      cookie: "light",
      stored: "dark",
      dark: true,
      expected: "light",
    },
    {
      label: "saved storage overrides system",
      cookie: "",
      stored: "dark",
      dark: false,
      expected: "dark",
    },
    {
      label: "invalid saved choice falls back to system",
      cookie: "auto",
      stored: null,
      dark: true,
      expected: "dark",
    },
    {
      label: "light system leaves defaults untouched",
      cookie: "",
      stored: null,
      dark: false,
      expected: undefined,
    },
    {
      label: "denied storage still uses system preference",
      cookie: "",
      stored: null,
      dark: true,
      denied: true,
      expected: "dark",
    },
  ])("$label", ({ cookie, stored, dark, expected, denied }) => {
    const dataset: Record<string, string> = {};
    const getItem = vi.fn((key: string) => {
      expect(key).toBe(COLOR_SCHEME_STORAGE_KEY);
      if (denied) throw new Error("Storage denied");
      return stored;
    });
    const matchMedia = vi.fn(() => ({ matches: dark }));
    runInNewContext(script, {
      document: {
        cookie: cookie ? `${COLOR_SCHEME_COOKIE}=${cookie}` : "",
        documentElement: { dataset },
      },
      window: { localStorage: { getItem }, matchMedia },
    });
    expect(dataset.theme).toBe(expected);
    expect(getItem).toHaveBeenCalledExactlyOnceWith(COLOR_SCHEME_STORAGE_KEY);
    if (expected === "light" || stored === "dark") expect(matchMedia).not.toHaveBeenCalled();
    else expect(matchMedia).toHaveBeenCalledExactlyOnceWith("(prefers-color-scheme: dark)");
  });

  it("contains platform exceptions instead of breaking page startup", () => {
    const dataset: Record<string, string> = {};
    expect(() =>
      runInNewContext(script, {
        document: { cookie: "", documentElement: { dataset } },
        window: {
          localStorage: { getItem: () => null },
          matchMedia: () => {
            throw new Error("Unavailable");
          },
        },
      }),
    ).not.toThrow();
    expect(dataset).toEqual({});
  });
});
