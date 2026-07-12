import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@nexpress/core/theme";

import { generateThemeCss } from "./generate-css.js";

describe("generateThemeCss", () => {
  it("emits every canonical token group using np-prefixed variables", () => {
    const css = generateThemeCss(DEFAULT_THEME);
    expect(css).toContain("--np-color-primary:");
    expect(css).toContain("--np-font-heading:");
    expect(css).toContain("--np-line-height:");
    expect(css).toContain("--np-radius-md:");
    expect(css).toContain("--np-shadow-lg:");
  });

  it("omits optional tokens and rejects invalid trees before CSS generation", () => {
    expect(generateThemeCss(DEFAULT_THEME)).not.toContain("--np-color-primary-soft:");
    expect(() =>
      generateThemeCss({
        ...DEFAULT_THEME,
        colors: { ...DEFAULT_THEME.colors, primary: "url(https://example.com/x)" },
      }),
    ).toThrow(/invalid theme tokens/);
    expect(() =>
      generateThemeCss({
        ...DEFAULT_THEME,
        colors: { ...DEFAULT_THEME.colors, primary: "</style><script>alert(1)</script>" },
      }),
    ).toThrow(/invalid theme tokens/);
  });
});
