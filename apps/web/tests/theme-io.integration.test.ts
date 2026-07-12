import { describe, expect, it } from "vitest";

import {
  PARSE_ERROR_MESSAGES,
  downloadFilename,
  parseImportedTheme,
  serializeTheme,
} from "../../../packages/admin/src/settings/theme-io.js";
import { DEFAULT_THEME } from "@nexpress/core";

/**
 * Phase 11.6 — theme JSON export/import helpers. The admin
 * package has no test runner of its own, so these ride on
 * apps/web's vitest config (same as `color-scheme` and
 * `search-highlight`). The relative import skips the package
 * boundary because the helpers aren't exposed from
 * `@nexpress/admin`'s public entry — they're internals of
 * the theme editor view.
 */
describe("serializeTheme", () => {
  it("emits JSON with two-space indent", () => {
    const out = serializeTheme(DEFAULT_THEME);
    expect(out.startsWith("{\n  ")).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.colors).toBeDefined();
    expect(parsed.typography).toBeDefined();
    expect(parsed.shape).toBeDefined();
  });

  it("round-trips the default theme through parse → normalize", () => {
    const text = serializeTheme(DEFAULT_THEME);
    const result = parseImportedTheme(text, DEFAULT_THEME);
    if (!result.ok) throw new Error("expected parse to succeed");
    expect(result.theme).toEqual(DEFAULT_THEME);
  });
});

describe("downloadFilename", () => {
  it("encodes the date as YYYY-MM-DD", () => {
    const name = downloadFilename(new Date("2026-04-27T03:14:00Z"));
    expect(name).toMatch(/^nexpress-theme-2026-04-27\.json$/);
  });

  it("zero-pads single-digit month/day", () => {
    const name = downloadFilename(new Date(2026, 0, 5)); // local time Jan 5
    expect(name).toBe("nexpress-theme-2026-01-05.json");
  });
});

describe("parseImportedTheme", () => {
  it("rejects invalid JSON with a clear reason", () => {
    const result = parseImportedTheme("{ not json", DEFAULT_THEME);
    if (result.ok) throw new Error("expected parse to fail");
    expect(result.reason).toBe("invalid_json");
    expect(PARSE_ERROR_MESSAGES[result.reason]).toContain("Invalid JSON");
  });

  it("rejects non-object JSON (arrays, primitives)", () => {
    const arr = parseImportedTheme("[1,2,3]", DEFAULT_THEME);
    if (arr.ok) throw new Error("expected parse to fail");
    expect(arr.reason).toBe("not_an_object");

    const num = parseImportedTheme("42", DEFAULT_THEME);
    if (num.ok) throw new Error("expected parse to fail");
    expect(num.reason).toBe("not_an_object");

    const str = parseImportedTheme('"a string"', DEFAULT_THEME);
    if (str.ok) throw new Error("expected parse to fail");
    expect(str.reason).toBe("not_an_object");

    const nul = parseImportedTheme("null", DEFAULT_THEME);
    if (nul.ok) throw new Error("expected parse to fail");
    expect(nul.reason).toBe("not_an_object");
  });

  it("rejects an object that lacks any theme top-level key", () => {
    const result = parseImportedTheme(
      JSON.stringify({ name: "my package", version: "1.0.0" }),
      DEFAULT_THEME,
    );
    if (result.ok) throw new Error("expected parse to fail");
    expect(result.reason).toBe("no_theme_fields");
  });

  it("accepts a partial theme (only colors) and lets normalize fill the gaps", () => {
    const text = JSON.stringify({
      colors: { primary: "#ff00ff" },
    });
    const result = parseImportedTheme(text, DEFAULT_THEME);
    if (!result.ok) throw new Error("expected parse to succeed");
    expect(result.theme).toEqual({
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors, primary: "#ff00ff" },
    });
  });

  it("unwraps a `{ theme: { ... } }` envelope (matches the GET response shape)", () => {
    const text = JSON.stringify({
      theme: { colors: { primary: "#000000" } },
    });
    const result = parseImportedTheme(text, DEFAULT_THEME);
    if (!result.ok) throw new Error("expected parse to succeed");
    expect(result.theme.colors.primary).toBe("#000000");
  });

  it("rejects a null theme envelope without throwing", () => {
    const result = parseImportedTheme(JSON.stringify({ theme: null }), DEFAULT_THEME);
    if (result.ok) throw new Error("expected parse to fail");
    expect(result.reason).toBe("no_theme_fields");
  });

  it("rejects unknown keys and unsafe CSS values with contract details", () => {
    const unknown = parseImportedTheme(
      JSON.stringify({ colors: { brand: "#fff" } }),
      DEFAULT_THEME,
    );
    if (unknown.ok) throw new Error("expected parse to fail");
    expect(unknown.reason).toBe("invalid_contract");
    expect(unknown.message).toContain("theme.colors.brand");

    const unsafe = parseImportedTheme(
      JSON.stringify({ colors: { primary: "url(https://example.com/x)" } }),
      DEFAULT_THEME,
    );
    if (unsafe.ok) throw new Error("expected parse to fail");
    expect(unsafe.reason).toBe("invalid_contract");
  });
});
