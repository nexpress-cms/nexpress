import {
  isNpThemeTokens,
  npThemeTokenKeys,
  sanitizeTokenValue,
  type NpThemeTokens,
  type NpThemeTypography,
} from "@nexpress/core/theme";

type ThemeTypographyKey = Extract<keyof NpThemeTypography, string>;

function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function getTypographyVarName(key: ThemeTypographyKey): string {
  if (key === "lineHeight") {
    return "--np-line-height";
  }

  return `--np-${camelToKebab(key)}`;
}

function formatDeclaration(name: string, value: string): string {
  return `    ${name}: ${sanitizeTokenValue(value)};`;
}

/**
 * Emits the active theme's tokens as CSS custom properties
 * under `:root`, wrapped in `@layer np-theme` so site CSS can
 * reliably override them.
 *
 * Color-scheme variants (light/dark) are intentionally not
 * generated here — the framework no longer prescribes a
 * dark-mode shape. Themes that opt into a color-mode toggle
 * mount `<NpColorSchemeScript />` inside their own shell and
 * ship a `[data-theme="dark"] { … }` block in their own CSS
 * (`impl.css`), so each theme controls exactly which tokens
 * flip and how.
 */
export function generateThemeCss(theme: NpThemeTokens): string {
  if (!isNpThemeTokens(theme)) {
    throw new Error("Cannot generate theme CSS from invalid theme tokens.");
  }
  const rootDeclarations = [
    ...npThemeTokenKeys.colors.flatMap((key) => {
      // Optional color slots — only emit a declaration when the
      // theme actually populated the value. Consumers reference
      // these vars with a `color-mix(...)` fallback so the omitted
      // case still renders.
      const value = theme.colors[key];
      if (value === undefined) return [];
      return [formatDeclaration(`--np-color-${camelToKebab(key)}`, value)];
    }),
    ...npThemeTokenKeys.typography.map((key) =>
      formatDeclaration(getTypographyVarName(key), theme.typography[key]),
    ),
    ...npThemeTokenKeys.shape.map((key) =>
      formatDeclaration(`--np-${camelToKebab(key)}`, theme.shape[key]),
    ),
  ];

  return ["@layer np-theme {", "  :root {", ...rootDeclarations, "  }", "}"].join("\n");
}
