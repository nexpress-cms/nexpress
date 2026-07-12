import { describe, expect, it } from "vitest";

import {
  isNpThemeTokens,
  npAnalyzeThemeTokens,
  npAnalyzeThemeTokensOverlay,
  npMergeThemeTokenOverlays,
  npMergeThemeTokens,
  npThemeTokenGroups,
  npThemeTokenKeys,
  npValidateThemeTokens,
  npValidateThemeTokensOverlay,
} from "./contract.js";
import { DEFAULT_THEME } from "./defaults.js";
import { sanitizeTokenValue } from "./sanitize.js";

describe("theme token contract", () => {
  it("publishes one canonical group and key inventory", () => {
    expect(npThemeTokenGroups).toEqual(["colors", "typography", "shape"]);
    expect(npThemeTokenKeys.colors).toContain("primarySoft");
    expect(npThemeTokenKeys.typography).toContain("fontSize4xl");
    expect(npThemeTokenKeys.shape).toContain("shadowLg");
  });

  it("accepts the complete framework default and partial overlays", () => {
    expect(npValidateThemeTokens(DEFAULT_THEME)).toEqual({ ok: true });
    expect(isNpThemeTokens(DEFAULT_THEME)).toBe(true);
    expect(
      npValidateThemeTokensOverlay({
        colors: { primary: "#123456" },
        shape: { radiusMd: "0.75rem" },
      }),
    ).toEqual({ ok: true });
  });

  it("requires every non-optional key in a complete token tree", () => {
    const invalid = {
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors },
    } as Record<string, unknown> & { colors: Record<string, unknown> };
    delete invalid.colors.primary;

    expect(npAnalyzeThemeTokens(invalid)).toContainEqual({
      path: "theme.colors.primary",
      message: 'theme token "colors.primary" is required.',
    });
    expect(npAnalyzeThemeTokens({ colors: {} })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "theme.typography" }),
        expect.objectContaining({ path: "theme.shape" }),
      ]),
    );
  });

  it("rejects unknown groups, keys, malformed values, and CSS injection syntax", () => {
    expect(npAnalyzeThemeTokensOverlay({ spacing: { md: "1rem" } })[0]).toMatchObject({
      path: "theme.spacing",
    });
    expect(npAnalyzeThemeTokensOverlay({ colors: { brand: "#fff" } })[0]).toMatchObject({
      path: "theme.colors.brand",
    });
    expect(npAnalyzeThemeTokensOverlay({ colors: { primary: 42 } })[0]).toMatchObject({
      path: "theme.colors.primary",
    });
    expect(
      npAnalyzeThemeTokensOverlay({ colors: { primary: "url(https://example.com/a)" } })[0],
    ).toMatchObject({ path: "theme.colors.primary", message: expect.stringMatching(/resource/) });
    expect(npAnalyzeThemeTokensOverlay({ colors: { primary: " red " } })[0]).toMatchObject({
      path: "theme.colors.primary",
    });
    expect(
      npAnalyzeThemeTokensOverlay({ colors: { primary: "u\\72l(https://example.com/a)" } })[0],
    ).toMatchObject({ path: "theme.colors.primary" });
    expect(
      npAnalyzeThemeTokensOverlay({ colors: { primary: "u/**/rl(https://example.com/a)" } })[0],
    ).toMatchObject({ path: "theme.colors.primary" });
    expect(
      npAnalyzeThemeTokensOverlay({
        colors: { primary: "</style><script>alert(1)</script>" },
      })[0],
    ).toMatchObject({ path: "theme.colors.primary" });
    expect(npAnalyzeThemeTokensOverlay({ colors: undefined })[0]).toMatchObject({
      path: "theme.colors",
    });
  });

  it("deep-merges full tokens and partial overlays without dropping siblings", () => {
    const stored = npMergeThemeTokenOverlays(
      { colors: { primary: "#111111" }, shape: { radiusMd: "4px" } },
      { colors: { accent: "#222222" } },
    );
    expect(stored).toEqual({
      colors: { primary: "#111111", accent: "#222222" },
      shape: { radiusMd: "4px" },
    });

    expect(npMergeThemeTokens(DEFAULT_THEME, stored)).toEqual({
      ...DEFAULT_THEME,
      colors: {
        ...DEFAULT_THEME.colors,
        primary: "#111111",
        accent: "#222222",
      },
      shape: { ...DEFAULT_THEME.shape, radiusMd: "4px" },
    });
  });

  it("keeps the standalone sanitizer safe against escaped or commented url syntax", () => {
    expect(sanitizeTokenValue("u/**/rl(https://example.com/a);")).not.toMatch(/url\s*\(/iu);
    expect(sanitizeTokenValue("u\\72l(https://example.com/a)")).not.toContain("\\");
    expect(sanitizeTokenValue("</style><script>alert(1)</script>")).not.toMatch(/[<>]/u);
  });
});
